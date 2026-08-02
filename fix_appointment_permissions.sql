-- =============================================================================
-- FIX: Allow BOTH Students and Mentors to SELECT, UPDATE, and DELETE appointments
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- STEP 1: Ensure RLS is enabled on mentor_appointments
ALTER TABLE public.mentor_appointments ENABLE ROW LEVEL SECURITY;

-- STEP 2: Drop ALL previous policies to avoid conflicts
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

-- STEP 3: SELECT Policy (Student, Mentor, or Admin)
CREATE POLICY "appointments_party_read"
  ON public.mentor_appointments
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 4: INSERT Policy (Student)
CREATE POLICY "appointments_self_insert"
  ON public.mentor_appointments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- STEP 5: UPDATE Policy (Student who booked, Mentor of slot, or Admin)
CREATE POLICY "appointments_party_update"
  ON public.mentor_appointments
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR
    auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 6: DELETE Policy (Student who booked, Mentor of slot, or Admin)
CREATE POLICY "appointments_party_delete"
  ON public.mentor_appointments
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id)
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 7: Verify Policies
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'mentor_appointments' ORDER BY policyname;
