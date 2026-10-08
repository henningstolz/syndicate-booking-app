-- A little data for the self-test's pretend "live" database, including text
-- that is awkward to copy (quotes, accents, a newline).
insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@example.test', '$2a$10$abcdefghijklmnopqrstuv', '{"name": "Alice O''Neil"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@example.test', '$2a$10$zyxwvutsrqponmlkjihgfe', '{}');
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('alice@example.test', '00000000-0000-0000-0000-0000000000a1', '{"email": "alice@example.test"}', 'email'),
  ('bob@example.test', '00000000-0000-0000-0000-0000000000b2', '{"email": "bob@example.test"}', 'email');
insert into public.groups (id, slug, name, aircraft_registration) values
  ('11111111-1111-1111-1111-111111111111', 'test-group', 'Test Group', 'G-TEST');
insert into public.group_members (group_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'admin', 'Alice'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'member', 'Bob');
insert into public.squawks (group_id, author_id, message) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', E'Brakes feel soft – "check" before Saturday\nCafé stop at Sywell?'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'Fuel card is in the glovebox');
insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values
  ('11111111-1111-1111-1111-111111111111', '2026-01-01', 12000, 6500, '00000000-0000-0000-0000-0000000000a1');
insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', '2026-10-03', 'Fuel at Sywell', 18400, '00000000-0000-0000-0000-0000000000a1');
