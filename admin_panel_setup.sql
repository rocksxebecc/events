-- =============================================================================
-- CampusEventX — Admin Panel Database Extension & Migration
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- 1. EXTEND PROFILES TABLE WITH STATUS AND EMAIL
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned', 'blocked'));

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Update profile emails from auth.users if available
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- 2. CREATE ACTIVITY LOGS TABLE
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action_type TEXT NOT NULL,  -- e.g. 'USER_SIGNUP', 'EVENT_CREATED', 'EVENT_ENROLLED', 'USER_BANNED', etc.
  details     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing activity_logs policies if any
DROP POLICY IF EXISTS "activity_logs_insert_authenticated" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_admin_select" ON public.activity_logs;

-- Any authenticated user can record activity logs (e.g. signup, enrollment)
CREATE POLICY "activity_logs_insert_authenticated" ON public.activity_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Only Admins can view activity logs
CREATE POLICY "activity_logs_admin_select" ON public.activity_logs
  FOR SELECT USING (public.is_admin());

-- 3. PROFILES ADMIN POLICIES FOR BAN/BLOCK/DELETE
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_delete" ON public.profiles;

-- Admins can update any profile (ban, block, unban, change role)
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- Admins can delete any profile
CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE USING (public.is_admin());

-- 4. AUTO-LOG NEW SIGNUPS TRIGGER
CREATE OR REPLACE FUNCTION public.log_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_logs (user_id, user_email, action_type, details)
  VALUES (NEW.id, NEW.email, 'USER_SIGNUP', 'New user registered on CampusEventX');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_signup_log ON auth.users;
CREATE TRIGGER on_auth_user_signup_log
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.log_new_user_signup();
