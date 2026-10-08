-- Payment tracking: who has paid their statement.
--
-- An admin records a PAYMENT against a member and a month that has been closed (so
-- the amount owed is final): the amount, the date it arrived, and an optional note.
-- A payment can be partial or larger than the bill; a negative amount is money paid
-- back to the member (for example when their statement was a credit). A member's
-- BALANCE for the month is their statement total minus the payments recorded for
-- it: zero means settled, above zero is still to pay, below zero is owed to them.
--
-- Payments are never edited or deleted: an admin voids a wrong one with a reason,
-- like everything else here. They stay with the month when it is reopened.
--
-- cost_statement() now also returns, for every member, `paid_pence` and
-- `balance_pence`, and a `payments` list (an admin sees everyone's, a member their
-- own). Members read their own payments directly too; admins read all.
--
-- Backwards compatible: the page that is live ignores the new fields. Run this
-- BEFORE pushing the matching code.

create table public.cost_payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  month date not null check (month = date_trunc('month', month)::date),
  amount_pence integer not null check (amount_pence <> 0 and abs(amount_pence) <= 10000000),
  paid_on date not null,
  note text check (char_length(note) <= 120),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 300)
);

create index cost_payments_month_idx on public.cost_payments (group_id, month, user_id);

alter table public.cost_payments enable row level security;

-- Admins see every payment; a member sees their own. Writes go through the functions.
create policy "admins and the payer can view payments"
  on public.cost_payments for select
  using (
    public.is_group_admin(group_id)
    or (public.is_group_member(group_id) and user_id = auth.uid())
  );

create function public.record_cost_payment(
  p_group_id uuid,
  p_user_id uuid,
  p_month date,
  p_amount_pence integer,
  p_paid_on date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  -- Only a closed month has a final amount to pay.
  if not public.cost_month_closed(p_group_id, v_start) then
    return jsonb_build_object('result', 'month_not_closed');
  end if;
  -- The member must have a line on that month's saved statement.
  if p_user_id is null or not exists (
    select 1
    from public.cost_month_closures c, jsonb_array_elements(c.snapshot->'members') m
    where c.group_id = p_group_id and c.month = v_start and c.reopened_at is null
      and m->>'user_id' = p_user_id::text
  ) then
    return jsonb_build_object('result', 'member_invalid');
  end if;
  if p_amount_pence is null or p_amount_pence = 0 or abs(p_amount_pence) > 10000000 then
    return jsonb_build_object('result', 'amount_invalid');
  end if;
  if p_paid_on is null or p_paid_on < date '2000-01-01'
     or p_paid_on > (now() at time zone 'Europe/London')::date + 1 then
    return jsonb_build_object('result', 'date_invalid');
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    return jsonb_build_object('result', 'note_too_long');
  end if;

  insert into public.cost_payments (group_id, user_id, month, amount_pence, paid_on, note, created_by)
  values (p_group_id, p_user_id, v_start, p_amount_pence, p_paid_on, v_note, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

create function public.void_cost_payment(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.cost_payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_payment from public.cost_payments where id = p_id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null or not public.is_group_admin(v_payment.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;

  update public.cost_payments
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_id and voided_at is null;
  if not found then
    return jsonb_build_object('result', 'already_voided');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.record_cost_payment(uuid, uuid, date, integer, date, text) from public, anon;
revoke all on function public.void_cost_payment(uuid, text) from public, anon;
grant execute on function public.record_cost_payment(uuid, uuid, date, integer, date, text) to authenticated;
grant execute on function public.void_cost_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The statement, with payments
-- ---------------------------------------------------------------------------

-- The statement as in 0019 keeps working under a new, internal name.
alter function public.cost_statement(uuid, date) rename to cost_statement_base;
revoke all on function public.cost_statement_base(uuid, date) from public, anon, authenticated;

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
  v_base jsonb;
  v_admin boolean;
  v_payments jsonb;
begin
  v_base := public.cost_statement_base(p_group_id, p_month);
  if v_base->>'result' <> 'ok' then
    return v_base;
  end if;
  v_admin := (v_base->>'is_admin')::boolean;

  -- The month's payments: an admin sees everyone's, a member their own.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'user_id', p.user_id,
      'amount_pence', p.amount_pence,
      'paid_on', p.paid_on,
      'note', p.note
    ) order by p.paid_on, p.created_at, p.id), '[]'::jsonb)
  into v_payments
  from public.cost_payments p
  where p.group_id = p_group_id and p.month = v_start and p.voided_at is null
    and (v_admin or p.user_id = v_me);

  return v_base || jsonb_build_object(
    'payments', v_payments,
    'members', coalesce((
      select jsonb_agg(
        t.m || jsonb_build_object(
          'paid_pence', paid.sum,
          'balance_pence', (t.m->>'total_pence')::integer - paid.sum
        ) order by t.ord)
      from jsonb_array_elements(v_base->'members') with ordinality as t(m, ord)
      cross join lateral (
        select coalesce(sum((q->>'amount_pence')::integer), 0)::integer as sum
        from jsonb_array_elements(v_payments) q
        where q->>'user_id' = t.m->>'user_id'
      ) paid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.cost_statement(uuid, date) from public, anon;
grant execute on function public.cost_statement(uuid, date) to authenticated;
