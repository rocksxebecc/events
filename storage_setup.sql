-- =============================================================================
-- CampusEventX — Supabase Storage Bucket Setup for Post Media (Photos & Videos)
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- 1. Create the "post-media" storage bucket (public access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-media',
  'post-media',
  true,
  52428800,  -- 50MB limit per file
  ARRAY['image/jpeg','image/jpg','image/png','image/gif','image/webp','video/mp4','video/webm','video/mov','video/quicktime','video/x-msvideo']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/gif','image/webp','video/mp4','video/webm','video/mov','video/quicktime','video/x-msvideo'];

-- 2. Storage RLS Policies — Allow public read and authenticated upload
DROP POLICY IF EXISTS "post_media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "post_media_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "post_media_owner_delete" ON storage.objects;

-- Anyone can view uploaded media
CREATE POLICY "post_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'post-media');

-- Logged-in users can upload
CREATE POLICY "post_media_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'post-media' AND auth.role() = 'authenticated');

-- Users can delete their own uploads
CREATE POLICY "post_media_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'post-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 3. Verify bucket creation
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'post-media';
