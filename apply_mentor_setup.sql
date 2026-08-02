-- =============================================================================
-- CampusEventX — Mentor Applications Setup (Student Apply Flow)
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- 1. CREATE MENTOR APPLICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  expertise       TEXT NOT NULL,
  bio             TEXT,
  available_slots TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, status) -- Prevent multiple pending applications per user
);

-- 2. ENABLE RLS
ALTER TABLE public.mentor_applications ENABLE ROW LEVEL SECURITY;

-- 3. POLICIES FOR MENTOR APPLICATIONS
DROP POLICY IF EXISTS "mentor_apps_self_read"   ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_self_insert" ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_admin_read"  ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_apps_admin_update" ON public.mentor_applications;

-- Students can read their own applications
CREATE POLICY "mentor_apps_self_read" ON public.mentor_applications
  FOR SELECT USING (auth.uid() = user_id);

-- Students can insert their own application
CREATE POLICY "mentor_apps_self_insert" ON public.mentor_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can read all applications
CREATE POLICY "mentor_apps_admin_read" ON public.mentor_applications
  FOR SELECT USING (public.is_admin());

-- Admins can update status (approve/reject)
CREATE POLICY "mentor_apps_admin_update" ON public.mentor_applications
  FOR UPDATE USING (public.is_admin());

-- Done! ✅
