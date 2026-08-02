-- =============================================================================
-- CampusEventX — Delete Sample Mentors from Supabase
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================

DELETE FROM public.mentors 
WHERE title ILIKE '%DeepMind%' 
   OR title ILIKE '%AWS%' 
   OR title ILIKE '%Stripe%'
   OR title ILIKE '%Senior Cloud Architect%'
   OR title ILIKE '%VP of Product Design%'
   OR title ILIKE '%AI Research Lead%';

-- Done! ✅ Sample mentors deleted from Supabase database.
