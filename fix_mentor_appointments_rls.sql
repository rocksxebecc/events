-- =============================================================================
-- FIX: mentor_appointments RLS — Allow students AND mentors to see bookings
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- STEP 1: Drop ALL existing restrictive policies on mentor_appointments
DROP POLICY IF EXISTS "appointments_self_read"   ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_self_insert" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_self_delete" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_admin_read"  ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_public_read" ON public.mentor_appointments;
DROP POLICY IF EXISTS "appointments_mentor_read" ON public.mentor_appointments;

-- STEP 2: Create a permissive SELECT policy so BOTH students and mentors can see appointments.
--   - Students see their own bookings (user_id = auth.uid())
--   - Mentors see incoming student bookings (mentor_id belongs to them)
CREATE POLICY "appointments_any_party_read"
  ON public.mentor_appointments
  FOR SELECT
  USING (
    -- The student who booked it
    auth.uid() = user_id
    OR
    -- The mentor who owns the slot (look up mentor record by user_id)
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    -- Admin can see all
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 3: Allow any authenticated user to insert their own bookings
CREATE POLICY "appointments_self_insert"
  ON public.mentor_appointments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- STEP 4: Allow student or mentor or admin to delete/cancel
CREATE POLICY "appointments_self_delete"
  ON public.mentor_appointments
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 5: Allow mentor_id to be read from mentors table (ensure public read on mentors)
DROP POLICY IF EXISTS "mentors_public_read" ON public.mentors;
CREATE POLICY "mentors_public_read" ON public.mentors FOR SELECT USING (true);

-- STEP 6: Verify the policies were created
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('mentor_appointments', 'mentors')
ORDER BY tablename, policyname;
