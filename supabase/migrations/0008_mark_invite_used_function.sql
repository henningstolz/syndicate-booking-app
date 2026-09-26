-- The raw UPDATE + RLS policy approach for marking an invite used was
-- reporting a clean, error-free "0 rows matched" for every attempt,
-- despite the target row genuinely satisfying the policy's own USING
-- clause (used_at is null) when checked directly. Rather than keep
-- chasing that specific mechanism, this moves the write into a
-- SECURITY DEFINER function — the same fix pattern already proven for
-- has_valid_invite()/group_has_no_members() — which bypasses raw-table
-- RLS and enforces safety itself (only marks a still-unused invite,
-- attributes it to the actual caller via auth.uid() rather than a
-- client-supplied value).
create function public.mark_invite_used(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invites
  set used_by = auth.uid(), used_at = now()
  where id = p_invite_id
    and used_at is null;

  return found;
end;
$$;

grant execute on function public.mark_invite_used(uuid) to authenticated;

-- The old UPDATE policy is no longer used by the app (writes now go
-- through the function above) and was the source of the mystery, so
-- it's dropped rather than left as dead, misleading surface area.
drop policy if exists "an unused invite can be claimed by whoever holds the link" on public.invites;
