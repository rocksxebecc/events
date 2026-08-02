-- =============================================================================
-- FIX: Add 'pending' status + mentor Accept/Update RLS policy
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- STEP 1: Drop the existing status CHECK constraint so we can add 'pending'
ALTER TABLE public.mentor_appointments
  DROP CONSTRAINT IF EXISTS mentor_appointments_status_check;

-- STEP 2: Add updated constraint that includes 'pending'
ALTER TABLE public.mentor_appointments
  ADD CONSTRAINT mentor_appointments_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));

-- STEP 3: Change default status for new bookings to 'pending'
ALTER TABLE public.mentor_appointments
  ALTER COLUMN status SET DEFAULT 'pending';

-- STEP 4: Add UPDATE policy so mentors can accept/update their bookings
DROP POLICY IF EXISTS "appointments_mentor_update" ON public.mentor_appointments;

CREATE POLICY "appointments_mentor_update"
  ON public.mentor_appointments
  FOR UPDATE
  USING (
    -- Mentor who owns the slot can update status
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    -- Admin can update anything
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT user_id FROM public.mentors WHERE id = mentor_appointments.mentor_id
    )
    OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- STEP 5: Verify
SELECT column_name, column_default, data_type
FROM information_schema.columns
WHERE table_name = 'mentor_appointments' AND column_name = 'status';

SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'mentor_appointments'
ORDER BY policyname;
