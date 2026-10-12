-- The file store for documents and receipts: a PRIVATE bucket called `documents`, and
-- the rules on who may read, write and delete in it. Files live at
-- `<group id>/<random id>.<ext>`, so the first folder says which group a file belongs to.
--
-- * bucket: private, 10 MB per file, photos (JPEG, PNG, WebP, HEIC/HEIF), PDF, Word,
--   Excel, plain text and CSV only.
-- * read:   a member of the group, for files in their group's folder (the app hands
--   out links that expire after a few minutes).
-- * upload: a member of the group, into their group's folder only, one level deep,
--   while the group has room (200 MB). Nobody can overwrite an existing file (there
--   is no update rule).
-- * delete: the member who uploaded it, or an admin of the group.
--
-- Safe to run again (it replaces the bucket settings and the rules): run it again
-- after restoring the database into a fresh Supabase project, because the file store's
-- rules are not part of the database backup. Run it BEFORE pushing the matching code.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members can read their group's documents" on storage.objects;
create policy "members can read their group's documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_group_member(public.document_folder_group(name))
  );

drop policy if exists "members can upload into their group's folder" on storage.objects;
create policy "members can upload into their group's folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.is_group_member(public.document_folder_group(name))
    and array_length(storage.foldername(name), 1) = 1
    and public.document_quota_ok(public.document_folder_group(name))
  );

drop policy if exists "uploader or admin can delete documents" on storage.objects;
create policy "uploader or admin can delete documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.is_group_member(public.document_folder_group(name))
    and (owner = auth.uid() or public.is_group_admin(public.document_folder_group(name)))
  );
