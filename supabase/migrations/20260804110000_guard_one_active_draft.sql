create or replace function public.guard_one_active_draft()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'draft' and exists (
    select 1 from public.stories
    where author_id = new.author_id
      and film_number = new.film_number
      and status = 'draft'
      and id <> new.id
  ) then
    raise exception 'Only one active draft is allowed per writer per film'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_one_active_draft on public.stories;
create trigger guard_one_active_draft
before insert on public.stories
for each row execute function public.guard_one_active_draft();
