-- Tighten Supabase's default RPC grants and add indexes for every non-covered FK.
revoke execute on function public.submit_story(uuid) from anon;
revoke execute on function public.update_my_profile(text, text, text) from anon;
revoke execute on function public.cast_challenge_vote(uuid, uuid) from anon;
revoke execute on function public.moderate_story(uuid, text, text) from anon;
revoke execute on function public.set_member_role(uuid, public.app_role) from anon;
revoke execute on function public.resolve_expired_challenges() from anon, authenticated;

create index bookmarks_by_member on public.bookmarks (user_id);
create index challenges_by_canon_story on public.canon_challenges (canon_story_id);
create index challenges_by_winning_story on public.canon_challenges (winning_story_id);
create index challenge_votes_by_story on public.challenge_votes (story_id);
create index challenge_votes_by_member on public.challenge_votes (user_id);
create index comment_reactions_by_member on public.comment_reactions (user_id);
create index comments_by_author on public.comments (author_id);
create index comments_by_parent on public.comments (parent_id);
create index films_by_era on public.films (era_id);
create index moderation_actions_by_moderator on public.moderation_actions (moderator_id);
create index reports_by_comment on public.reports (comment_id);
create index reports_by_handler on public.reports (handled_by);
create index reports_by_reporter on public.reports (reporter_id);
create index reports_by_story on public.reports (story_id);
create index stories_by_challenge_parent on public.stories (challenge_parent_id);
create index story_reactions_by_member on public.story_reactions (user_id);
create index user_roles_by_assigner on public.user_roles (assigned_by);

-- Keep public read policies separate from privileged write policies, avoiding duplicate SELECT checks.
drop policy "admins manage eras" on public.eras;
create policy "admins add eras" on public.eras for insert to authenticated
  with check ((select private.is_admin()));
create policy "admins update eras" on public.eras for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete eras" on public.eras for delete to authenticated
  using ((select private.is_admin()));

drop policy "admins manage films" on public.films;
create policy "admins add films" on public.films for insert to authenticated
  with check ((select private.is_admin()));
create policy "admins update films" on public.films for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete films" on public.films for delete to authenticated
  using ((select private.is_admin()));

drop policy "moderators manage stories" on public.stories;
