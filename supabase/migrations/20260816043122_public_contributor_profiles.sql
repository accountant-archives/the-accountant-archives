-- Public profiles are readable by everyone, while members may only edit
-- their own presentation fields. Account identity and points stay server-owned.

revoke update on table public.profiles from authenticated;
grant update (display_name, bio, avatar_url) on table public.profiles to authenticated;

drop policy if exists "members update their own public profile" on public.profiles;
create policy "members update their own public profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
