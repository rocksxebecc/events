-- =============================================================================
-- CampusEventX — Career Mentors & Appointment Setup (User-Linked Edition)
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- 1. CREATE MENTORS TABLE (Linked directly to profiles / auth.users)
CREATE TABLE IF NOT EXISTS public.mentors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT,
  title           TEXT NOT NULL,              -- e.g. "Senior Software Engineer @ Google"
  expertise       TEXT NOT NULL,              -- e.g. "AI/ML, System Design"
  bio             TEXT,                       -- Mentorship bio
  available_slots TEXT[] DEFAULT '{}',        -- e.g. ['Mon 10:00 AM', 'Wed 2:00 PM']
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure user_id and name columns exist if table was created with an older schema
ALTER TABLE public.mentors ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.mentors ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. CREATE MENTOR APPOINTMENTS TABLE
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
  UNIQUE (mentor_id, slot_time)  -- prevent double-booking the same slot
);

-- 3. ENABLE RLS
ALTER TABLE public.mentors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_appointments ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES FOR MENTORS TABLE
DROP POLICY IF EXISTS "mentors_public_read"  ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_insert" ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_update" ON public.mentors;
DROP POLICY IF EXISTS "mentors_admin_delete" ON public.mentors;

CREATE POLICY "mentors_public_read"  ON public.mentors FOR SELECT USING (true);

CREATE POLICY "mentors_admin_insert" ON public.mentors FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "mentors_admin_update" ON public.mentors FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "mentors_admin_delete" ON public.mentors FOR DELETE
  USING (public.is_admin());

-- 5. POLICIES FOR MENTOR APPOINTMENTS TABLE
DROP POLICY IF EXISTS "appointments_self_read"      ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_self_insert"    ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_self_delete"    ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_admin_read"     ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_any_party_read" ON public.mentor_appointments;

-- Both the STUDENT who booked AND the MENTOR who owns the slot can read it
CREATE POLICY "appointments_any_party_read"
  ON public.mentor_appointments
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "appointments_self_insert" ON public.mentor_appointments FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "appointments_self_delete" ON public.mentor_appointments FOR DELETE
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

