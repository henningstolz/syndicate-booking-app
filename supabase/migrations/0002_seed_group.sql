-- The first real group. group_members isn't seeded here because it
-- references auth.users rows, which don't exist until each person signs
-- up — see supabase/README.md for adding members after that.
insert into public.groups (slug, name, aircraft_registration, aircraft_type, home_base)
values ('g-bbfd', 'G-BBFD Syndicate', 'G-BBFD', 'PA28R Arrow II', 'EGLM');
