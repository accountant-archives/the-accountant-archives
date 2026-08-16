-- The Fact Sheet is a sourced community record, not an approval queue.
-- Existing facts are untouched; new entries publish directly with a cited story.

drop policy if exists "eligible members add pending facts" on public.fact_nodes;
drop policy if exists "authors edit their pending facts" on public.fact_nodes;
drop policy if exists "moderators review facts" on public.fact_nodes;
drop policy if exists "established members add story citations" on public.fact_sources;

revoke insert, update on public.fact_nodes from authenticated;
revoke insert on public.fact_sources from authenticated;
grant insert on public.fact_nodes to authenticated;
grant update (title, body, parent_id, sort_order) on public.fact_nodes to authenticated;
grant insert on public.fact_sources to authenticated;

create policy "members publish sourced facts" on public.fact_nodes for insert
  to authenticated
  with check (author_id = (select auth.uid()) and status = 'confirmed');

create policy "authors edit their sourced facts" on public.fact_nodes for update
  to authenticated
  using (author_id = (select auth.uid()) and status = 'confirmed')
  with check (author_id = (select auth.uid()) and status = 'confirmed');

create policy "members add story citations" on public.fact_sources for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fact_nodes n
      join public.stories s on s.id = story_id
      where n.id = fact_id
        and n.status = 'confirmed'
        and s.status in ('canon', 'challenger', 'archived')
    )
  );

create table public.fact_reactions (
  fact_id uuid not null references public.fact_nodes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fact_id, user_id)
);

create table public.fact_metrics (
  fact_id uuid primary key references public.fact_nodes(id) on delete cascade,
  supports integer not null default 0 check (supports >= 0),
  disputes integer not null default 0 check (disputes >= 0),
  sources integer not null default 0 check (sources >= 0),
  updated_at timestamptz not null default now()
);

insert into public.fact_metrics (fact_id, sources)
select n.id, count(s.id)
from public.fact_nodes n
left join public.fact_sources s on s.fact_id = n.id
group by n.id
on conflict (fact_id) do update set sources = excluded.sources, updated_at = now();

create or replace function private.sync_fact_metrics(p_fact_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fact_metrics (fact_id, supports, disputes, sources, updated_at)
  select p_fact_id,
    count(distinct r.user_id) filter (where r.value = 1),
    count(distinct r.user_id) filter (where r.value = -1),
    count(distinct s.id), now()
  from public.fact_nodes n
  left join public.fact_reactions r on r.fact_id = n.id
  left join public.fact_sources s on s.fact_id = n.id
  where n.id = p_fact_id
  group by n.id
  on conflict (fact_id) do update set
    supports = excluded.supports,
    disputes = excluded.disputes,
    sources = excluded.sources,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function private.sync_fact_metrics(uuid) from public;

create or replace function private.on_fact_reaction_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_fact_metrics(coalesce(new.fact_id, old.fact_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_fact_reaction_change() from public;

create or replace function private.on_fact_source_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_fact_metrics(coalesce(new.fact_id, old.fact_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_fact_source_change() from public;

create trigger sync_fact_reactions after insert or update or delete on public.fact_reactions
  for each row execute procedure private.on_fact_reaction_change();
create trigger sync_fact_sources after insert or update or delete on public.fact_sources
  for each row execute procedure private.on_fact_source_change();

alter table public.fact_reactions enable row level security;
alter table public.fact_metrics enable row level security;
grant select on public.fact_metrics to anon, authenticated;
grant select, insert, update, delete on public.fact_reactions to authenticated;

create policy "fact metrics are public" on public.fact_metrics for select to anon, authenticated using (true);
create policy "members see their own fact reaction" on public.fact_reactions for select to authenticated using (user_id = (select auth.uid()));
create policy "members react to sourced facts" on public.fact_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.fact_nodes where id = fact_id and status = 'confirmed'));
create policy "members change their fact reaction" on public.fact_reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "members remove their fact reaction" on public.fact_reactions for delete to authenticated
  using (user_id = (select auth.uid()));
