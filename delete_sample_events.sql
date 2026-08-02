-- ============================================================
-- DELETE ALL EVENTS (cleans up sample/example events)
-- Run this in Supabase SQL Editor to wipe the events table.
-- ============================================================
DELETE FROM public.enrollments; -- Remove enrollments first (foreign key)
DELETE FROM public.events;      -- Then delete all events
