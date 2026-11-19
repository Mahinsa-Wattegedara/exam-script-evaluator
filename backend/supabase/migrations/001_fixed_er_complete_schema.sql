-- ==============================================================================
-- Migration 002: Complete Schema Implementation based on FIXED_ER.pdf
-- Exam Script Evaluator — High-Integrity Architecture (NFR-01, NFR-02)
-- ==============================================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Drop existing tables safely in reverse dependency order
DROP TABLE IF EXISTS public.review_requests CASCADE;
DROP TABLE IF EXISTS public.teacher_decisions CASCADE;
DROP TABLE IF EXISTS public.results CASCADE;
DROP TABLE IF EXISTS public.agent_messages CASCADE;
DROP TABLE IF EXISTS public.dispute_packets CASCADE;
DROP TABLE IF EXISTS public.evaluations CASCADE;
DROP TABLE IF EXISTS public.answers CASCADE;
DROP TABLE IF EXISTS public.script_images CASCADE;
DROP TABLE IF EXISTS public.scripts CASCADE;
DROP TABLE IF EXISTS public.criteria CASCADE;
DROP TABLE IF EXISTS public.rubrics CASCADE;
DROP TABLE IF EXISTS public.questions CASCADE;
DROP TABLE IF EXISTS public.student_identity_map CASCADE;
DROP TABLE IF EXISTS public.assessments CASCADE;
DROP TABLE IF EXISTS public.students CASCADE;
DROP TABLE IF EXISTS public.project_admins CASCADE;
DROP TABLE IF EXISTS public.teachers CASCADE;
DROP TABLE IF EXISTS public.app_users CASCADE;

-- ==============================================================================
-- 2. User & Subtypes Hierarchy (Page 1 of FIXED_ER.pdf)
-- ==============================================================================

-- 2.1 User Base Entity
CREATE TABLE public.app_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('TEACHER', 'STUDENT', 'ADMIN')),
    password_hash TEXT NOT NULL,
    encrypted_student_id TEXT,
    encrypted_pseudonym TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 Teacher Subtype
CREATE TABLE public.teachers (
    teacher_id UUID PRIMARY KEY REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    department TEXT NOT NULL DEFAULT 'Department of Computer Science & Engineering',
    title_prefix TEXT NOT NULL DEFAULT 'Dr.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Project_Admin Subtype
CREATE TABLE public.project_admins (
    admin_id UUID PRIMARY KEY REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    access_level TEXT NOT NULL DEFAULT 'SYSTEM_ADMIN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.4 Student Subtype (managed_by Project_Admin)
CREATE TABLE public.students (
    student_id UUID PRIMARY KEY REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    pseudonym_code TEXT,
    admin_id UUID REFERENCES public.project_admins(admin_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 3. Assessment & Rubrics Hierarchy (Page 1 of FIXED_ER.pdf)
-- ==============================================================================

-- 3.1 Assessment (creates: Teacher -> Assessment)
CREATE TABLE public.assessments (
    assessment_id TEXT PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES public.teachers(teacher_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'MARKING', 'COMPLETED', 'ARCHIVED')),
    retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2 Question (contains: Assessment -> Question)
CREATE TABLE public.questions (
    question_id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES public.assessments(assessment_id) ON DELETE CASCADE,
    question_no INTEGER NOT NULL CHECK (question_no > 0),
    prompt TEXT NOT NULL DEFAULT '',
    max_marks NUMERIC(5, 2) NOT NULL CHECK (max_marks > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_assessment_question_no UNIQUE (assessment_id, question_no)
);

-- 3.3 Rubric (defines: Question -> Rubric, approves: Teacher -> Rubric)
CREATE TABLE public.rubrics (
    rubric_id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES public.questions(question_id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT', 'APPROVED', 'REJECTED')),
    model_answer_text TEXT NOT NULL DEFAULT '',
    approved_by UUID REFERENCES public.teachers(teacher_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_question_rubric_version UNIQUE (question_id, version)
);

-- 3.4 Criterion (has: Rubric -> Criterion)
CREATE TABLE public.criteria (
    criterion_id TEXT PRIMARY KEY,
    rubric_id TEXT NOT NULL REFERENCES public.rubrics(rubric_id) ON DELETE CASCADE,
    criterion_no TEXT NOT NULL DEFAULT 'C1',
    description TEXT NOT NULL,
    max_mark NUMERIC(5, 2) NOT NULL CHECK (max_mark >= 0),
    partial_credit_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    accepted_alternatives TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 4. Script & Ingestion Hierarchy (Page 1 of FIXED_ER.pdf)
-- ==============================================================================

-- 4.1 Script (uploads: Teacher -> Script, uses: Assessment -> Script, receives: Student -> Script)
CREATE TABLE public.scripts (
    script_id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES public.assessments(assessment_id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.teachers(teacher_id) ON DELETE RESTRICT,
    student_id UUID REFERENCES public.students(student_id) ON DELETE SET NULL,
    pseudonym_code TEXT NOT NULL,
    upload_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (upload_status IN ('PENDING', 'PROCESSING', 'EXTRACTED', 'PROCESSED', 'FAILED')),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4.2 Script_Image (has_pages: Script -> Script_Image, approves: Teacher -> Script_Image)
CREATE TABLE public.script_images (
    image_id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL REFERENCES public.scripts(script_id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    image_url TEXT NOT NULL,
    header_masked BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_by UUID REFERENCES public.teachers(teacher_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_script_page_number UNIQUE (script_id, page_number)
);

-- ==============================================================================
-- 5. Answers, Evaluations & Moderation Hierarchy (Page 2 of FIXED_ER.pdf)
-- ==============================================================================

-- 5.1 Answer (extracts: Script -> Answer, mapped_to: Question -> Answer, approves_transcript: Teacher -> Answer)
CREATE TABLE public.answers (
    answer_id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL REFERENCES public.scripts(script_id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES public.questions(question_id) ON DELETE CASCADE,
    transcript_text TEXT NOT NULL DEFAULT '',
    transcript_version INTEGER NOT NULL DEFAULT 1,
    ocr_confidence TEXT NOT NULL DEFAULT 'HIGH' CHECK (ocr_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
    approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_by UUID REFERENCES public.teachers(teacher_id) ON DELETE SET NULL,
    evidence_spans JSONB NOT NULL DEFAULT '[]'::jsonb,
    review_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_script_question_pair UNIQUE (script_id, question_id)
);

-- 5.2 Evaluation (evaluates: Answer -> Evaluation, applies: Rubric -> Evaluation)
CREATE TABLE public.evaluations (
    evaluation_id TEXT PRIMARY KEY,
    answer_id TEXT NOT NULL REFERENCES public.answers(answer_id) ON DELETE CASCADE,
    rubric_id TEXT NOT NULL REFERENCES public.rubrics(rubric_id) ON DELETE CASCADE,
    evaluator_role TEXT NOT NULL CHECK (evaluator_role IN ('EVALUATOR_A', 'EVALUATOR_B', 'MODERATOR')),
    total_marks NUMERIC(5, 2) NOT NULL DEFAULT 0.0 CHECK (total_marks >= 0),
    criterion_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
    justification TEXT NOT NULL DEFAULT '',
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.3 Dispute_Packet (compares_A & compares_B: Evaluation -> Dispute_Packet)
CREATE TABLE public.dispute_packets (
    dispute_id TEXT PRIMARY KEY,
    eval_a_id TEXT NOT NULL REFERENCES public.evaluations(evaluation_id) ON DELETE CASCADE,
    eval_b_id TEXT NOT NULL REFERENCES public.evaluations(evaluation_id) ON DELETE CASCADE,
    contested_criterion TEXT NOT NULL,
    masked_evidence TEXT NOT NULL DEFAULT '',
    verification_question TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'ESCALATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.4 Agent_Message (logs_message: Answer -> Agent_Message)
CREATE TABLE public.agent_messages (
    message_id TEXT PRIMARY KEY,
    answer_id TEXT NOT NULL REFERENCES public.answers(answer_id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('EVALUATOR_A', 'EVALUATOR_B', 'MODERATOR', 'TEACHER', 'SYSTEM')),
    recipient_role TEXT NOT NULL CHECK (recipient_role IN ('EVALUATOR_A', 'EVALUATOR_B', 'MODERATOR', 'TEACHER', 'SYSTEM')),
    workflow_stage TEXT NOT NULL CHECK (workflow_stage IN ('INDEPENDENT_EVAL', 'MODERATION', 'REVISION', 'TEACHER_REVIEW', 'COMPLETED')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 6. Results, Teacher Decisions & Review Requests (Page 2 of FIXED_ER.pdf)
-- ==============================================================================

-- 6.1 Result (produces: Answer -> Result [1:1])
CREATE TABLE public.results (
    result_id TEXT PRIMARY KEY,
    answer_id TEXT UNIQUE NOT NULL REFERENCES public.answers(answer_id) ON DELETE CASCADE,
    final_marks NUMERIC(5, 2) NOT NULL DEFAULT 0.0 CHECK (final_marks >= 0),
    feedback_text TEXT NOT NULL DEFAULT '',
    result_version INTEGER NOT NULL DEFAULT 1,
    is_released BOOLEAN NOT NULL DEFAULT FALSE,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6.2 Teacher_Decision (makes: Teacher -> Teacher_Decision, decides_on: Answer -> Teacher_Decision, updates: Result)
CREATE TABLE public.teacher_decisions (
    decision_id TEXT PRIMARY KEY,
    answer_id TEXT NOT NULL REFERENCES public.answers(answer_id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.teachers(teacher_id) ON DELETE RESTRICT,
    result_id TEXT REFERENCES public.results(result_id) ON DELETE SET NULL,
    override_marks NUMERIC(5, 2) NOT NULL CHECK (override_marks >= 0),
    decision_reason TEXT NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6.3 Review_Request (submits: Student -> Review_Request, appeals: Result -> Review_Request)
CREATE TABLE public.review_requests (
    request_id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL REFERENCES public.results(result_id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'RESOLVED')),
    resolution_note TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 7. Isolated Student Identity Mapping (NFR-02 Cryptographic Protection)
-- ==============================================================================

CREATE TABLE public.student_identity_map (
    identity_map_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id TEXT NOT NULL REFERENCES public.assessments(assessment_id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    pseudonym_code TEXT NOT NULL,
    encrypted_real_student_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_assessment_student_map UNIQUE (assessment_id, student_id),
    CONSTRAINT unique_assessment_pseudonym_map UNIQUE (assessment_id, pseudonym_code)
);

-- ==============================================================================
-- 8. Row-Level Security (RLS) & Role Privileges
-- ==============================================================================

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_identity_map ENABLE ROW LEVEL SECURITY;

-- Grant schema usage to roles
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE ON public.review_requests TO authenticated;

-- Policies for app_users
DROP POLICY IF EXISTS app_users_self_read ON public.app_users;
CREATE POLICY app_users_self_read ON public.app_users FOR SELECT USING (true);

-- Policies for public tables
DROP POLICY IF EXISTS public_read_assessments ON public.assessments;
CREATE POLICY public_read_assessments ON public.assessments FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_questions ON public.questions;
CREATE POLICY public_read_questions ON public.questions FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_rubrics ON public.rubrics;
CREATE POLICY public_read_rubrics ON public.rubrics FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_criteria ON public.criteria;
CREATE POLICY public_read_criteria ON public.criteria FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_scripts ON public.scripts;
CREATE POLICY public_read_scripts ON public.scripts FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_script_images ON public.script_images;
CREATE POLICY public_read_script_images ON public.script_images FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_answers ON public.answers;
CREATE POLICY public_read_answers ON public.answers FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_evaluations ON public.evaluations;
CREATE POLICY public_read_evaluations ON public.evaluations FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_results ON public.results;
CREATE POLICY public_read_results ON public.results FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_teacher_decisions ON public.teacher_decisions;
CREATE POLICY public_read_teacher_decisions ON public.teacher_decisions FOR SELECT USING (true);

DROP POLICY IF EXISTS public_read_agent_messages ON public.agent_messages;
CREATE POLICY public_read_agent_messages ON public.agent_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS student_review_requests ON public.review_requests;
CREATE POLICY student_review_requests ON public.review_requests FOR ALL USING (true);

-- Strict Policy on student_identity_map (NFR-01, NFR-02)
DROP POLICY IF EXISTS teacher_identity_map ON public.student_identity_map;
CREATE POLICY teacher_identity_map ON public.student_identity_map FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.app_users u
        WHERE u.user_id = auth.uid() AND (u.role = 'TEACHER' OR u.role = 'ADMIN')
    ) OR auth.uid() IS NULL
);

-- ==============================================================================
-- 9. Seed Data (Fresh, Cohesive Initial State)
-- ==============================================================================

-- 9.1 Insert Core Users (Teacher, Students, Admin)
-- Passwords:
-- dr.silva: Teacher@123
-- 245001K: Student@123
-- 245017P: Student@123
-- admin: Admin@123
INSERT INTO public.app_users (user_id, username, email, name, display_name, role, password_hash, encrypted_student_id, encrypted_pseudonym, is_active)
VALUES
('a1111111-1111-1111-1111-111111111111', 'dr.silva', 'dr.silva@uom.lk', 'Dr. S. Silva', 'Dr. S. Silva (Teacher)', 'TEACHER', 'pbkdf2_sha256$100000$c92131d1b7a2d603a1104e135be3364f$9fa926a35022dc70a2a4fe6466f849ffb72352fa1819324e93149ba12dfbd916', NULL, NULL, TRUE),
('b2222222-2222-2222-2222-222222222222', '245001K', '245001k@uom.lk', 'Kasun Jayawardena', 'Kasun Jayawardena (245001K)', 'STUDENT', 'pbkdf2_sha256$100000$e6bf2baef7d22dc05c28f322308722b4$a79e403d15b138139d1b092fb13e551390977ee4ffcfc721fa0c20cebe435520', '48ef9ea29f5f67b57bf10682:2c69b2a7587efae11e9f2913e65ee739:26d69185a86a68', '512be8f0e5b72e50587638ad:9bcfa88152fc99772a445e45a27eb4b2:7a374aa311a30f30', TRUE),
('c3333333-3333-3333-3333-333333333333', '245017P', '245017p@uom.lk', 'Nimali Fernando', 'Nimali Fernando (245017P)', 'STUDENT', 'pbkdf2_sha256$100000$8dcce96f7c4613bbad79ff684dae6a9f$499b357fbb4387d8a6df6f634563a948e7ba662ca34453896b7978280f9359a6', '714d2e7355ca0a133d142ab7:ec30f82df31c360980ff559f0f9b6cb6:4b49d6c3fa9b19', '881fe2198031dcf9e3f191b9:4cae812d1bf435dfc6d2bc60c2394593:4e0aa2f754a65239', TRUE),
('d4444444-4444-4444-4444-444444444444', 'admin', 'admin@uom.lk', 'Project Admin', 'Project Admin', 'ADMIN', 'pbkdf2_sha256$100000$2638f268b8b0e77d295ff681816e04d4$6784dbe8a56ee79d63c5e88e8ec5d1b33cb77a5e9551c911874b34b172a297be', NULL, NULL, TRUE);

-- 9.2 Subtypes
INSERT INTO public.teachers (teacher_id, department, title_prefix)
VALUES ('a1111111-1111-1111-1111-111111111111', 'Department of Computer Science & Engineering', 'Dr.');

INSERT INTO public.project_admins (admin_id, access_level)
VALUES ('d4444444-4444-4444-4444-444444444444', 'SYSTEM_ADMIN');

INSERT INTO public.students (student_id, pseudonym_code, admin_id)
VALUES
('b2222222-2222-2222-2222-222222222222', 'SCR-7F3A', 'd4444444-4444-4444-4444-444444444444'),
('c3333333-3333-3333-3333-333333333333', 'SCR-2B91', 'd4444444-4444-4444-4444-444444444444');

-- 9.3 Assessment & Questions
INSERT INTO public.assessments (assessment_id, teacher_id, title, status, retention_days)
VALUES ('asm-cs2042-mid-2026', 'a1111111-1111-1111-1111-111111111111', 'Mid Semester Examination 2026', 'PUBLISHED', 365);

INSERT INTO public.questions (question_id, assessment_id, question_no, prompt, max_marks)
VALUES ('q1', 'asm-cs2042-mid-2026', 1, 'Explain the cognitive benefits of handwriting notes and how handwritten notes can be integrated into an org-mode productivity workflow.', 4.00);

-- 9.4 Rubric & Criteria
INSERT INTO public.rubrics (rubric_id, question_id, version, approval_status, model_answer_text, approved_by)
VALUES ('rub-q1-v1', 'q1', 1, 'APPROVED', 'Research suggests note taking is most effective when done by hand. Handwritten notes are retained longer due to deeper cognitive engagement. In terms of hardware, integrating handwritten notes into computer-based productivity workflows like Emacs org-mode can be achieved using optical character recognition or tablet hardware.', 'a1111111-1111-1111-1111-111111111111');

INSERT INTO public.criteria (criterion_id, rubric_id, criterion_no, description, max_mark, partial_credit_rules, accepted_alternatives)
VALUES
('crit-q1-c1', 'rub-q1-v1', 'C1', 'Key definition / core principle for Q1', 2.00, '[0, 1, 2]'::jsonb, 'Standard academic definition or paraphrase'),
('crit-q1-c2', 'rub-q1-v1', 'C2', 'Explanation / justification for Q1', 2.00, '[0, 1, 2]'::jsonb, 'Grounded technical justification');

-- 9.5 Scripts & Script Images
INSERT INTO public.scripts (script_id, assessment_id, uploaded_by, student_id, pseudonym_code, upload_status)
VALUES
('scr-001', 'asm-cs2042-mid-2026', 'a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'SCR-7F3A', 'EXTRACTED'),
('scr-002', 'asm-cs2042-mid-2026', 'a1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'SCR-2B91', 'EXTRACTED');

INSERT INTO public.script_images (image_id, script_id, page_number, image_url, header_masked, approval_status, approved_by)
VALUES
('img-scr-001-p1', 'scr-001', 1, '/samples/script1_page1.png', TRUE, 'APPROVED', 'a1111111-1111-1111-1111-111111111111'),
('img-scr-002-p1', 'scr-002', 1, '/samples/script2_page1.png', TRUE, 'APPROVED', 'a1111111-1111-1111-1111-111111111111');

-- 9.6 Answers
INSERT INTO public.answers (answer_id, script_id, question_id, transcript_text, transcript_version, ocr_confidence, approval_status, approved_by, evidence_spans, review_flags)
VALUES
('ans-001-q1', 'scr-001', 'q1', 'Research suggests that note taking is most effective when done by hand. Yes, handwritten notes. Certainly, typewritten or typed out notes are more efficient, however notes written by hand are retained by the human brain much longer. Integrating handwritten notes into a computer based productivity workflow is tricky, too. In terms of hardware, if all you have is a smartphone, then we need to deal with the situation a bit differently. This talk will introduce to you a simple system to integrate handwritten notes into your org-mode (Emacs) based productivity workflow.', 1, 'HIGH', 'APPROVED', 'a1111111-1111-1111-1111-111111111111', '[{"text": "Research suggests that note taking is most effective when done by hand", "criterion": "C1", "score": 2}, {"text": "integrate handwritten notes into your org-mode (Emacs) based productivity workflow", "criterion": "C2", "score": 2}]'::jsonb, '[]'::jsonb),
('ans-002-q1', 'scr-002', 'q1', 'Taking notes with pen and paper allows better memory retention compared to typing. Although slower, handwritten notes require mental synthesis. Emacs org-mode workflows can incorporate scanned notes or camera captures using OCR tools.', 1, 'HIGH', 'APPROVED', 'a1111111-1111-1111-1111-111111111111', '[{"text": "Taking notes with pen and paper allows better memory retention", "criterion": "C1", "score": 2}, {"text": "Emacs org-mode workflows can incorporate scanned notes", "criterion": "C2", "score": 1.5}]'::jsonb, '[]'::jsonb);

-- 9.7 Evaluations (Evaluator A, Evaluator B, Moderator)
INSERT INTO public.evaluations (evaluation_id, answer_id, rubric_id, evaluator_role, total_marks, criterion_scores, justification, is_stale)
VALUES
('eval-001-a', 'ans-001-q1', 'rub-q1-v1', 'EVALUATOR_A', 3.50, '[{"criterion_id": "crit-q1-c1", "marks": 2.0}, {"criterion_id": "crit-q1-c2", "marks": 1.5}]'::jsonb, 'Clear explanation of handwriting benefits and org-mode integration.', FALSE),
('eval-001-b', 'ans-001-q1', 'rub-q1-v1', 'EVALUATOR_B', 4.00, '[{"criterion_id": "crit-q1-c1", "marks": 2.0}, {"criterion_id": "crit-q1-c2", "marks": 2.0}]'::jsonb, 'Fully satisfies both criteria with explicit cognitive and workflow details.', FALSE),
('eval-001-mod', 'ans-001-q1', 'rub-q1-v1', 'MODERATOR', 4.00, '[{"criterion_id": "crit-q1-c1", "marks": 2.0}, {"criterion_id": "crit-q1-c2", "marks": 2.0}]'::jsonb, 'Consensus resolved at full 4.0 marks based on explicit org-mode evidence.', FALSE);

-- 9.8 Dispute Packet & Agent Messages
INSERT INTO public.dispute_packets (dispute_id, eval_a_id, eval_b_id, contested_criterion, masked_evidence, verification_question, status)
VALUES ('dsp-001', 'eval-001-a', 'eval-001-b', 'C2', 'integrating handwritten notes into computer based productivity workflow... org-mode (Emacs)', 'Does the student specify a concrete software tool for integration?', 'RESOLVED');

INSERT INTO public.agent_messages (message_id, answer_id, sender_role, recipient_role, workflow_stage, content)
VALUES
('msg-001', 'ans-001-q1', 'EVALUATOR_A', 'MODERATOR', 'MODERATION', 'Initial score 3.5: C1=2.0, C2=1.5. Tool integration is outlined but brief.'),
('msg-002', 'ans-001-q1', 'EVALUATOR_B', 'MODERATOR', 'MODERATION', 'Initial score 4.0: Both C1 and C2 completely answered with org-mode context.'),
('msg-003', 'ans-001-q1', 'MODERATOR', 'EVALUATOR_A', 'REVISION', 'Student explicitly identifies Emacs org-mode and smartphone adaptation. Revising C2 to 2.0 recommended.');

-- 9.9 Result & Teacher Decision
INSERT INTO public.results (result_id, answer_id, final_marks, feedback_text, result_version, is_released, released_at)
VALUES ('res-001', 'ans-001-q1', 4.00, 'Excellent response demonstrating comprehensive understanding of handwritten cognition and Emacs org-mode integration.', 1, TRUE, NOW());

INSERT INTO public.teacher_decisions (decision_id, answer_id, teacher_id, result_id, override_marks, decision_reason)
VALUES ('dec-001', 'ans-001-q1', 'a1111111-1111-1111-1111-111111111111', 'res-001', 4.00, 'Approved automated consensus mark of 4.0 / 4.0 after reviewing evidence spans.');

-- 9.10 Student Identity Map (NFR-02)
INSERT INTO public.student_identity_map (assessment_id, student_id, pseudonym_code, encrypted_real_student_id)
VALUES
('asm-cs2042-mid-2026', 'b2222222-2222-2222-2222-222222222222', 'SCR-7F3A', '48ef9ea29f5f67b57bf10682:2c69b2a7587efae11e9f2913e65ee739:26d69185a86a68'),
('asm-cs2042-mid-2026', 'c3333333-3333-3333-3333-333333333333', 'SCR-2B91', '714d2e7355ca0a133d142ab7:ec30f82df31c360980ff559f0f9b6cb6:4b49d6c3fa9b19');
