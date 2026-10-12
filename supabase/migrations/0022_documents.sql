-- Documents: a shared file store for the group, and receipts on expenses.
--
-- * `documents` holds what a file is (title, category, who uploaded it, when); the
--   file itself lives in Supabase Storage (private bucket `documents`, set up by
--   migration 0023) at the path `<group id>/<random id>.<ext>`.
-- * A member uploads straight from the browser to storage (the policies in 0023 let
--   a member write only into their own group's folder, up to the group's space
--   limit), then `add_document()` registers it, after checking the file really is
--   there and was uploaded by them. Everyone in the group sees the group's
--   documents. The uploader or an admin deletes one (`delete_document()` hides it
--   and hands back the path so the server can remove the file).
-- * An expense can carry a receipt: `cost_expenses.document_id` points at a document,
--   which then also shows on the Documents page (category "Receipts").
--   add_cost_expense() takes the new optional argument; cost_statement_live()
--   returns each expense's `document_id`.
--
-- Each group has 200 MB of space for its files (`document_quota_ok`), counted over
-- everything in its folder, registered or not.
--
-- Backwards compatible: the old five-argument call of add_cost_expense() still works
-- (without a receipt). Run this and then 0023 BEFORE pushing the matching code.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id),
  title text not null check (char_length(title) between 1 and 120),
  category text not null check (category in ('general', 'aircraft', 'insurance', 'manuals', 'receipts', 'other')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id)
);

create index documents_group_idx on public.documents (group_id, created_at desc);

alter table public.documents enable row level security;

-- Members of the group see its documents (a deleted one is hidden). Writes go through
-- the functions below.
create policy "members can view their group's documents"
  on public.documents for select
  using (public.is_group_member(group_id) and deleted_at is null);

alter table public.cost_expenses add column document_id uuid references public.documents (id);

-- ---------------------------------------------------------------------------
-- Helpers used by the storage policies (0023)
-- ---------------------------------------------------------------------------

-- The group a stored file belongs to: the first folder of its path, or null if that
-- is not a group id.
create function public.document_folder_group(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

-- Is there still room in the group's 200 MB for another file?
create function public.document_quota_ok(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0) < 209715200
  from storage.objects o
  where o.bucket_id = 'documents' and o.name like p_group_id::text || '/%';
$$;

revoke all on function public.document_folder_group(text) from public;
revoke all on function public.document_quota_ok(uuid) from public, anon;
grant execute on function public.document_folder_group(text) to anon, authenticated;
grant execute on function public.document_quota_ok(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Register and delete a document
-- ---------------------------------------------------------------------------

create function public.add_document(
  p_group_id uuid,
  p_title text,
  p_category text,
  p_path text,
  p_file_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_name text := btrim(coalesce(p_file_name, ''));
  v_size bigint;
  v_type text;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if v_title = '' then
    return jsonb_build_object('result', 'title_required');
  end if;
  if char_length(v_title) > 120 then
    return jsonb_build_object('result', 'title_too_long');
  end if;
  if p_category is null or p_category not in ('general', 'aircraft', 'insurance', 'manuals', 'receipts', 'other') then
    return jsonb_build_object('result', 'category_invalid');
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    return jsonb_build_object('result', 'file_name_invalid');
  end if;
  if p_path is null or p_path not like p_group_id::text || '/%' or position('..' in p_path) > 0 then
    return jsonb_build_object('result', 'path_invalid');
  end if;

  -- The file must really be there, uploaded by this member. Its size and type are
  -- taken from the store, not from the caller.
  select coalesce((o.metadata->>'size')::bigint, 0), coalesce(o.metadata->>'mimetype', 'application/octet-stream')
  into v_size, v_type
  from storage.objects o
  where o.bucket_id = 'documents' and o.name = p_path and o.owner = auth.uid();
  if not found then
    return jsonb_build_object('result', 'file_missing');
  end if;
  if exists (select 1 from public.documents d where d.storage_path = p_path) then
    return jsonb_build_object('result', 'already_added');
  end if;

  insert into public.documents (group_id, uploaded_by, title, category, file_name, content_type, size_bytes, storage_path)
  values (p_group_id, auth.uid(), v_title, p_category, v_name, v_type, v_size, p_path)
  returning id into v_id;
  return jsonb_build_object('result', 'ok', 'id', v_id);
end;
$$;

-- The uploader or an admin deletes a document: it is hidden at once, and the answer
-- carries the file's path so the server can remove the file itself.
create function public.delete_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents%rowtype;
begin
  select * into v_doc from public.documents d where d.id = p_id and d.deleted_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null
     or not public.is_group_member(v_doc.group_id)
     or not (v_doc.uploaded_by = auth.uid() or public.is_group_admin(v_doc.group_id)) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.documents set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  return jsonb_build_object('result', 'ok', 'path', v_doc.storage_path);
end;
$$;

revoke all on function public.add_document(uuid, text, text, text, text) from public, anon;
revoke all on function public.delete_document(uuid) from public, anon;
grant execute on function public.add_document(uuid, text, text, text, text) to authenticated;
grant execute on function public.delete_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Receipts on expenses
-- ---------------------------------------------------------------------------

-- The five-argument version is replaced by one with an optional receipt.
drop function public.add_cost_expense(uuid, uuid, date, text, integer);

create function public.add_cost_expense(
  p_group_id uuid,
  p_paid_by uuid,
  p_date date,
  p_description text,
  p_amount_pence integer,
  p_document_id uuid default null
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
  -- A receipt, if given, must be a live document of the same group.
  if p_document_id is not null and not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.group_id = p_group_id and d.deleted_at is null
  ) then
    return jsonb_build_object('result', 'document_invalid');
  end if;

  insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by, document_id)
  values (p_group_id, p_paid_by, p_date, v_description, p_amount_pence, auth.uid(), p_document_id);
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.add_cost_expense(uuid, uuid, date, text, integer, uuid) from public, anon;
grant execute on function public.add_cost_expense(uuid, uuid, date, text, integer, uuid) to authenticated;

-- The live statement calculation as in 0017, returning each expense's receipt.
create or replace function public.cost_statement_live(p_group_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_admin boolean;
  v_fee integer;
  v_hourly integer;
  v_missing boolean;
  v_result jsonb;
begin
  if v_me is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  v_admin := public.is_group_admin(p_group_id);

  -- The group's rates in force for this month: the latest row (without a
  -- member) starting on or before it.
  select r.monthly_fee_pence, r.hourly_rate_pence into v_fee, v_hourly
  from public.cost_rates r
  where r.group_id = p_group_id and r.user_id is null and r.effective_month <= v_start
  order by r.effective_month desc, r.created_at desc
  limit 1;
  v_missing := not found;
  v_fee := coalesce(v_fee, 0);
  v_hourly := coalesce(v_hourly, 0);

  with raw_flights as (
    select f.id, f.flight_date, f.from_place, f.to_place, f.brakes_off,
           coalesce(f.captain_id, f.created_by) as charged,
           (f.block_deci * 10)::integer as tenths
    from public.flight_entries f
    where f.group_id = p_group_id
      and f.voided_at is null
      and f.flight_date >= v_start and f.flight_date < v_end
  ),
  expense_rows as (
    select e.id, e.incurred_on, e.description, e.paid_by, e.amount_pence, e.document_id
    from public.cost_expenses e
    where e.group_id = p_group_id
      and e.voided_at is null
      and e.incurred_on >= v_start and e.incurred_on < v_end
  ),
  in_month as (
    select m.user_id, coalesce(m.display_name, 'Member') as name
    from public.group_members m
    where m.group_id = p_group_id
      and (m.created_at at time zone 'Europe/London')::date < v_end
      and (m.removed_at is null or (m.removed_at at time zone 'Europe/London')::date >= v_start)
  ),
  involved as (
    select user_id, name, true as is_member from in_month
    union all
    select x.user_id, coalesce(max(gm.display_name), 'Member'), false
    from (select charged as user_id from raw_flights union select paid_by from expense_rows) x
    left join public.group_members gm on gm.group_id = p_group_id and gm.user_id = x.user_id
    where x.user_id not in (select user_id from in_month)
    group by x.user_id
  ),
  rated as (
    select i.user_id, i.name, i.is_member,
           coalesce(own.f, v_fee) as fee,
           coalesce(own.h, v_hourly) as hourly,
           (own.f is not null or own.h is not null) as custom
    from involved i
    left join lateral (
      select r.monthly_fee_pence as f, r.hourly_rate_pence as h
      from public.cost_rates r
      where r.group_id = p_group_id and r.user_id = i.user_id and r.effective_month <= v_start
      order by r.effective_month desc, r.created_at desc
      limit 1
    ) own on true
  ),
  priced as (
    select rf.id, rf.flight_date, rf.from_place, rf.to_place, rf.brakes_off, rf.charged, rf.tenths,
           round(rf.tenths::numeric * rt.hourly / 10)::integer as pence
    from raw_flights rf
    join rated rt on rt.user_id = rf.charged
  ),
  per_person as (
    select rt.user_id, rt.name, rt.is_member, rt.fee, rt.hourly, rt.custom,
           coalesce(sum(pr.tenths), 0)::integer as tenths,
           count(pr.id)::integer as flights,
           coalesce(sum(pr.pence), 0)::integer as hourly_pence
    from rated rt
    left join priced pr on pr.charged = rt.user_id
    group by rt.user_id, rt.name, rt.is_member, rt.fee, rt.hourly, rt.custom
  ),
  credits as (
    select paid_by as user_id, sum(amount_pence)::integer as pence
    from expense_rows
    group by paid_by
  ),
  final as (
    select pp.user_id, pp.name, pp.is_member, pp.fee, pp.hourly, pp.custom, pp.tenths, pp.flights,
           pp.hourly_pence,
           case when pp.is_member then pp.fee else 0 end as fixed_pence,
           coalesce(c.pence, 0) as credit_pence
    from per_person pp
    left join credits c on c.user_id = pp.user_id
  )
  select jsonb_build_object(
    'result', 'ok',
    'month', v_start,
    'is_admin', v_admin,
    'rates', jsonb_build_object('fee_pence', v_fee, 'hourly_pence', v_hourly, 'missing', v_missing),
    'hours_tenths', (select coalesce(sum(tenths), 0) from raw_flights),
    'credits_pence', (select coalesce(sum(amount_pence), 0) from expense_rows),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', f.user_id,
        'name', f.name,
        'is_member', f.is_member,
        'flights', f.flights,
        'hours_tenths', f.tenths,
        'fee_pence', f.fee,
        'hourly_rate_pence', f.hourly,
        'custom_rates', f.custom,
        'fixed_pence', f.fixed_pence,
        'hourly_pence', f.hourly_pence,
        'credit_pence', f.credit_pence,
        'total_pence', f.fixed_pence + f.hourly_pence - f.credit_pence
      ) order by f.name, f.user_id), '[]'::jsonb)
      from final f
      where v_admin or f.user_id = v_me
    ),
    'flights', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'date', pr.flight_date,
        'from', pr.from_place,
        'to', pr.to_place,
        'user_id', pr.charged,
        'hours_tenths', pr.tenths,
        'pence', pr.pence
      ) order by pr.brakes_off, pr.id), '[]'::jsonb)
      from priced pr
      where v_admin or pr.charged = v_me
    ),
    'expenses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', er.id,
        'date', er.incurred_on,
        'description', er.description,
        'user_id', er.paid_by,
        'pence', er.amount_pence,
        'document_id', er.document_id
      ) order by er.incurred_on, er.id), '[]'::jsonb)
      from expense_rows er
      where v_admin or er.paid_by = v_me
    )
  ) into v_result;

  return v_result;
end;
$$;
