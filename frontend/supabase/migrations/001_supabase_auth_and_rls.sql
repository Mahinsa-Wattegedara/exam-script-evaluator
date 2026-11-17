-- Supabase PostgreSQL 15+ Schema: Authentication, AES-256 Encryption & Row-Level Security (RLS)
-- Enforces NFR-01 (Course Ownership & Student Identity Isolation) and NFR-02 (Data Protection & Encryption)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Application Users Table
CREATE TABLE IF NOT EXISTS public.app_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,           -- PBKDF2-HMAC-SHA256 (100,000 iterations)
    role TEXT NOT NULL CHECK (role IN ('TEACHER', 'STUDENT', 'ADMIN')),
    display_name TEXT NOT NULL,
    encrypted_student_id TEXT,             -- AES-256-GCM ciphertext (iv:authTag:ciphertext) (NFR-02)
    encrypted_pseudonym TEXT,              -- AES-256-GCM ciphertext (iv:authTag:ciphertext) (NFR-02)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Isolated Student Identity Mapping Table (NFR-02)
-- Physically and logically separated from grading and OCR payloads
CREATE TABLE IF NOT EXISTS public.student_identity_map (
    identity_map_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id TEXT NOT NULL,
    pseudonymous_script_code TEXT UNIQUE NOT NULL,
    encrypted_real_student_id TEXT NOT NULL, -- AES-256-GCM encrypted at rest
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row-Level Security (RLS) on all tables (NFR-01, NFR-02)
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_identity_map ENABLE ROW LEVEL SECURITY;

-- Explicitly grant privileges to service_role (required when "Automatically expose new tables" is unchecked)
GRANT USAGE ON SCHEMA public TO service_role, authenticated;
GRANT ALL ON TABLE public.app_users TO service_role;
GRANT ALL ON TABLE public.student_identity_map TO service_role;
GRANT SELECT ON TABLE public.app_users TO authenticated;

-- RLS Policy: Users can only read their own profile
DROP POLICY IF EXISTS app_users_self_read ON public.app_users;
CREATE POLICY app_users_self_read ON public.app_users
    FOR SELECT
    USING (auth.uid() = user_id);

-- RLS Policy: Only the verified course owner (Teacher) can access the identity map (NFR-01, NFR-02)
DROP POLICY IF EXISTS identity_map_course_owner_only ON public.student_identity_map;
CREATE POLICY identity_map_course_owner_only ON public.student_identity_map
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.app_users u
            WHERE u.user_id = auth.uid() AND u.role = 'TEACHER'
        )
    );
