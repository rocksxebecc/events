-- ==========================================
-- FRIEND REQUESTS TABLE — FULL SETUP SCRIPT
-- Run this entirely in Supabase SQL Editor
-- ==========================================

-- Step 1: Drop existing table and recreate with correct schema
DROP TABLE IF EXISTS public.friend_requests;

CREATE TABLE public.friend_requests (
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

-- Step 2: Enable RLS and grant full open access to anon/authenticated users
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friend_requests_all" ON public.friend_requests;
CREATE POLICY "friend_requests_all" ON public.friend_requests
  FOR ALL USING (true) WITH CHECK (true);

-- Step 3: Grant table-level permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO authenticated;
