-- =============================================================================
-- CampusEventX — Supabase Setup Script
-- Run this ONCE in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- 1. PROFILES TABLE
-- Extends auth.users with student/admin role and profile details
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned', 'blocked')),
  email      TEXT,
  name       TEXT,
  roll       TEXT,
  dept       TEXT,
  year       TEXT,
  phone      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'General',
  date        TIMESTAMPTZ NOT NULL,
  venue       TEXT NOT NULL,
  speaker     TEXT,
  capacity    INT4 DEFAULT 99999,
  banner      TEXT,
  description TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure capacity is optional on existing database tables
ALTER TABLE public.events ALTER COLUMN capacity DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN capacity SET DEFAULT 99999;


-- 3. ENROLLMENTS TABLE
CREATE TABLE IF NOT EXISTS public.enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id, user_id)   -- prevent duplicate enrollments
);

-- 4. ACTIVITY LOGS TABLE
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action_type TEXT NOT NULL,
  details     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. MENTORS TABLE
CREATE TABLE IF NOT EXISTS public.mentors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  title           TEXT NOT NULL,
  expertise       TEXT NOT NULL,
  bio             TEXT,
  avatar          TEXT,
  available_slots TEXT[] DEFAULT '{}',
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. MENTOR APPOINTMENTS TABLE
CREATE TABLE IF NOT EXISTS public.mentor_appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID NOT NULL REFERENCES public.mentors(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name    TEXT,
  student_email   TEXT,
  slot_time       TEXT NOT NULL,
  guidance_topic  TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mentor_id, slot_time)
);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs        ENABLE ROW LEVEL SECURITY;

-- ACTIVITY LOGS policies
DROP POLICY IF EXISTS "activity_logs_insert" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_admin_select" ON public.activity_logs;

CREATE POLICY "activity_logs_insert" ON public.activity_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "activity_logs_admin_select" ON public.activity_logs
  FOR SELECT USING (public.is_admin());



-- PROFILES policies
DROP POLICY IF EXISTS "profiles_self_read"   ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_all"    ON public.profiles;

-- Authenticated users (and admins) can read profiles for directory/mentors/roster
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);


-- =============================================================================
-- SECURITY DEFINER FUNCTION: check admin without triggering RLS recursion
-- This queries profiles as the function owner (bypassing RLS), preventing the
-- infinite-recursion error that happens when policies reference their own table.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Admins can read ALL profiles (uses is_admin() — no recursion)
CREATE POLICY "profiles_admin_read" ON public.profiles FOR SELECT
  USING (public.is_admin());

-- EVENTS policies
DROP POLICY IF EXISTS "events_public_read"  ON public.events;
DROP POLICY IF EXISTS "events_admin_insert" ON public.events;
DROP POLICY IF EXISTS "events_admin_update" ON public.events;
DROP POLICY IF EXISTS "events_admin_delete" ON public.events;

-- Anyone (incl. unauthenticated) can read events
CREATE POLICY "events_public_read"  ON public.events FOR SELECT USING (true);
-- Only admins can create, update, delete events
CREATE POLICY "events_admin_insert" ON public.events FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "events_admin_update" ON public.events FOR UPDATE USING (public.is_admin());
CREATE POLICY "events_admin_delete" ON public.events FOR DELETE USING (public.is_admin());

-- ENROLLMENTS policies
DROP POLICY IF EXISTS "enrollments_self_read"   ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_self_insert" ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_self_delete" ON public.enrollments;
DROP POLICY IF EXISTS "enrollments_admin_read"  ON public.enrollments;

-- Students can only see & create their own enrollments
CREATE POLICY "enrollments_self_read"   ON public.enrollments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "enrollments_self_insert" ON public.enrollments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "enrollments_self_delete" ON public.enrollments FOR DELETE USING (auth.uid() = user_id);
-- Admins can read ALL enrollments
CREATE POLICY "enrollments_admin_read" ON public.enrollments FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());


-- =============================================================================
-- AUTO-CREATE PROFILE ON SIGNUP (Trigger)
-- This fires every time a new user registers via Supabase Auth
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    CASE WHEN LOWER(NEW.email) = 'nikhildeosani@gmail.com' THEN 'admin' ELSE 'student' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================================
-- MAKE SPECIFIC USER AN ADMIN:
-- If nikhildeosani@gmail.com is already registered, run this to grant Admin:
-- =============================================================================
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE LOWER(email) = 'nikhildeosani@gmail.com');
