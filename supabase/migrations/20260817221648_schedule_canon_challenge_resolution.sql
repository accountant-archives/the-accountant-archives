-- Challenges close on their recorded deadline, even when nobody has the site open.
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'resolve-expired-canon-challenges';

select cron.schedule(
  'resolve-expired-canon-challenges',
  '* * * * *',
  $$select public.resolve_expired_challenges();$$
);

-- Clear any challenge that expired before the scheduler was installed.
select public.resolve_expired_challenges();
