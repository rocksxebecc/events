-- =============================================================================
-- CampusEventX — User Data Migration
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- Adds full user tracking fields to profiles table
-- =============================================================================

-- 1. Add missing tracking columns (safe — uses IF NOT EXISTS equivalent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_count  INT4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS bio          TEXT,
  ADD COLUMN IF NOT EXISTS is_verified  BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill last_login = created_at for all existing users who have logged in
UPDATE public.profiles
SET last_login = created_at
WHERE last_login IS NULL AND status = 'active';

-- 3. Create or replace the function that logs + updates profile on each login
CREATE OR REPLACE FUNCTION public.update_user_login_stats(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    last_login  = NOW(),
    last_seen   = NOW(),
    login_count = COALESCE(login_count, 0) + 1
  WHERE id = p_user_id;
END;
$$;

-- 4. Create or replace trigger to mark email as verified when user confirms email
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET is_verified = true
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_email_confirmed ON auth.users;
CREATE TRIGGER on_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL)
  EXECUTE PROCEDURE public.handle_email_confirmed();

-- 5. Grant execute on the login stats function to authenticated users
GRANT EXECUTE ON FUNCTION public.update_user_login_stats(UUID) TO authenticated;

-- Done!
