-- Closing a month: a past month's statement can be frozen.
--
-- Until now a month's statement was worked out live every time it was opened, so
-- it could still move after everyone had seen it (a late flight, a voided flight,
-- an expense, new rates). An admin can now CLOSE a finished month:
--   * the statement is saved exactly as it stood (every member, with the flights
--     and expenses behind it), with who closed it, when, and an optional note;
--   * a closed month shows the saved figures, to members (their own) and admins
--     (everyone's), with a "closed" label;
--   * no new expense can be dated in a closed month, and an expense dated in one
--     can't be voided (reopen it first);
--   * flights can still be logged or voided in a closed month (the flight log is
--     a safety record and has to stay complete), but they do not change the closed
--     figures. The admin is shown what has changed since closing ("drift") and can
--     reopen the month to take it in;
--   * an admin can REOPEN a month, with a reason. Nothing is lost: the closure stays
--     on record as reopened, the live calculation takes over again, and the month
--     can be closed again.
--
-- Rates are not blocked: changing them can never alter a closed month, because the
-- closed figures are saved, not recalculated.
--
-- cost_statement() keeps its name and arguments. The live calculation moves to an
-- internal cost_statement_live(); cost_statement() answers from the saved figures
-- when the month is closed, and otherwise from the live calculation, and adds
-- `closed`, `can_close` and `drift` to the answer.
--
-- Backwards compatible: the page that is live ignores the new fields. Run this
-- BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- The saved closures
-- ---------------------------------------------------------------------------

create table public.cost_month_closures (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  snapshot jsonb not null,
  note text check (char_length(note) <= 300),
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users (id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id),
  reopen_reason text check (char_length(reopen_reason) <= 300)
);

-- A month is closed at most once at a time; a reopened closure stays as history.
create unique index cost_month_closures_one_open
  on public.cost_month_closures (group_id, month) where reopened_at is null;

alter table public.cost_month_closures enable row level security;

-- The saved figures hold everyone's numbers, so only admins read the table; members
-- get their own part through cost_statement(). Writes go through the functions below.
create policy "admins can view month closures"
  on public.cost_month_closures for select
  using (public.is_group_admin(group_id));

-- Is the month this date falls in closed? (Internal.)
create function public.cost_month_closed(p_group_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cost_month_closures c
    where c.group_id = p_group_id
      and c.month = date_trunc('month', p_date)::date
      and c.reopened_at is null
  );
$$;

revoke all on function public.cost_month_closed(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Close and reopen
-- ---------------------------------------------------------------------------

create function public.close_cost_month(p_group_id uuid, p_month date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_live jsonb;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  -- Only a finished month (UK time) can be closed.
  if v_start >= date_trunc('month', now() at time zone 'Europe/London')::date then
    return jsonb_build_object('result', 'month_not_over');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('result', 'note_too_long');
  end if;
  if public.cost_month_closed(p_group_id, v_start) then
    return jsonb_build_object('result', 'already_closed');
  end if;

  v_live := public.cost_statement_live(p_group_id, v_start);
  if v_live->>'result' <> 'ok' then
    return v_live;
  end if;
  -- Freezing a month with no rates would freeze zeros.
  if (v_live->'rates'->>'missing')::boolean then
    return jsonb_build_object('result', 'rates_missing');
  end if;

  insert into public.cost_month_closures (group_id, month, snapshot, note, closed_by)
  values (p_group_id, v_start, v_live, v_note, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

create function public.reopen_cost_month(p_group_id uuid, p_month date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;

  update public.cost_month_closures
  set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = v_reason
  where group_id = p_group_id and month = v_start and reopened_at is null;
  if not found then
    return jsonb_build_object('result', 'not_closed');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.close_cost_month(uuid, date, text) from public, anon;
revoke all on function public.reopen_cost_month(uuid, date, text) from public, anon;
grant execute on function public.close_cost_month(uuid, date, text) to authenticated;
grant execute on function public.reopen_cost_month(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Expenses cannot be added to, or voided in, a closed month
-- ---------------------------------------------------------------------------

create or replace function public.add_cost_expense(
  p_group_id uuid,
  p_paid_by uuid,
  p_date date,
  p_description text,
  p_amount_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := btrim(coalesce(p_description, ''));
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_paid_by is null or not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = p_paid_by and m.removed_at is null
  ) then
    return jsonb_build_object('result', 'member_invalid');
  end if;
  if v_description = '' then
    return jsonb_build_object('result', 'description_required');
  end if;
  if char_length(v_description) > 120 then
    return jsonb_build_object('result', 'description_too_long');
  end if;
  if p_amount_pence is null or p_amount_pence < 1 or p_amount_pence > 10000000 then
    return jsonb_build_object('result', 'amount_invalid');
  end if;
  if p_date is null or p_date < date '2000-01-01'
     or p_date > (now() at time zone 'Europe/London')::date + 1 then
    return jsonb_build_object('result', 'date_invalid');
  end if;
  if public.cost_month_closed(p_group_id, p_date) then
    return jsonb_build_object('result', 'month_closed');
  end if;

  insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by)
  values (p_group_id, p_paid_by, p_date, v_description, p_amount_pence, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.void_cost_expense(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.cost_expenses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_expense from public.cost_expenses where id = p_id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null or not public.is_group_admin(v_expense.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;
  if public.cost_month_closed(v_expense.group_id, v_expense.incurred_on) then
    return jsonb_build_object('result', 'month_closed');
  end if;

  update public.cost_expenses
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_id and voided_at is null;
  if not found then
    return jsonb_build_object('result', 'already_voided');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- The statement: saved figures for a closed month, the live calculation otherwise
-- ---------------------------------------------------------------------------

-- The live calculation (as in 0017) keeps working under a new, internal name.
alter function public.cost_statement(uuid, date) rename to cost_statement_live;
revoke all on function public.cost_statement_live(uuid, date) from public, anon, authenticated;

create function public.cost_statement(p_group_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_start date := date_trunc('month', p_month)::date;
  v_live jsonb;
  v_admin boolean;
  v_over boolean;
  v_closure public.cost_month_closures%rowtype;
  v_closed jsonb;
  v_drift jsonb;
begin
  v_live := public.cost_statement_live(p_group_id, p_month);
  if v_live->>'result' <> 'ok' then
    return v_live;
  end if;
  v_admin := (v_live->>'is_admin')::boolean;
  v_over := v_start < date_trunc('month', now() at time zone 'Europe/London')::date;

  select * into v_closure
  from public.cost_month_closures c
  where c.group_id = p_group_id and c.month = v_start and c.reopened_at is null;

  if not found then
    return v_live || jsonb_build_object(
      'closed', null,
      'can_close', v_admin and v_over and not (v_live->'rates'->>'missing')::boolean,
      'drift', '[]'::jsonb
    );
  end if;

  v_closed := jsonb_build_object(
    'id', v_closure.id,
    'closed_at', v_closure.closed_at,
    'closed_by_name', coalesce((
      select m.display_name from public.group_members m
      where m.group_id = p_group_id and m.user_id = v_closure.closed_by
    ), 'An admin'),
    'note', v_closure.note
  );

  if v_admin then
    -- What has changed since closing: members whose total or hours are no longer
    -- what was saved.
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', coalesce(c.uid, n.uid),
        'name', coalesce(c.name, n.name),
        'closed_pence', coalesce(c.total, 0),
        'now_pence', coalesce(n.total, 0),
        'closed_tenths', coalesce(c.tenths, 0),
        'now_tenths', coalesce(n.tenths, 0)
      ) order by coalesce(c.name, n.name), coalesce(c.uid, n.uid)), '[]'::jsonb)
    into v_drift
    from (
      select m->>'user_id' as uid, m->>'name' as name,
             (m->>'total_pence')::integer as total, (m->>'hours_tenths')::integer as tenths
      from jsonb_array_elements(v_closure.snapshot->'members') m
    ) c
    full join (
      select m->>'user_id' as uid, m->>'name' as name,
             (m->>'total_pence')::integer as total, (m->>'hours_tenths')::integer as tenths
      from jsonb_array_elements(v_live->'members') m
    ) n on n.uid = c.uid
    where coalesce(c.total, 0) <> coalesce(n.total, 0)
       or coalesce(c.tenths, 0) <> coalesce(n.tenths, 0);

    return v_closure.snapshot || jsonb_build_object(
      'is_admin', true, 'closed', v_closed, 'can_close', false, 'drift', v_drift
    );
  end if;

  -- A member gets only their own part of the saved figures.
  return v_closure.snapshot || jsonb_build_object(
    'is_admin', false,
    'members', coalesce((select jsonb_agg(m) from jsonb_array_elements(v_closure.snapshot->'members') m where m->>'user_id' = v_me::text), '[]'::jsonb),
    'flights', coalesce((select jsonb_agg(f) from jsonb_array_elements(v_closure.snapshot->'flights') f where f->>'user_id' = v_me::text), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_closure.snapshot->'expenses') e where e->>'user_id' = v_me::text), '[]'::jsonb),
    'closed', v_closed,
    'can_close', false,
    'drift', '[]'::jsonb
  );
end;
$$;

revoke all on function public.cost_statement(uuid, date) from public, anon;
grant execute on function public.cost_statement(uuid, date) to authenticated;
