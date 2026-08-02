-- =============================================================================
-- CampusEventX — System Notifications Database Table & RLS Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- 1. CREATE NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,          -- Target user UUID, or 'ALL' for broadcast notifications
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'info',  -- 'event', 'mentor', 'chat', 'friend', 'booking', 'info'
  link_tab     TEXT,                   -- Tab target to navigate on click
  is_read      BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. POLICIES
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;

-- Allow users to view notifications targeted to them or broadcast to 'ALL'
CREATE POLICY "notifications_select"
  ON public.notifications FOR SELECT
  USING (user_id = 'ALL' OR user_id = auth.uid()::text OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Allow inserting notifications
CREATE POLICY "notifications_insert"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- Allow updating read status
CREATE POLICY "notifications_update"
  ON public.notifications FOR UPDATE
  USING (user_id = 'ALL' OR user_id = auth.uid()::text OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Allow deleting notifications
CREATE POLICY "notifications_delete"
  ON public.notifications FOR DELETE
  USING (user_id = 'ALL' OR user_id = auth.uid()::text OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- 4. VERIFY TABLE CREATION
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notifications';
