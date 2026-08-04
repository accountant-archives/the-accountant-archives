-- Small-group community workflow: drafts stay private, first submissions become canon,
-- and every useful act in the archive earns a modest ledger credit.

alter table public.stories
  add column if not exists continuity_note text not null default ''
  check (char_length(continuity_note) <= 360);

create table public.story_edit_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  replacement_body_markdown text not null check (char_length(trim(replacement_body_markdown)) between 20 and 50000),
  rationale text not null default '' check (char_length(rationale) <= 600),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index one_open_edit_per_author_story on public.story_edit_proposals (story_id, author_id) where status = 'open';
create index edit_proposals_by_story on public.story_edit_proposals (story_id, status, created_at desc);

create table public.story_edit_votes (
  proposal_id uuid not null references public.story_edit_proposals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table public.ledger_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_key text not null,
  points integer not null check (points between -100 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, action_key)
);
create index ledger_events_by_user on public.ledger_events (user_id, created_at desc);

alter table public.story_edit_proposals enable row level security;
alter table public.story_edit_votes enable row level security;
alter table public.ledger_events enable row level security;
grant select, insert on public.story_edit_proposals to authenticated;
grant select, insert, update, delete on public.story_edit_votes to authenticated;
grant select on public.ledger_events to authenticated;

create policy "edit proposals are readable" on public.story_edit_proposals for select using (true);
create policy "members propose edits" on public.story_edit_proposals for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'open');
create policy "members see their edit votes" on public.story_edit_votes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "members vote once on edits" on public.story_edit_votes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "members change edit votes" on public.story_edit_votes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "members remove edit votes" on public.story_edit_votes for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "members see their ledger events" on public.ledger_events for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.award_ledger(p_user_id uuid, p_action_key text, p_points integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.ledger_events (user_id, action_key, points)
  values (p_user_id, p_action_key, p_points)
  on conflict (user_id, action_key) do nothing;
$$;
revoke all on function private.award_ledger(uuid, text, integer) from public;

create or replace function private.refresh_ledger(target_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p
  set ledger_balance = coalesce((
    select sum((m.upvotes - m.downvotes) * 3)
    from public.stories s join public.story_metrics m on m.story_id = s.id
    where s.author_id = target_user_id
  ), 0)
  + coalesce((select sum(points) from public.ledger_events where user_id = target_user_id), 0)
  + (select count(*) * 75 from public.canon_challenges c where c.winning_story_id in (select id from public.stories where author_id = target_user_id))
  + (select count(*) * 2 from public.comment_reactions cr join public.comments c on c.id = cr.comment_id where c.author_id = target_user_id)
  + (select count(*) * 5 from public.moderation_actions ma where ma.moderator_id = target_user_id),
  updated_at = now() where p.id = target_user_id;
end;
$$;
revoke all on function private.refresh_ledger(uuid) from public;

create or replace function private.on_archive_vote_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid; action text;
begin
  actor := coalesce(new.user_id, old.user_id);
  if tg_table_name = 'story_reactions' then
    action := 'story_vote:' || coalesce(new.story_id::text, old.story_id::text);
  elsif tg_table_name = 'challenge_votes' then
    action := 'challenge_vote:' || coalesce(new.challenge_id::text, old.challenge_id::text);
  else
    action := 'edit_vote:' || coalesce(new.proposal_id::text, old.proposal_id::text);
  end if;
  if tg_op <> 'DELETE' then perform private.award_ledger(actor, action, 1); end if;
  perform private.refresh_ledger(actor);
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_archive_vote_change() from public;
create trigger award_story_vote_ledger after insert or update or delete on public.story_reactions
  for each row execute procedure private.on_archive_vote_change();
create trigger award_challenge_vote_ledger after insert or update or delete on public.challenge_votes
  for each row execute procedure private.on_archive_vote_change();
create trigger award_edit_vote_ledger after insert or update or delete on public.story_edit_votes
  for each row execute procedure private.on_archive_vote_change();

create or replace function public.submit_story(p_story_id uuid)
returns public.stories
language plpgsql security definer set search_path = '' as $$
declare draft public.stories; existing_canon uuid; min_words integer; window_days integer;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before submitting a story'; end if;
  select * into draft from public.stories where id = p_story_id and author_id = (select auth.uid()) for update;
  if not found then raise exception 'Draft not found'; end if;
  if draft.status <> 'draft' then raise exception 'Only drafts can be submitted'; end if;
  select story_minimum_words, challenge_window_days into min_words, window_days from public.site_settings where id = true;
  if draft.word_count < min_words then raise exception 'This story needs at least % words', min_words; end if;
  select id into existing_canon from public.stories where film_number = draft.film_number and status = 'canon' limit 1 for update;
  if existing_canon is null then
    update public.stories set status = 'canon', submitted_at = now(), published_at = now() where id = draft.id returning * into draft;
    perform private.award_ledger(draft.author_id, 'publish:' || draft.id::text, 12);
  else
    update public.stories set status = 'challenger', challenge_parent_id = existing_canon, submitted_at = now(), published_at = now() where id = draft.id returning * into draft;
    insert into public.canon_challenges (film_number, canon_story_id, challenger_story_id, closes_at)
    values (draft.film_number, existing_canon, draft.id, now() + make_interval(days => window_days));
    perform private.award_ledger(draft.author_id, 'challenge:' || draft.id::text, 8);
  end if;
  perform private.refresh_ledger(draft.author_id);
  return draft;
end;
$$;
revoke all on function public.submit_story(uuid) from public;
grant execute on function public.submit_story(uuid) to authenticated;

create or replace function public.resolve_edit_proposal(p_proposal_id uuid)
returns public.story_edit_proposals
language plpgsql security definer set search_path = '' as $$
declare proposal public.story_edit_proposals; votes_for integer; votes_against integer;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to resolve an edit'; end if;
  select * into proposal from public.story_edit_proposals where id = p_proposal_id for update;
  if not found or proposal.status <> 'open' then raise exception 'This edit proposal is closed'; end if;
  select count(*) filter (where value = 1), count(*) filter (where value = -1)
  into votes_for, votes_against from public.story_edit_votes where proposal_id = proposal.id;
  if coalesce(votes_for, 0) <= coalesce(votes_against, 0) then raise exception 'This edit needs more supporting votes'; end if;
  update public.stories set body_markdown = proposal.replacement_body_markdown where id = proposal.story_id;
  update public.story_edit_proposals set status = 'accepted', resolved_at = now() where id = proposal.id returning * into proposal;
  perform private.award_ledger(proposal.author_id, 'edit-accepted:' || proposal.id::text, 6);
  perform private.refresh_ledger(proposal.author_id);
  return proposal;
end;
$$;
revoke all on function public.resolve_edit_proposal(uuid) from public;
grant execute on function public.resolve_edit_proposal(uuid) to authenticated;
