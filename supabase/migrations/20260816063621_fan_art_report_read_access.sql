-- The review queue is protected by RLS, but moderators still need table-level read access.
grant select on public.fan_art_reports to authenticated;
