-- =============================================================================
-- Add username column to profiles table in Supabase
-- Run this query in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
