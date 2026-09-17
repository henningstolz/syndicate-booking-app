-- auth.users isn't exposed to the client API, so member names for
-- display (calendar legend, booking strips) live here instead.
alter table public.group_members
  add column display_name text;
