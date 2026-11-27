-- ==============================================================================
-- 003 · Module 1 masked script storage (NFR-02) + administrator purge audit
-- ------------------------------------------------------------------------------
-- * Creates a PRIVATE Supabase Storage bucket that only ever receives the
--   header-masked (AI-safe) copy of each script page. Unmasked originals never
--   leave the teacher's browser.
-- * Creates an index table of stored objects and an audit table for
--   administrator "clear all exam files" operations.
-- * Nothing here is reachable with the anon / authenticated keys: the FastAPI
--   backend uses the service-role key and enforces TEACHER / ADMIN roles itself.
-- Safe to re-run.
-- ==============================================================================
BEGIN;

-- 1. Private bucket (10 MB per object, JPEG/PNG only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exam-scripts-masked', 'exam-scripts-masked', FALSE, 10485760, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Index of stored masked pages
CREATE TABLE IF NOT EXISTS public.module1_script_files (
    file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id TEXT NOT NULL UNIQUE,
    assessment_id TEXT NOT NULL,
    script_code TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 10),
    mask_status TEXT NOT NULL CHECK (mask_status IN ('MASKED', 'NO_HEADER')),
    object_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    uploaded_by_username TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS module1_script_files_script_idx
    ON public.module1_script_files (assessment_id, script_code);

-- 3. Audit trail of administrator purges
CREATE TABLE IF NOT EXISTS public.module1_storage_purges (
    purge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purged_by_username TEXT NOT NULL,
    files_deleted INTEGER NOT NULL DEFAULT 0,
    bytes_deleted BIGINT NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Lock both tables down to the service role only
ALTER TABLE public.module1_script_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module1_storage_purges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module1_script_files FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.module1_storage_purges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.module1_script_files TO service_role;
GRANT ALL ON public.module1_storage_purges TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
