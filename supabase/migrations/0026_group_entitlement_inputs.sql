-- What the app needs to decide whether a group may write (see docs/entitlements.md): the
-- group's plan and billing dates, and the platform settings. Any current member of the group
-- may ask, because a plain member also writes (bookings, chat). The full plan row stays
-- readable by group admins only; this returns just five fields, never the discount, the
-- billing reference or the payment-provider ids.
--
-- Backwards compatible: one new function, nothing else changes. If it is missing or fails the
-- app lets the write through, so a problem here can never lock a group out.

create function public.get_group_entitlement_inputs(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  select jsonb_build_object(
    'plan', gp.plan,
    'billing_status', gp.billing_status,
    'trial_ends_at', gp.trial_ends_at,
    'paid_until', gp.paid_until,
    'price_locked_until', gp.price_locked_until
  ) into v_plan
  from public.group_plans gp
  where gp.group_id = p_group_id;
  -- A group without a plan row gives plan null; the app then treats it as "allow everything".
  return jsonb_build_object(
    'result', 'ok',
    'plan', v_plan,
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.platform_settings)
  );
end;
$$;

revoke all on function public.get_group_entitlement_inputs(uuid) from public, anon;
grant execute on function public.get_group_entitlement_inputs(uuid) to authenticated;
