-- Empties a TEST Supabase project completely: the app's tables, functions and
-- data, the migration bookkeeping, and every test sign-in. After this the
-- project looks brand new. Run by `npm run db:reset-test` and by the restore
-- drill, both of which refuse to touch the live project.
drop schema if exists test_tooling cascade;
drop schema if exists public cascade;
create schema public;
grant usage, create on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
delete from auth.users;
