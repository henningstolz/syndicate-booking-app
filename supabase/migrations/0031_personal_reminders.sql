-- Personal reminders: dates that belong to a PERSON, not to a group (medical, ratings and whatever else
-- they add), shown under Account, Reminders, with the days remaining and an expired warning.
--
-- * `personal_reminders`: a name and an optional date each, at most 30 per person. The person reads and
--   changes only their own rows (row-level security). Nobody else can see them: not group admins, not other
--   members, not the platform admin; they are not part of any group's data export. If the account is deleted,
--   the rows go with it.
-- * Everyone gets three starter items the first time they open the page: Medical, SEP/MEP Rating and
--   IR/IMC Rating (the last with the warning "EXPIRED - DO NOT FLY IMC!"). `ensure_personal_reminders()` makes
--   them once (`personal_reminder_seed` remembers that it did, so a person who deletes them all does not get
--   them back). The warning text can only be set by that function, never by the app's users.
--
-- Additive: run it BEFORE pushing the matching code.

create table public.personal_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  due_date date,
  position integer not null default 0,
  -- Shown instead of plain "EXPIRED" once the date has passed (only the starter items use it).
  expired_text text check (char_length(expired_text) between 1 and 60),
  created_at timestamptz not null default now()
);

create index personal_reminders_user_idx on public.personal_reminders (user_id, position, created_at);

alter table public.personal_reminders enable row level security;

create policy "people can view their own reminders"
  on public.personal_reminders for select
  using (user_id = auth.uid());

create policy "people can add their own reminders"
  on public.personal_reminders for insert
  with check (user_id = auth.uid());

create policy "people can change their own reminders"
  on public.personal_reminders for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "people can delete their own reminders"
  on public.personal_reminders for delete
  using (user_id = auth.uid());

-- At most 30 per person; a new one goes to the end of the list; labels are stored trimmed; and the warning
-- text is only ever set by the starter-item function (a statement run directly by a signed-in person has
-- current_user = authenticated, the function runs as its owner).
create function public.personal_reminders_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_max integer;
begin
  select count(*), coalesce(max(position), 0) into v_count, v_max
  from public.personal_reminders where user_id = new.user_id;
  if v_count >= 30 then
    raise exception 'personal_reminders_limit: at most 30 reminders per person';
  end if;
  if new.position is null or new.position = 0 then
    new.position := v_max + 1;
  end if;
  new.label := btrim(new.label);
  if current_user in ('authenticated', 'anon') then
    new.expired_text := null;
  end if;
  return new;
end;
$$;

create trigger personal_reminders_before_insert
  before insert on public.personal_reminders
  for each row execute function public.personal_reminders_before_insert();

-- A reminder cannot be handed to another person, its warning text cannot be changed by the app's users, and
-- its label is stored trimmed.
create function public.personal_reminders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'a reminder cannot move to another person';
  end if;
  if current_user in ('authenticated', 'anon') then
    new.expired_text := old.expired_text;
  end if;
  new.label := btrim(new.label);
  return new;
end;
$$;

create trigger personal_reminders_before_update
  before update on public.personal_reminders
  for each row execute function public.personal_reminders_before_update();

-- Remembers that a person has had their starter items, so deleting them all does not bring them back.
create table public.personal_reminder_seed (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seeded_at timestamptz not null default now()
);

alter table public.personal_reminder_seed enable row level security;
revoke all on table public.personal_reminder_seed from anon, authenticated;

-- Create the caller's three starter items, once. Safe to call every time the page opens.
create function public.ensure_personal_reminders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  insert into public.personal_reminder_seed (user_id) values (auth.uid()) on conflict do nothing;
  if found then
    insert into public.personal_reminders (user_id, label, position, expired_text) values
      (auth.uid(), 'Medical', 1, null),
      (auth.uid(), 'SEP/MEP Rating', 2, null),
      (auth.uid(), 'IR/IMC Rating', 3, 'EXPIRED - DO NOT FLY IMC!');
    return jsonb_build_object('result', 'ok', 'created', true);
  end if;
  return jsonb_build_object('result', 'ok', 'created', false);
end;
$$;

revoke all on function public.ensure_personal_reminders() from public, anon;
grant execute on function public.ensure_personal_reminders() to authenticated;
