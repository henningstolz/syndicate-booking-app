-- Feedback from members: bug reports and ideas, sent from the "Feedback" button at the
-- bottom of the side menu.
--
-- The message is emailed to hello@blocktime.group by the server (with the member's
-- address as reply-to), and a private copy is kept here so that nothing is lost if the
-- email fails, and so that one person cannot flood the inbox (at most 5 messages an
-- hour each). Nobody can read this table through the app: it is for the owner, in the
-- Supabase dashboard. Backwards compatible: nothing live uses it yet.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  category text not null check (category in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  page text check (char_length(page) <= 200),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);

create index feedback_user_idx on public.feedback (user_id, created_at desc);

-- Row-level security on and no policy at all: the app's users can neither read nor write
-- the table directly. Only the two functions below touch it.
alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;

create function public.submit_feedback(
  p_group_id uuid,
  p_category text,
  p_message text,
  p_page text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_category is null or p_category not in ('bug', 'idea', 'other') then
    return jsonb_build_object('result', 'category_invalid');
  end if;
  if char_length(v_message) < 3 then
    return jsonb_build_object('result', 'message_required');
  end if;
  if char_length(v_message) > 2000 then
    return jsonb_build_object('result', 'message_too_long');
  end if;
  -- At most 5 messages an hour per person.
  if (
    select count(*) from public.feedback f
    where f.user_id = auth.uid() and f.created_at > now() - interval '1 hour'
  ) >= 5 then
    return jsonb_build_object('result', 'rate_limited');
  end if;

  insert into public.feedback (group_id, user_id, category, message, page, user_agent)
  values (p_group_id, auth.uid(), p_category, v_message, left(btrim(coalesce(p_page, '')), 200), left(btrim(coalesce(p_user_agent, '')), 300))
  returning id into v_id;
  return jsonb_build_object('result', 'ok', 'id', v_id);
end;
$$;

-- Records that the email went out (only for the person's own message).
create function public.mark_feedback_emailed(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.feedback set emailed_at = now()
  where id = p_id and user_id = auth.uid() and emailed_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.submit_feedback(uuid, text, text, text, text) from public, anon;
revoke all on function public.mark_feedback_emailed(uuid) from public, anon;
grant execute on function public.submit_feedback(uuid, text, text, text, text) to authenticated;
grant execute on function public.mark_feedback_emailed(uuid) to authenticated;
