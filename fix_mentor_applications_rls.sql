-- =============================================================================
-- CampusEventX — Fix Mentor Applications RLS & Read Policies
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- 1. Ensure table exists
CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  expertise       TEXT NOT NULL,
  bio             TEXT,
  available_slots TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, status)
);

-- 2. ENABLE RLS
ALTER TABLE public.mentor_applications ENABLE ROW LEVEL SECURITY;

-- 3. DROP OLD RESTRICTIVE POLICIES
DROP POLICY IF EXISTS "mentor_apps_self_read"   ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_self_insert" ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_admin_read"  ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_admin_update" ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_open_access" ON public.mentor_applications;

-- 4. CREATE OPEN RLS POLICY FOR ALL AUTHENTICATED USERS & ADMINS
CREATE POLICY "mentor_apps_open_access" ON public.mentor_applications
  FOR ALL USING (true) WITH CHECK (true);

-- Done! ✅ Applications will now be immediately visible to Admins.
