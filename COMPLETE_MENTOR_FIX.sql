-- =============================================================================
-- CampusEventX — ALL-IN-ONE MASTER MENTORSHIP & APPOINTMENTS FIX
-- Copy and paste this ENTIRE block into Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- 1. FIX APPOINTMENT STATUS CONSTRAINT & DEFAULTS
ALTER TABLE public.mentor_appointments
  DROP CONSTRAINT IF EXISTS mentor_appointments_status_check;

ALTER TABLE public.mentor_appointments
  ADD CONSTRAINT mentor_appointments_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));

ALTER TABLE public.mentor_appointments
  ALTER COLUMN status SET DEFAULT 'pending';

-- 2. ALLOW RE-BOOKING CANCELLED SLOTS (Replace rigid UNIQUE with Partial Unique Index)
ALTER TABLE public.mentor_appointments
  DROP CONSTRAINT IF EXISTS mentor_appointments_mentor_id_slot_time_key;

DROP INDEX IF EXISTS idx_mentor_appointments_active_slot;

CREATE UNIQUE INDEX idx_mentor_appointments_active_slot
  ON public.mentor_appointments (mentor_id, slot_time)
  WHERE (status != 'cancelled');

-- 3. ENABLE RLS ON TABLES
ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_appointments ENABLE ROW LEVEL SECURITY;

-- 4. FIX MENTORS TABLE RLS (Public Read)
DROP POLICY IF EXISTS "mentors_public_read" ON public.mentors;
CREATE POLICY "mentors_public_read" ON public.mentors FOR SELECT USING (true);

-- 5. FIX MENTOR APPOINTMENTS RLS (SELECT, INSERT, UPDATE, DELETE for both Student & Mentor)
DROP POLICY IF EXISTS "appointments_self_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_public_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_mentor_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_any_party_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_party_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_admin_read" ON public.mentor_appointments;

DROP POLICY IF EXISTS "appointments_self_insert" ON public.mentor_appointments;

DROP POLICY IF EXISTS "appointments_mentor_update" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_party_update" ON public.mentor_appointments;

DROP POLICY IF EXISTS "appointments_self_delete" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_party_delete" ON public.mentor_appointments;

-- SELECT Policy
CREATE POLICY "appointments_party_read"
  ON public.mentor_appointments FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- INSERT Policy
CREATE POLICY "appointments_self_insert"
  ON public.mentor_appointments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE Policy (Student who booked OR Mentor OR Admin)
CREATE POLICY "appointments_party_update"
  ON public.mentor_appointments FOR UPDATE
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- DELETE Policy (Student who booked OR Mentor OR Admin)
CREATE POLICY "appointments_party_delete"
  ON public.mentor_appointments FOR DELETE
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 6. VERIFY POLICIES
SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('mentor_appointments', 'mentors') ORDER BY tablename, policyname;
