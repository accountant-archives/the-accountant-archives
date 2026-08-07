-- Fact Sheet follow-up: collaborators can add evidence and flag conflicts
-- without being able to alter someone else's confirmed wording.

create table public.fact_disputes (
  id uuid primary key default extensions.gen_random_uuid(),
  fact_id uuid not null references public.fact_nodes(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  handled_by uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 20 and 1200),
  status public.report_status not null default 'open',
  resolution_note text not null default '' check (char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fact_id, reporter_id, status)
);
create index fact_disputes_by_status on public.fact_disputes(status, created_at asc);
create index fact_disputes_by_fact on public.fact_disputes(fact_id, created_at desc);

create trigger touch_fact_disputes_updated_at
  before update on public.fact_disputes
  for each row execute procedure private.touch_updated_at();

alter table public.fact_disputes enable row level security;
grant select, insert, update on public.fact_disputes to authenticated;

create policy "reporters see their fact disputes" on public.fact_disputes for select
  to authenticated
  using (reporter_id = (select auth.uid()) or (select private.is_moderator_or_admin()));

create policy "members report fact conflicts" on public.fact_disputes for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.fact_nodes where id = fact_id and status = 'confirmed')
  );

create policy "moderators resolve fact disputes" on public.fact_disputes for update
  to authenticated
  using ((select private.is_moderator_or_admin()))
  with check ((select private.is_moderator_or_admin()));

drop policy "authors cite their pending facts" on public.fact_sources;
create policy "established members add story citations" on public.fact_sources for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.fact_nodes n
      join public.stories s on s.id = story_id
      join public.profiles p on p.id = (select auth.uid())
      where n.id = fact_id
        and n.status in ('pending', 'confirmed')
        and s.status in ('canon', 'challenger', 'archived')
        and p.ledger_balance >= 50
    )
  );
