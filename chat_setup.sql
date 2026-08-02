-- =============================================================================
-- CampusEventX — Peer-to-Peer & Mentorship Chat Database Table Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- 1. CREATE CHAT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    TEXT NOT NULL,
  receiver_id  TEXT NOT NULL,
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 3. POLICIES
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;

-- Allow reading all chat messages (filtered per 1-on-1 pair in app logic)
CREATE POLICY "chat_messages_select"
  ON public.chat_messages FOR SELECT
  USING (true);

-- Allow inserting chat messages
CREATE POLICY "chat_messages_insert"
  ON public.chat_messages FOR INSERT
  WITH CHECK (true);

-- 4. VERIFY TABLE CREATION
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chat_messages';
