-- New contributions publish immediately. Moderation is reactive: reports can hide work,
-- but new stories, facts, and gallery contributions do not wait for a manual decision.
-- Existing pending rows are deliberately left untouched; they were submitted with the
-- expectation of review and must not be exposed by a policy migration.

-- Fan art
alter table public.fan_art alter column safety_status set default 'approved';
drop policy "members submit fan art for review" on public.fan_art;
drop policy "artists edit their pending fan art" on public.fan_art;
drop policy "artists remove their pending fan art" on public.fan_art;
create policy "members publish fan art" on public.fan_art for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and safety_status = 'approved'
    and not is_removed
  );

-- The Fact Sheet already publishes sourced entries immediately; its existing
-- "members publish sourced facts" policy needs no review-path change.
