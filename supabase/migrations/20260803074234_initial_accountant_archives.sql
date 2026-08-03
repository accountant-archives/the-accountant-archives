-- The Accountant Archives: foundational schema, safeguards, and the 800-film ledger.
-- This migration deliberately grants API access explicitly because new Supabase projects
-- may not automatically expose new public-schema tables to the Data API.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('writer', 'moderator', 'admin');
create type public.story_status as enum ('draft', 'submitted', 'canon', 'challenger', 'archived', 'rejected');
create type public.challenge_status as enum ('open', 'resolved', 'void');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 500),
  ledger_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'writer',
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now()
);

create table public.eras (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 64),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null check (char_length(description) between 20 and 560),
  writing_guidelines text not null default '',
  accent text not null default '#bf4d3f' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  start_movie integer not null check (start_movie between 1 and 800),
  end_movie integer not null check (end_movie between 1 and 800 and end_movie >= start_movie),
  display_order integer not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exclude using gist (int4range(start_movie, end_movie, '[]') with &&)
);

create table public.films (
  number integer primary key check (number between 1 and 800),
  title text not null check (char_length(title) between 1 and 120),
  official_description text not null check (char_length(official_description) between 20 and 500),
  era_id uuid references public.eras(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stories (
  id uuid primary key default extensions.gen_random_uuid(),
  film_number integer not null references public.films(number) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 5 and 120),
  body_markdown text not null default '',
  word_count integer not null default 0 check (word_count >= 0),
  reading_minutes integer not null default 1 check (reading_minutes >= 1),
  status public.story_status not null default 'draft',
  challenge_parent_id uuid references public.stories(id) on delete set null,
  submitted_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'challenger' or challenge_parent_id is not null)
);

create unique index stories_one_canon_per_film
  on public.stories (film_number) where status = 'canon';
create index stories_by_film_status on public.stories (film_number, status, created_at desc);
create index stories_by_author on public.stories (author_id, updated_at desc);

create table public.story_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  title text not null,
  body_markdown text not null,
  word_count integer not null,
  created_at timestamptz not null default now(),
  unique (story_id, revision_number)
);

create table public.story_metrics (
  story_id uuid primary key references public.stories(id) on delete cascade,
  upvotes integer not null default 0 check (upvotes >= 0),
  downvotes integer not null default 0 check (downvotes >= 0),
  bookmarks integer not null default 0 check (bookmarks >= 0),
  comments integer not null default 0 check (comments >= 0),
  updated_at timestamptz not null default now()
);

create table public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table public.bookmarks (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table public.comments (
  id uuid primary key default extensions.gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  parent_id uuid references public.comments(id) on delete set null,
  body text not null check (char_length(trim(body)) between 2 and 3000),
  helpful_count integer not null default 0 check (helpful_count >= 0),
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_by_story on public.comments (story_id, created_at);

create table public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table public.canon_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  film_number integer not null references public.films(number) on delete cascade,
  canon_story_id uuid not null references public.stories(id) on delete restrict,
  challenger_story_id uuid not null unique references public.stories(id) on delete restrict,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null default (now() + interval '7 days'),
  status public.challenge_status not null default 'open',
  winning_story_id uuid references public.stories(id) on delete set null,
  resolved_at timestamptz,
  check (closes_at > opens_at),
  check (canon_story_id <> challenger_story_id)
);
create unique index one_open_challenge_per_film on public.canon_challenges (film_number) where status = 'open';
create index challenges_by_deadline on public.canon_challenges (status, closes_at);

create table public.challenge_votes (
  challenge_id uuid not null references public.canon_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.challenge_metrics (
  challenge_id uuid primary key references public.canon_challenges(id) on delete cascade,
  canon_votes integer not null default 0 check (canon_votes >= 0),
  challenger_votes integer not null default 0 check (challenger_votes >= 0),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  story_id uuid references public.stories(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 10 and 1000),
  status public.report_status not null default 'open',
  handled_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(story_id, comment_id) = 1)
);

create table public.moderation_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  subject_type text not null check (subject_type in ('story', 'comment', 'report', 'member')),
  subject_id uuid not null,
  action text not null check (char_length(action) between 3 and 80),
  note text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_by_member on public.notifications (user_id, read_at, created_at desc);

create table public.site_settings (
  id boolean primary key default true check (id),
  story_minimum_words integer not null default 300 check (story_minimum_words between 100 and 3000),
  challenge_window_days integer not null default 7 check (challenge_window_days between 1 and 30),
  moderator_ledger_threshold integer not null default 750 check (moderator_ledger_threshold >= 100),
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (true);

-- Privilege helpers live in an unexposed schema and are not callable over the API.
create or replace function private.has_role(allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = any(allowed_roles)
  );
$$;
revoke all on function private.has_role(public.app_role[]) from public;

create or replace function private.is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.has_role(array['moderator'::public.app_role, 'admin'::public.app_role]); $$;
revoke all on function private.is_moderator_or_admin() from public;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.has_role(array['admin'::public.app_role]); $$;
revoke all on function private.is_admin() from public;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_handle text;
begin
  clean_handle := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'preferred_username', split_part(new.email, '@', 1), 'writer'),
    '[^a-z0-9_-]', '-', 'g'
  ));
  clean_handle := trim(both '-' from clean_handle);
  if char_length(clean_handle) < 3 then clean_handle := 'writer'; end if;

  insert into public.profiles (id, handle, display_name, avatar_url)
  values (
    new.id,
    left(clean_handle, 26) || '-' || left(new.id::text, 5),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'New Writer'), 80),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  insert into public.user_roles (user_id) values (new.id);
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();

create or replace function private.prepare_story()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_body text;
begin
  clean_body := trim(regexp_replace(new.body_markdown, '[[:space:]]+', ' ', 'g'));
  new.word_count := case when clean_body = '' then 0 else cardinality(regexp_split_to_array(clean_body, '[[:space:]]+')) end;
  new.reading_minutes := greatest(1, ceil(new.word_count::numeric / 220.0)::integer);
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.capture_story_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.story_revisions (story_id, revision_number, title, body_markdown, word_count)
    values (new.id, 1, new.title, new.body_markdown, new.word_count);
  elsif old.title is distinct from new.title or old.body_markdown is distinct from new.body_markdown then
    insert into public.story_revisions (story_id, revision_number, title, body_markdown, word_count)
    values (
      new.id,
      (select coalesce(max(revision_number), 0) + 1 from public.story_revisions where story_id = new.id),
      new.title, new.body_markdown, new.word_count
    );
  end if;
  return new;
end;
$$;
revoke all on function private.capture_story_revision() from public;

create trigger prepare_story_before_save
  before insert or update of title, body_markdown on public.stories
  for each row execute procedure private.prepare_story();
create trigger capture_story_revision_after_save
  after insert or update of title, body_markdown on public.stories
  for each row execute procedure private.capture_story_revision();

create or replace function private.refresh_story_metrics(target_story_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.story_metrics (story_id, upvotes, downvotes, bookmarks, comments, updated_at)
  select target_story_id,
    count(*) filter (where r.value = 1),
    count(*) filter (where r.value = -1),
    (select count(*) from public.bookmarks b where b.story_id = target_story_id),
    (select count(*) from public.comments c where c.story_id = target_story_id and not c.is_removed),
    now()
  from public.story_reactions r
  where r.story_id = target_story_id
  on conflict (story_id) do update set
    upvotes = excluded.upvotes,
    downvotes = excluded.downvotes,
    bookmarks = excluded.bookmarks,
    comments = excluded.comments,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function private.refresh_story_metrics(uuid) from public;

create or replace function private.refresh_ledger(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set ledger_balance = coalesce((
    select sum((m.upvotes - m.downvotes) * 3)
    from public.stories s
    join public.story_metrics m on m.story_id = s.id
    where s.author_id = target_user_id
  ), 0)
  + (select count(*) * 75 from public.canon_challenges c where c.winning_story_id in (select id from public.stories where author_id = target_user_id))
  + (select count(*) * 2 from public.comment_reactions cr join public.comments c on c.id = cr.comment_id where c.author_id = target_user_id)
  + (select count(*) * 5 from public.moderation_actions ma where ma.moderator_id = target_user_id),
  updated_at = now()
  where p.id = target_user_id;
end;
$$;
revoke all on function private.refresh_ledger(uuid) from public;

create or replace function private.on_story_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_story uuid; target_author uuid;
begin
  target_story := coalesce(new.story_id, old.story_id);
  perform private.refresh_story_metrics(target_story);
  select author_id into target_author from public.stories where id = target_story;
  perform private.refresh_ledger(target_author);
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_story_reaction_change() from public;

create trigger sync_reaction_metrics
  after insert or update or delete on public.story_reactions
  for each row execute procedure private.on_story_reaction_change();

create or replace function private.on_bookmark_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_story_metrics(coalesce(new.story_id, old.story_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_bookmark_change() from public;
create trigger sync_bookmark_metrics after insert or delete on public.bookmarks
  for each row execute procedure private.on_bookmark_change();

create or replace function private.on_comment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_story_metrics(coalesce(new.story_id, old.story_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_comment_change() from public;
create trigger sync_comment_metrics after insert or update or delete on public.comments
  for each row execute procedure private.on_comment_change();

create or replace function private.on_comment_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_comment uuid; target_author uuid;
begin
  target_comment := coalesce(new.comment_id, old.comment_id);
  update public.comments set helpful_count = (select count(*) from public.comment_reactions where comment_id = target_comment)
  where id = target_comment;
  select author_id into target_author from public.comments where id = target_comment;
  perform private.refresh_ledger(target_author);
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_comment_reaction_change() from public;
create trigger sync_comment_helpful after insert or delete on public.comment_reactions
  for each row execute procedure private.on_comment_reaction_change();

create or replace function private.sync_challenge_metrics(target_challenge uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.challenge_metrics (challenge_id, canon_votes, challenger_votes, updated_at)
  select c.id,
    count(v.*) filter (where v.story_id = c.canon_story_id),
    count(v.*) filter (where v.story_id = c.challenger_story_id), now()
  from public.canon_challenges c
  left join public.challenge_votes v on v.challenge_id = c.id
  where c.id = target_challenge
  group by c.id
  on conflict (challenge_id) do update set
    canon_votes = excluded.canon_votes,
    challenger_votes = excluded.challenger_votes,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function private.sync_challenge_metrics(uuid) from public;

create or replace function private.on_challenge_vote_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_challenge_metrics(coalesce(new.challenge_id, old.challenge_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_challenge_vote_change() from public;
create trigger sync_challenge_votes after insert or update or delete on public.challenge_votes
  for each row execute procedure private.on_challenge_vote_change();

create or replace function private.reassign_era_films()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.films set era_id = null where era_id = old.id;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    update public.films set era_id = null where era_id = old.id;
  end if;
  update public.films set era_id = new.id where number between new.start_movie and new.end_movie;
  return new;
end;
$$;
revoke all on function private.reassign_era_films() from public;
create trigger keep_film_eras_in_sync
  after insert or update of start_movie, end_movie or delete on public.eras
  for each row execute procedure private.reassign_era_films();

-- Stored routines expose only controlled state transitions to authenticated users.
create or replace function public.submit_story(p_story_id uuid)
returns public.stories
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.stories;
  existing_canon uuid;
  min_words integer;
  window_days integer;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before submitting a story'; end if;
  select * into draft from public.stories where id = p_story_id and author_id = (select auth.uid()) for update;
  if not found then raise exception 'Draft not found'; end if;
  if draft.status <> 'draft' then raise exception 'Only drafts can be submitted'; end if;
  select story_minimum_words, challenge_window_days into min_words, window_days from public.site_settings where id = true;
  if draft.word_count < min_words then raise exception 'This story needs at least % words', min_words; end if;

  select id into existing_canon from public.stories
  where film_number = draft.film_number and status = 'canon'
  limit 1 for update;

  if existing_canon is null then
    update public.stories set status = 'submitted', submitted_at = now() where id = draft.id returning * into draft;
  else
    update public.stories set status = 'challenger', challenge_parent_id = existing_canon, submitted_at = now(), published_at = now()
    where id = draft.id returning * into draft;
    insert into public.canon_challenges (film_number, canon_story_id, challenger_story_id, closes_at)
    values (draft.film_number, existing_canon, draft.id, now() + make_interval(days => window_days));
  end if;
  return draft;
end;
$$;

create or replace function public.update_my_profile(p_handle text, p_display_name text, p_bio text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare updated_profile public.profiles;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before updating your profile'; end if;
  update public.profiles
  set handle = lower(trim(p_handle)), display_name = trim(p_display_name), bio = trim(p_bio), updated_at = now()
  where id = (select auth.uid())
  returning * into updated_profile;
  return updated_profile;
end;
$$;

create or replace function public.cast_challenge_vote(p_challenge_id uuid, p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare challenge public.canon_challenges;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to cast a canon vote'; end if;
  select * into challenge from public.canon_challenges where id = p_challenge_id for update;
  if not found or challenge.status <> 'open' or challenge.closes_at <= now() then raise exception 'This challenge is closed'; end if;
  if p_story_id not in (challenge.canon_story_id, challenge.challenger_story_id) then raise exception 'Vote must choose one of this challenge’s stories'; end if;
  insert into public.challenge_votes (challenge_id, user_id, story_id)
  values (p_challenge_id, (select auth.uid()), p_story_id)
  on conflict (challenge_id, user_id) do update set story_id = excluded.story_id, updated_at = now();
end;
$$;

create or replace function public.moderate_story(p_story_id uuid, p_action text, p_note text default null)
returns public.stories
language plpgsql
security definer
set search_path = ''
as $$
declare target public.stories;
begin
  if not (select private.is_moderator_or_admin()) then raise exception 'Moderator access required'; end if;
  select * into target from public.stories where id = p_story_id for update;
  if not found then raise exception 'Story not found'; end if;
  if p_action = 'approve_canon' then
    if target.status <> 'submitted' then raise exception 'Only submitted stories can become canon'; end if;
    update public.stories set status = 'archived', archived_at = now()
    where film_number = target.film_number and status = 'canon';
    update public.stories set status = 'canon', published_at = now() where id = target.id returning * into target;
  elsif p_action = 'archive' then
    update public.stories set status = 'archived', archived_at = now() where id = target.id returning * into target;
  elsif p_action = 'reject' then
    update public.stories set status = 'rejected', archived_at = now() where id = target.id returning * into target;
  else
    raise exception 'Unknown moderation action';
  end if;
  insert into public.moderation_actions (moderator_id, subject_type, subject_id, action, note)
  values ((select auth.uid()), 'story', target.id, p_action, p_note);
  perform private.refresh_ledger((select author_id from public.stories where id = target.id));
  return target;
end;
$$;

create or replace function public.set_member_role(p_user_id uuid, p_role public.app_role)
returns public.user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare changed public.user_roles;
begin
  if not (select private.is_admin()) then raise exception 'Administrator access required'; end if;
  insert into public.user_roles (user_id, role, assigned_by)
  values (p_user_id, p_role, (select auth.uid()))
  on conflict (user_id) do update set role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = now()
  returning * into changed;
  insert into public.moderation_actions (moderator_id, subject_type, subject_id, action)
  values ((select auth.uid()), 'member', p_user_id, 'set_role_' || p_role::text);
  return changed;
end;
$$;

revoke all on function public.submit_story(uuid) from public;
revoke all on function public.update_my_profile(text, text, text) from public;
revoke all on function public.cast_challenge_vote(uuid, uuid) from public;
revoke all on function public.moderate_story(uuid, text, text) from public;
revoke all on function public.set_member_role(uuid, public.app_role) from public;
grant execute on function public.submit_story(uuid) to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.cast_challenge_vote(uuid, uuid) to authenticated;
grant execute on function public.moderate_story(uuid, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, public.app_role) to authenticated;

-- Invoked only by the scheduled Edge Function using the service-role key.
-- Ties deliberately preserve canon: replacement needs a clear community majority.
create or replace function public.resolve_expired_challenges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.canon_challenges;
  metrics public.challenge_metrics;
  winner uuid;
  resolved_count integer := 0;
  winner_author uuid;
  loser_author uuid;
begin
  for challenge in
    select * from public.canon_challenges
    where status = 'open' and closes_at <= now()
    order by closes_at
    for update skip locked
  loop
    select * into metrics from public.challenge_metrics where challenge_id = challenge.id;
    if coalesce(metrics.challenger_votes, 0) > coalesce(metrics.canon_votes, 0) then
      winner := challenge.challenger_story_id;
      update public.stories set status = 'archived', archived_at = now() where id = challenge.canon_story_id;
      update public.stories set status = 'canon', published_at = now() where id = challenge.challenger_story_id;
    else
      winner := challenge.canon_story_id;
      update public.stories set status = 'archived', archived_at = now() where id = challenge.challenger_story_id;
    end if;
    update public.canon_challenges
      set status = 'resolved', winning_story_id = winner, resolved_at = now()
      where id = challenge.id;
    select author_id into winner_author from public.stories where id = winner;
    select author_id into loser_author from public.stories where id = case when winner = challenge.canon_story_id then challenge.challenger_story_id else challenge.canon_story_id end;
    insert into public.notifications (user_id, kind, title, body, href)
    values
      (winner_author, 'challenge_resolved', 'Canon challenge decided', 'The archive selected your story as canon.', '/stories/' || winner::text),
      (loser_author, 'challenge_resolved', 'Canon challenge decided', 'Your entry remains preserved in the archive.', '/stories/' || case when winner = challenge.canon_story_id then challenge.challenger_story_id::text else challenge.canon_story_id::text end);
    perform private.refresh_ledger(winner_author);
    perform private.refresh_ledger(loser_author);
    resolved_count := resolved_count + 1;
  end loop;
  return resolved_count;
end;
$$;
revoke all on function public.resolve_expired_challenges() from public;
grant execute on function public.resolve_expired_challenges() to service_role;

-- Full, programmatic catalogue: fraction titles are generated instead of hand-entered.
create or replace function public.accountant_film_title(p_number integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_number = 800 then 'Paid In Full'
    when p_number = 1 then 'Time to Pay'
    when p_number = 2 then 'The Collector Is Here'
    when p_number between 3 and 30 then (array[
      'The Ledger Never Sleeps', 'Outstanding Balance', 'Due Yesterday', 'A Gentle Reminder', 'Second Notice',
      'The Accounts Receivable', 'Collections Department', 'Interest Accrued', 'Open Invoice', 'Paper Trail',
      'The Cost of Delay', 'Unpaid in the City', 'Balance Pending', 'Terms and Conditions', 'Past Due',
      'The Follow-Up', 'Reconciliation', 'Delinquent', 'The Last Receipt', 'Notice of Intent',
      'Final Ledger', 'Accountability', 'The Debt Knows Your Name', 'Obligation', 'Collection Day',
      'The Auditor Watches', 'No Extension', 'Payment Plan'
    ])[p_number - 2]
    when p_number between 31 and 40 then (array[
      'This Is the Last Chance', 'Okay, Very Last Chance', 'I’m Counting Down', 'You Have Been Warned', 'Notice of Notice',
      'A Final Final Notice', 'The Deadline', 'No More Reminders', 'Please Pay', 'The Last Last Chance'
    ])[p_number - 30]
    when p_number = 41 then '3'
    when p_number = 42 then '2'
    when p_number = 43 then '1'
    when p_number between 44 and 799 then '1 / 2^' || (p_number - 43)::text
    else 'Untitled Ledger Entry'
  end;
$$;

create or replace function public.accountant_film_description(p_number integer)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_number = 800 then 'At last, the balance reaches zero. Whether this is closure, a loophole, or the beginning of a new debt is left to the archives.'
    when p_number between 1 and 30 then 'The accountant follows another thread in the debtor’s paper trail, discovering that a routine collection is becoming uncomfortably personal.'
    when p_number between 31 and 40 then 'The notices become theatrical and the office grows impatient. Every stamped envelope makes the debtor’s silence feel more deliberate.'
    when p_number between 220 and 300 then 'Grothkin Lore era. The ever-smaller debt pulls the accountant into the buried mythology of Grothkin, where invoices are treated as sacred prophecies.'
    when p_number = 41 then 'The accountant starts the countdown with impossible confidence. Three is more than enough time, surely.'
    when p_number = 42 then 'The second mark on the countdown exposes an unsettling fact: the debtor has been counting too.'
    when p_number = 43 then 'One final whole unit of patience remains. The office holds its breath.'
    when p_number between 44 and 799 then 'As the fraction shrinks, the stakes grow absurdly vast. The ledger insists there is still something left to collect.'
    else 'A missing ledger entry awaits its official description.'
  end;
$$;

insert into public.eras (name, slug, description, writing_guidelines, accent, start_movie, end_movie, display_order)
values
  ('Debt Collection', 'debt-collection', 'The accountant has one simple job: find the debtor, make contact, and recover the outstanding balance before it becomes somebody else’s problem.', 'Keep the world recognisable: offices, calls, notices, and a pressure that has not yet become supernatural.', '#c75c48', 1, 30, 1),
  ('Final Notices', 'final-notices', 'Routine collection curdles into a barrage of increasingly dramatic warnings. The bureaucracy is starting to develop a personality.', 'Escalate the urgency and absurdity without resolving the debt. Every notice should make the silence stranger.', '#e78d4b', 31, 40, 2),
  ('The Long Division', 'long-division', 'The countdown begins and ordinary time starts behaving like a negotiable term. Fractions become a new kind of threat.', 'Treat the countdown as real and consequential. Preserve the mystery of who—or what—is keeping pace.', '#d4b353', 41, 219, 3),
  ('Grothkin Lore', 'grothkin-lore', 'Beneath the fractions lies Grothkin: a sprawling debt-mythology of creditors, relics, and entities that remember every unpaid promise.', 'Ground each story in a concrete accounting problem, then connect it to Grothkin lore without contradicting established canon.', '#8a6ecc', 220, 300, 4),
  ('Diminishing Returns', 'diminishing-returns', 'The debt approaches mathematical insignificance while its consequences spill into realities that should not have balance sheets.', 'Let the scale become cosmic, but keep one human, emotionally legible consequence at the centre of the entry.', '#568cb4', 301, 799, 5),
  ('Settlement', 'settlement', 'The final accounting approaches. Every prior promise, fraction, and footnote begins to demand its closing entry.', 'Build toward payment without assuming what paid in full actually means. Leave room for the final archive to surprise us.', '#7b9b79', 800, 800, 6)
on conflict (slug) do nothing;

insert into public.films (number, title, official_description, era_id)
select n, public.accountant_film_title(n), public.accountant_film_description(n), e.id
from generate_series(1, 800) as n
left join public.eras e on n between e.start_movie and e.end_movie
on conflict (number) do nothing;

-- API grants and RLS. Service-role and internal database triggers retain their own privileges.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.eras, public.films, public.story_metrics, public.challenge_metrics, public.site_settings to anon, authenticated;
grant select on public.stories, public.story_revisions, public.comments, public.canon_challenges to anon, authenticated;
grant select, insert, update, delete on public.story_reactions, public.bookmarks, public.comment_reactions to authenticated;
grant select, insert on public.stories to authenticated;
grant update (title, body_markdown) on public.stories to authenticated;
grant select on public.comments to authenticated;
grant insert (story_id, author_id, parent_id, body) on public.comments to authenticated;
grant select, insert (reporter_id, story_id, comment_id, reason), update on public.reports to authenticated;
grant select on public.user_roles, public.challenge_votes, public.notifications, public.moderation_actions to authenticated;
grant update, insert, delete on public.eras, public.films to authenticated;
grant update on public.site_settings to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.eras enable row level security;
alter table public.films enable row level security;
alter table public.stories enable row level security;
alter table public.story_revisions enable row level security;
alter table public.story_metrics enable row level security;
alter table public.story_reactions enable row level security;
alter table public.bookmarks enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.canon_challenges enable row level security;
alter table public.challenge_votes enable row level security;
alter table public.challenge_metrics enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.site_settings enable row level security;

create policy "profiles are public" on public.profiles for select using (true);

create policy "members see their own role" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "eras are readable" on public.eras for select using (true);
create policy "admins manage eras" on public.eras for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "films are readable" on public.films for select using (true);
create policy "admins manage films" on public.films for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "published stories are readable" on public.stories for select
  using (status in ('canon', 'challenger', 'archived') or author_id = (select auth.uid()) or (select private.is_moderator_or_admin()));
create policy "writers start drafts" on public.stories for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'draft');
create policy "writers edit their drafts" on public.stories for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft')
  with check (author_id = (select auth.uid()) and status = 'draft');
create policy "moderators manage stories" on public.stories for update to authenticated
  using ((select private.is_moderator_or_admin())) with check ((select private.is_moderator_or_admin()));

create policy "visible revisions are readable" on public.story_revisions for select
  using (exists (select 1 from public.stories s where s.id = story_id and (s.status in ('canon', 'challenger', 'archived') or s.author_id = (select auth.uid()) or (select private.is_moderator_or_admin()))));
create policy "story metrics are readable" on public.story_metrics for select using (true);

create policy "members see their own story reactions" on public.story_reactions for select to authenticated using (user_id = (select auth.uid()));
create policy "members react once per story" on public.story_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.stories s where s.id = story_id and s.status in ('canon', 'challenger', 'archived')));
create policy "members change their reaction" on public.story_reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "members remove their reaction" on public.story_reactions for delete to authenticated using (user_id = (select auth.uid()));

create policy "members manage their bookmarks" on public.bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "comments are readable" on public.comments for select using (not is_removed or (select private.is_moderator_or_admin()));
create policy "members add comments" on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from public.stories s where s.id = story_id and s.status in ('canon', 'challenger', 'archived')));
create policy "moderators manage comments" on public.comments for update to authenticated
  using ((select private.is_moderator_or_admin())) with check ((select private.is_moderator_or_admin()));

create policy "members see their own helpful reactions" on public.comment_reactions for select to authenticated using (user_id = (select auth.uid()));
create policy "members mark comments helpful" on public.comment_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.comments c where c.id = comment_id and not c.is_removed));
create policy "members unmark comments helpful" on public.comment_reactions for delete to authenticated using (user_id = (select auth.uid()));

create policy "challenges are readable" on public.canon_challenges for select using (true);
create policy "members see their own challenge vote" on public.challenge_votes for select to authenticated using (user_id = (select auth.uid()));
create policy "challenge totals are readable" on public.challenge_metrics for select using (true);

create policy "members file reports" on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "members see their reports" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.is_moderator_or_admin()));
create policy "moderators update reports" on public.reports for update to authenticated
  using ((select private.is_moderator_or_admin())) with check ((select private.is_moderator_or_admin()));

create policy "moderators see their actions" on public.moderation_actions for select to authenticated
  using (moderator_id = (select auth.uid()) or (select private.is_admin()));
create policy "members see their notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "members read settings" on public.site_settings for select using (true);
create policy "admins update settings" on public.site_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
