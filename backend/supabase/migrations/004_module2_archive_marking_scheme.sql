-- Run after 002. Archive demo rubrics by removing their active question mapping.
-- Existing grading references and immutable rubric history are retained.
BEGIN;

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS unique_assessment_question_no;
CREATE UNIQUE INDEX IF NOT EXISTS active_assessment_question_no
    ON public.questions(assessment_id, question_no) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.archive_module2_marking_scheme(
    p_assessment_id TEXT, p_teacher_username TEXT, p_question_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_teacher UUID;
    v_owner UUID;
    v_targets TEXT[];
    v_archived INTEGER;
BEGIN
    SELECT t.teacher_id INTO v_teacher
      FROM public.teachers t JOIN public.app_users u ON u.user_id = t.teacher_id
      WHERE u.username = p_teacher_username AND u.role = 'TEACHER' AND u.is_active;
    IF v_teacher IS NULL THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Active teacher account required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_assessment_id, 0));
    SELECT teacher_id INTO v_owner FROM public.assessments
      WHERE assessment_id = p_assessment_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('archivedQuestions', 0);
    END IF;
    IF v_owner <> v_teacher THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Assessment not found';
    END IF;

    SELECT ARRAY(SELECT question_id FROM public.questions
        WHERE assessment_id = p_assessment_id AND external_question_id IS NOT NULL
          AND archived_at IS NULL AND (p_question_id IS NULL OR external_question_id = p_question_id)
        FOR UPDATE) INTO v_targets;
    IF cardinality(v_targets) = 0 THEN
        RETURN jsonb_build_object('archivedQuestions', 0);
    END IF;

    IF (p_question_id IS NULL AND EXISTS (SELECT 1 FROM public.scripts WHERE assessment_id = p_assessment_id))
       OR EXISTS (SELECT 1 FROM public.answers WHERE question_id = ANY(v_targets))
       OR EXISTS (SELECT 1 FROM public.evaluations e JOIN public.rubrics r ON r.rubric_id = e.rubric_id
                  WHERE r.question_id = ANY(v_targets)) THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'This marking scheme is linked to student work.';
    END IF;

    UPDATE public.questions SET external_question_id = NULL, archived_at = clock_timestamp()
      WHERE question_id = ANY(v_targets);
    GET DIAGNOSTICS v_archived = ROW_COUNT;
    RETURN jsonb_build_object('archivedQuestions', v_archived);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_module2_marking_scheme(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_module2_marking_scheme(TEXT,TEXT,TEXT) TO service_role;

-- Each newly approved question needs its own ID, even when an archived question used the same label.
CREATE OR REPLACE FUNCTION public.approve_module2_rubric(
    p_assessment_id TEXT, p_question_id TEXT, p_teacher_username TEXT,
    p_title TEXT, p_course TEXT, p_expected_version INTEGER, p_question JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_teacher UUID;
    v_owner UUID;
    v_question TEXT;
    v_rubric TEXT;
    v_current INTEGER;
    v_version INTEGER;
    v_at TIMESTAMPTZ := clock_timestamp();
    v_criterion JSONB;
BEGIN
    SELECT t.teacher_id INTO v_teacher
      FROM public.teachers t JOIN public.app_users u ON u.user_id = t.teacher_id
      WHERE u.username = p_teacher_username AND u.role = 'TEACHER' AND u.is_active;
    IF v_teacher IS NULL THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Active teacher account required';
    END IF;
    -- One transaction per assessment: ownership, question, version and criteria are atomic.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_assessment_id, 0));
    SELECT teacher_id INTO v_owner FROM public.assessments WHERE assessment_id = p_assessment_id;
    IF v_owner IS NOT NULL AND v_owner <> v_teacher THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Assessment not found';
    END IF;
    INSERT INTO public.assessments(assessment_id, teacher_id, title, course)
      VALUES (p_assessment_id, v_teacher, p_title, p_course)
      ON CONFLICT (assessment_id) DO NOTHING;
    SELECT teacher_id INTO v_owner FROM public.assessments WHERE assessment_id = p_assessment_id FOR UPDATE;
    IF v_owner <> v_teacher THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Assessment not found';
    END IF;

    SELECT question_id INTO v_question FROM public.questions
      WHERE assessment_id = p_assessment_id AND external_question_id = p_question_id;
    IF v_question IS NULL THEN
        v_question := 'm2q-' || gen_random_uuid()::TEXT;
    END IF;
    SELECT COALESCE(MAX(version), 0) INTO v_current FROM public.rubrics
      WHERE question_id = v_question AND approval_status = 'APPROVED';
    IF p_expected_version IS NULL OR p_expected_version <> v_current THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'Approved version changed; reload latest version';
    END IF;
    IF (p_question->>'maxMarks')::NUMERIC <= 0 OR
       (SELECT SUM((c->>'maxMarks')::NUMERIC) FROM jsonb_array_elements(p_question->'criteria') c)
         IS DISTINCT FROM (p_question->>'maxMarks')::NUMERIC THEN
        RAISE SQLSTATE 'PT422' USING MESSAGE = 'Criterion marks must total question marks';
    END IF;
    INSERT INTO public.questions(question_id, assessment_id, external_question_id, question_no, prompt, max_marks)
      VALUES (v_question, p_assessment_id, p_question_id,
              substring(p_question->>'number' FROM '^Q([0-9]+)$')::INTEGER,
              p_question->>'prompt', (p_question->>'maxMarks')::NUMERIC)
      ON CONFLICT (question_id) DO UPDATE
        SET prompt = EXCLUDED.prompt, max_marks = EXCLUDED.max_marks, question_no = EXCLUDED.question_no;
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM public.rubrics WHERE question_id = v_question;
    v_rubric := v_question || '-v' || v_version;
    INSERT INTO public.rubrics(rubric_id, question_id, version, approval_status, model_answer_text)
      VALUES (v_rubric, v_question, v_version, 'DRAFT', COALESCE(p_question->>'modelAnswerText', ''));
    FOR v_criterion IN SELECT value FROM jsonb_array_elements(p_question->'criteria') LOOP
        INSERT INTO public.criteria(criterion_id, rubric_id, criterion_no, description, max_mark,
                                    partial_credit_rules, accepted_alternatives, subquestion_id, source_excerpt, scoring_guide)
          VALUES (v_rubric || '-' || (v_criterion->>'id'), v_rubric, v_criterion->>'id',
                  v_criterion->>'description', (v_criterion->>'maxMarks')::NUMERIC,
                  v_criterion->'allowedPartialCredits',
                  array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_criterion->'acceptedAlternatives')), E'\n'),
                  v_criterion->>'subquestionId', v_criterion->>'sourceExcerpt', v_criterion->'scoringGuide');
    END LOOP;
    UPDATE public.rubrics SET approval_status = 'APPROVED', approved_by = v_teacher,
        approved_at = v_at, approved_by_username = p_teacher_username, approved_snapshot = p_question
        WHERE rubric_id = v_rubric;
    RETURN jsonb_build_object('rubricId', v_rubric, 'assessmentId', p_assessment_id,
        'questionId', p_question_id, 'version', v_version, 'approvedAt', v_at,
        'approvedBy', p_teacher_username, 'question', p_question);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_module2_rubric(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_module2_rubric(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
