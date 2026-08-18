-- Content upvotes are permanent marks of appreciation. Removing an upvote only
-- changes the visible count; it does not revoke an award or make it claimable again.
create table private.content_upvote_awards (
  content_kind text not null check (content_kind in ('story', 'fan_art')),
  content_id uuid not null,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  points smallint not null check (points in (0, 1, 5)),
  awarded_at timestamptz not null default now(),
  primary key (content_kind, content_id, voter_id)
);

create index content_upvote_awards_by_recipient
  on private.content_upvote_awards (recipient_id, awarded_at desc);

-- Existing positive reactions occupy their original slots but do not receive a
-- second award. This preserves every current profile balance unchanged.
insert into private.content_upvote_awards (content_kind, content_id, voter_id, recipient_id, points)
select 'story', r.story_id, r.user_id, s.author_id, 0
from public.story_reactions r
join public.stories s on s.id = r.story_id
where r.value = 1 and r.user_id <> s.author_id
on conflict do nothing;

insert into private.content_upvote_awards (content_kind, content_id, voter_id, recipient_id, points)
select 'fan_art', r.art_id, r.user_id, a.author_id, 0
from public.fan_art_reactions r
join public.fan_art a on a.id = r.art_id
where r.user_id <> a.author_id
on conflict do nothing;

create table private.ledger_reward_baselines (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  legacy_balance integer not null,
  canon_wins integer not null default 0,
  moderation_actions integer not null default 0,
  captured_at timestamptz not null default now()
);

insert into private.ledger_reward_baselines (profile_id, legacy_balance, canon_wins, moderation_actions)
select
  p.id,
  p.ledger_balance,
  (select count(*) from public.canon_challenges c join public.stories s on s.id = c.winning_story_id where s.author_id = p.id),
  (select count(*) from public.moderation_actions ma where ma.moderator_id = p.id)
from public.profiles p
on conflict do nothing;

create or replace function private.record_content_upvote_award(
  p_content_kind text,
  p_content_id uuid,
  p_voter_id uuid,
  p_recipient_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  award_points smallint;
begin
  -- Self-reactions are visible, but they never reserve a high-value slot or
  -- grant sparkle points.
  if p_voter_id = p_recipient_id then
    return;
  end if;

  -- Serialize awards for one piece of content so two simultaneous votes cannot
  -- both be treated as its third five-point reaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_content_kind || ':' || p_content_id::text, 0)
  );

  select case when count(*) < 3 then 5 else 1 end
  into award_points
  from private.content_upvote_awards
  where content_kind = p_content_kind and content_id = p_content_id;

  insert into private.content_upvote_awards (content_kind, content_id, voter_id, recipient_id, points)
  values (p_content_kind, p_content_id, p_voter_id, p_recipient_id, award_points)
  on conflict do nothing;
end;
$$;
revoke all on function private.record_content_upvote_award(text, uuid, uuid, uuid) from public;

create or replace function private.refresh_ledger(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.ledger_reward_baselines (profile_id, legacy_balance, canon_wins, moderation_actions)
  select
    p.id,
    p.ledger_balance,
    (select count(*) from public.canon_challenges c join public.stories s on s.id = c.winning_story_id where s.author_id = p.id),
    (select count(*) from public.moderation_actions ma where ma.moderator_id = p.id)
  from public.profiles p
  where p.id = target_user_id
  on conflict do nothing;

  update public.profiles p
  set ledger_balance = b.legacy_balance
  + coalesce((
    select sum(a.points)
    from private.content_upvote_awards a
    where a.recipient_id = target_user_id
  ), 0)
  + greatest(0, (select count(*) from public.canon_challenges c where c.winning_story_id in (select id from public.stories where author_id = target_user_id)) - b.canon_wins) * 75
  + greatest(0, (select count(*) from public.moderation_actions ma where ma.moderator_id = target_user_id) - b.moderation_actions) * 5,
  updated_at = now()
  from private.ledger_reward_baselines b
  where p.id = target_user_id and b.profile_id = p.id;
end;
$$;
revoke all on function private.refresh_ledger(uuid) from public;

create or replace function private.on_story_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_story uuid;
  target_author uuid;
begin
  target_story := coalesce(new.story_id, old.story_id);
  perform private.refresh_story_metrics(target_story);
  select author_id into target_author from public.stories where id = target_story;

  if (tg_op = 'INSERT' and new.value = 1)
    or (tg_op = 'UPDATE' and new.value = 1 and old.value <> 1) then
    perform private.record_content_upvote_award('story', new.story_id, new.user_id, target_author);
  end if;

  perform private.refresh_ledger(target_author);
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_story_reaction_change() from public;

create or replace function private.on_fan_art_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_author uuid;
begin
  select author_id into target_author from public.fan_art where id = new.art_id;
  perform private.record_content_upvote_award('fan_art', new.art_id, new.user_id, target_author);
  perform private.refresh_ledger(target_author);
  return new;
end;
$$;
revoke all on function private.on_fan_art_reaction_change() from public;

drop trigger if exists award_fan_art_reaction on public.fan_art_reactions;
create trigger award_fan_art_reaction
  after insert on public.fan_art_reactions
  for each row execute procedure private.on_fan_art_reaction_change();

-- Comment reactions are deliberately absent from the permanent-award record.
