-- Community fan art is kept in a private bucket until it passes the gallery review.
-- Existing archive data is not changed by this migration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fan-art', 'fan-art', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.fan_art (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null unique check (char_length(image_path) between 12 and 500),
  caption text not null check (char_length(trim(caption)) between 3 and 500),
  alt_text text not null check (char_length(trim(alt_text)) between 3 and 280),
  film_number integer references public.films(number) on delete set null,
  safety_status text not null default 'pending' check (safety_status in ('pending', 'approved', 'rejected')),
  safety_note text not null default '' check (char_length(safety_note) <= 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fan_art_reactions (
  art_id uuid not null references public.fan_art(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (art_id, user_id)
);

create table public.fan_art_comments (
  id uuid primary key default gen_random_uuid(),
  art_id uuid not null references public.fan_art(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 2 and 3000),
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fan_art_reports (
  id uuid primary key default gen_random_uuid(),
  art_id uuid not null references public.fan_art(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 10 and 1000),
  status public.report_status not null default 'open',
  handled_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (art_id, reporter_id)
);

create index fan_art_gallery_order on public.fan_art (safety_status, is_removed, created_at desc);
create index fan_art_by_author on public.fan_art (author_id, created_at desc);
create index fan_art_comments_by_art on public.fan_art_comments (art_id, created_at);
create index fan_art_reports_by_status on public.fan_art_reports (status, created_at);

create trigger touch_fan_art_updated_at
  before update on public.fan_art
  for each row execute procedure private.touch_updated_at();
create trigger touch_fan_art_comments_updated_at
  before update on public.fan_art_comments
  for each row execute procedure private.touch_updated_at();
create trigger touch_fan_art_reports_updated_at
  before update on public.fan_art_reports
  for each row execute procedure private.touch_updated_at();

alter table public.fan_art enable row level security;
alter table public.fan_art_reactions enable row level security;
alter table public.fan_art_comments enable row level security;
alter table public.fan_art_reports enable row level security;

grant select on public.fan_art, public.fan_art_reactions, public.fan_art_comments to anon, authenticated;
grant select on public.fan_art_reports to authenticated;
grant insert, update, delete on public.fan_art, public.fan_art_reactions, public.fan_art_comments, public.fan_art_reports to authenticated;

create policy "published fan art is readable" on public.fan_art for select
  to anon, authenticated using (
    (safety_status = 'approved' and not is_removed)
    or author_id = (select auth.uid())
    or (select private.is_moderator_or_admin())
  );
create policy "members submit fan art for review" on public.fan_art for insert
  to authenticated with check (author_id = (select auth.uid()) and safety_status = 'pending' and not is_removed);
create policy "artists edit their pending fan art" on public.fan_art for update
  to authenticated using (author_id = (select auth.uid()) and safety_status = 'pending')
  with check (author_id = (select auth.uid()) and safety_status = 'pending' and not is_removed);
create policy "artists remove their pending fan art" on public.fan_art for delete
  to authenticated using (author_id = (select auth.uid()) and safety_status = 'pending');
create policy "moderators review fan art" on public.fan_art for update
  to authenticated using ((select private.is_moderator_or_admin()))
  with check ((select private.is_moderator_or_admin()));

create policy "published art reactions are readable" on public.fan_art_reactions for select
  to anon, authenticated using (exists (select 1 from public.fan_art a where a.id = art_id and a.safety_status = 'approved' and not a.is_removed));
create policy "members react to published art" on public.fan_art_reactions for insert
  to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.fan_art a where a.id = art_id and a.safety_status = 'approved' and not a.is_removed));
create policy "members remove their art reactions" on public.fan_art_reactions for delete
  to authenticated using (user_id = (select auth.uid()));

create policy "published art comments are readable" on public.fan_art_comments for select
  to anon, authenticated using (not is_removed and exists (select 1 from public.fan_art a where a.id = art_id and a.safety_status = 'approved' and not a.is_removed));
create policy "members comment on published art" on public.fan_art_comments for insert
  to authenticated with check (author_id = (select auth.uid()) and exists (select 1 from public.fan_art a where a.id = art_id and a.safety_status = 'approved' and not a.is_removed));
create policy "moderators manage art comments" on public.fan_art_comments for update
  to authenticated using ((select private.is_moderator_or_admin())) with check ((select private.is_moderator_or_admin()));

create policy "members file art reports" on public.fan_art_reports for insert
  to authenticated with check (reporter_id = (select auth.uid()));
create policy "members and moderators read art reports" on public.fan_art_reports for select
  to authenticated using (reporter_id = (select auth.uid()) or (select private.is_moderator_or_admin()));
create policy "moderators update art reports" on public.fan_art_reports for update
  to authenticated using ((select private.is_moderator_or_admin())) with check ((select private.is_moderator_or_admin()));

create policy "approved fan art files are readable" on storage.objects for select
  to anon, authenticated using (
    bucket_id = 'fan-art' and (
      exists (select 1 from public.fan_art a where a.image_path = name and a.safety_status = 'approved' and not a.is_removed)
      or owner_id = (select auth.uid()::text)
      or (select private.is_moderator_or_admin())
    )
  );
create policy "artists upload their own fan art files" on storage.objects for insert
  to authenticated with check (bucket_id = 'fan-art' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "artists delete their own pending fan art files" on storage.objects for delete
  to authenticated using (
    bucket_id = 'fan-art'
    and owner_id = (select auth.uid()::text)
    and not exists (
      select 1 from public.fan_art a
      where a.image_path = name
        and a.safety_status = 'approved'
        and not a.is_removed
    )
  );
