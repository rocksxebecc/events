-- =============================================================================
-- CampusEventX — FIX: Mentors Visibility for All Users
-- Run this ENTIRE script in Supabase Dashboard → SQL Editor → New query
-- =============================================================================

-- STEP 1: Add missing columns if they don't exist
ALTER TABLE public.mentors ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.mentors ADD COLUMN IF NOT EXISTS name TEXT;

-- STEP 2: Make sure RLS is enabled
ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;

-- STEP 3: Drop ALL existing mentor policies (clean slate)
DROP POLICY IF EXISTS "mentors_public_read"  ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_insert" ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_update" ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_delete" ON public.mentors;

-- STEP 4: Re-create policies
-- ✅ This is the critical one — ALL users (including unauthenticated) can READ mentors
CREATE POLICY "mentors_public_read"
  ON public.mentors
  FOR SELECT
  USING (true);

-- Only admins can INSERT mentors
CREATE POLICY "mentors_admin_insert"
  ON public.mentors
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Only admins can UPDATE mentors
CREATE POLICY "mentors_admin_update"
  ON public.mentors
  FOR UPDATE
  USING (public.is_admin());

-- Only admins can DELETE mentors
CREATE POLICY "mentors_admin_delete"
  ON public.mentors
  FOR DELETE
  USING (public.is_admin());

-- STEP 5: Verify — run this SELECT to confirm policies exist
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'mentors'
ORDER BY policyname;
