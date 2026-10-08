-- A stand-in for Supabase's sign-in tables, only for the backup self-test's
-- pretend "live" database.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  email varchar(255),
  encrypted_password varchar(255),
  created_at timestamptz default now(),
  raw_user_meta_data jsonb
);
create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  email text generated always as (lower(identity_data ->> 'email')) stored
);
-- What Supabase gives a new table in public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
