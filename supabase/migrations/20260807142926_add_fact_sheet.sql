-- Community Fact Sheet: a small, sourced wiki for the shared canon.
-- A fact becomes public only once a moderator confirms it, and every fact
-- must be anchored to a published story before the UI permits confirmation.

create table public.fact_nodes (
  id uuid primary key default extensions.gen_random_uuid(),
  parent_id uuid references public.fact_nodes(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(trim(title)) between 5 and 120),
  body text not null check (char_length(trim(body)) between 20 and 6000),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fact_nodes_by_parent on public.fact_nodes(parent_id, sort_order, created_at);
create index fact_nodes_by_status on public.fact_nodes(status, created_at desc);

create table public.fact_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  fact_id uuid not null references public.fact_nodes(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete restrict,
  quoted_text text not null check (char_length(trim(quoted_text)) between 12 and 1200),
  note text not null default '' check (char_length(note) <= 400),
  created_at timestamptz not null default now(),
  unique (fact_id, story_id, quoted_text)
);
create index fact_sources_by_fact on public.fact_sources(fact_id);

create trigger touch_fact_nodes_updated_at
  before update on public.fact_nodes
  for each row execute procedure private.touch_updated_at();

alter table public.fact_nodes enable row level security;
alter table public.fact_sources enable row level security;
grant select on public.fact_nodes, public.fact_sources to anon, authenticated;
grant insert, update on public.fact_nodes to authenticated;
grant insert on public.fact_sources to authenticated;

create policy "confirmed facts are public" on public.fact_nodes for select
  to anon, authenticated
  using (
    status = 'confirmed'
    or author_id = (select auth.uid())
    or (select private.is_moderator_or_admin())
  );

create policy "eligible members add pending facts" on public.fact_nodes for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and ledger_balance >= 50
    )
  );

create policy "authors edit their pending facts" on public.fact_nodes for update
  to authenticated
  using (author_id = (select auth.uid()) and status = 'pending')
  with check (author_id = (select auth.uid()) and status = 'pending');

create policy "moderators review facts" on public.fact_nodes for update
  to authenticated
  using ((select private.is_moderator_or_admin()))
  with check ((select private.is_moderator_or_admin()));

create policy "fact sources follow fact visibility" on public.fact_sources for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.fact_nodes n
      where n.id = fact_id
        and (
          n.status = 'confirmed'
          or n.author_id = (select auth.uid())
          or (select private.is_moderator_or_admin())
        )
    )
  );

create policy "authors cite their pending facts" on public.fact_sources for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fact_nodes n
      join public.stories s on s.id = story_id
      where n.id = fact_id
        and n.author_id = (select auth.uid())
        and n.status = 'pending'
        and s.status in ('canon', 'challenger', 'archived')
    )
  );
