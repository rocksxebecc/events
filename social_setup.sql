-- =============================================================================
-- CampusEventX — Social Hub & Friend System SQL Setup
-- Run this query in your Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================================

-- 1. SOCIAL POSTS TABLE
CREATE TABLE IF NOT EXISTS public.social_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name  TEXT,
  author_dept  TEXT,
  author_year  TEXT,
  type         TEXT NOT NULL DEFAULT 'achievement',
  content      TEXT NOT NULL,
  image        TEXT,
  likes_count  INT4 DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. FRIEND REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     TEXT NOT NULL,
  receiver_id   TEXT NOT NULL,
  sender_name   TEXT,
  receiver_name TEXT,
  sender_dept   TEXT,
  sender_year   TEXT,
  receiver_dept TEXT,
  receiver_year TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Enable & Policies
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_posts_select" ON public.social_posts;
CREATE POLICY "social_posts_select" ON public.social_posts FOR SELECT USING (true);

DROP POLICY IF EXISTS "social_posts_insert" ON public.social_posts;
CREATE POLICY "social_posts_insert" ON public.social_posts FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "social_posts_update" ON public.social_posts;
CREATE POLICY "social_posts_update" ON public.social_posts FOR UPDATE USING (true);

DROP POLICY IF EXISTS "friend_requests_all" ON public.friend_requests;
CREATE POLICY "friend_requests_all" ON public.friend_requests FOR ALL USING (true) WITH CHECK (true);
