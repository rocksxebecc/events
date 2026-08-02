-- =============================================================================
-- CampusEventX — Social Feed Post Deletion RLS Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- Enable RLS on social_posts
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

-- Drop previous DELETE policy if present
DROP POLICY IF EXISTS "social_posts_delete" ON public.social_posts;

-- Allow users to delete their own posts (or admins to delete any post)
CREATE POLICY "social_posts_delete"
  ON public.social_posts FOR DELETE
  USING (
    auth.uid() = user_id
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- Verify policy
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'social_posts';
