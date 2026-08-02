-- =============================================================================
-- FIX: Allow re-booking cancelled slots in Supabase
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- 1. Remove old rigid UNIQUE(mentor_id, slot_time) constraint if it exists
ALTER TABLE public.mentor_appointments
  DROP CONSTRAINT IF EXISTS mentor_appointments_mentor_id_slot_time_key;

-- 2. Delete any old cancelled appointment rows that block re-booking
DELETE FROM public.mentor_appointments WHERE status = 'cancelled';

-- 3. Create a Partial Unique Index so ONLY active (pending / confirmed) bookings block a slot
DROP INDEX IF EXISTS idx_mentor_appointments_active_slot;

CREATE UNIQUE INDEX idx_mentor_appointments_active_slot
  ON public.mentor_appointments (mentor_id, slot_time)
  WHERE (status != 'cancelled');
