-- Incremental migration. Run AFTER 001 against the existing Supabase database.
-- Do not rerun 001: that older script drops existing tables.
BEGIN;

ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT '';
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS external_question_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS questions_assessment_external_id
    ON public.questions(assessment_id, external_question_id);
ALTER TABLE public.rubrics ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.rubrics ADD COLUMN IF NOT EXISTS approved_by_username TEXT;
ALTER TABLE public.rubrics ADD COLUMN IF NOT EXISTS approved_snapshot JSONB;
ALTER TABLE public.criteria ADD COLUMN IF NOT EXISTS subquestion_id TEXT;
ALTER TABLE public.criteria ADD COLUMN IF NOT EXISTS source_excerpt TEXT;
ALTER TABLE public.criteria ADD COLUMN IF NOT EXISTS scoring_guide JSONB;

-- Original answers and scoring rules are backend-only, even if older read policies exist.
REVOKE ALL ON public.rubrics, public.criteria FROM anon, authenticated;
GRANT ALL ON public.rubrics, public.criteria TO service_role;

CREATE OR REPLACE FUNCTION public.protect_module2_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status TEXT;
BEGIN
    IF TG_TABLE_NAME = 'rubrics' THEN
        v_status := OLD.approval_status;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            SELECT approval_status INTO v_status FROM public.rubrics WHERE rubric_id = OLD.rubric_id;
            IF v_status = 'APPROVED' THEN
                RAISE SQLSTATE 'PT409' USING MESSAGE = 'Approved rubric criteria are immutable';
            END IF;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            SELECT approval_status INTO v_status FROM public.rubrics WHERE rubric_id = NEW.rubric_id;
        END IF;
    END IF;
    IF v_status = 'APPROVED' THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'Approved rubrics are immutable; create a new version';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS module2_immutable_rubric ON public.rubrics;
CREATE TRIGGER module2_immutable_rubric BEFORE UPDATE OR DELETE ON public.rubrics
    FOR EACH ROW EXECUTE FUNCTION public.protect_module2_approval();
DROP TRIGGER IF EXISTS module2_immutable_criteria ON public.criteria;
CREATE TRIGGER module2_immutable_criteria BEFORE INSERT OR UPDATE OR DELETE ON public.criteria
    FOR EACH ROW EXECUTE FUNCTION public.protect_module2_approval();

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
        v_question := 'm2q-' || md5(jsonb_build_array(p_assessment_id, p_question_id)::TEXT);
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
