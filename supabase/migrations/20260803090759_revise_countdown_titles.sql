-- The countdown is intentionally human-scale: 3, 2, 1, then 1/2, 1/3, 1/4…
-- Keep the generator and its seeded rows in lockstep so remote and local browsing agree.
create or replace function public.accountant_film_title(p_number integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_number = 800 then 'Paid In Full'
    when p_number = 1 then 'Time to Pay'
    when p_number = 2 then 'The Collector Is Here'
    when p_number between 3 and 30 then (array[
      'The Ledger Never Sleeps', 'Outstanding Balance', 'Due Yesterday', 'A Gentle Reminder', 'Second Notice',
      'The Accounts Receivable', 'Collections Department', 'Interest Accrued', 'Open Invoice', 'Paper Trail',
      'The Cost of Delay', 'Unpaid in the City', 'Balance Pending', 'Terms and Conditions', 'Past Due',
      'The Follow-Up', 'Reconciliation', 'Delinquent', 'The Last Receipt', 'Notice of Intent',
      'Final Ledger', 'Accountability', 'The Debt Knows Your Name', 'Obligation', 'Collection Day',
      'The Auditor Watches', 'No Extension', 'Payment Plan'
    ])[p_number - 2]
    when p_number between 31 and 40 then (array[
      'This Is the Last Chance', 'Okay, Very Last Chance', 'I’m Counting Down', 'You Have Been Warned', 'Notice of Notice',
      'A Final Final Notice', 'The Deadline', 'No More Reminders', 'Please Pay', 'The Last Last Chance'
    ])[p_number - 30]
    when p_number = 41 then '3'
    when p_number = 42 then '2'
    when p_number = 43 then '1'
    when p_number between 44 and 799 then '1/' || (p_number - 42)::text
    else 'Untitled Ledger Entry'
  end;
$$;

create or replace function public.accountant_film_description(p_number integer)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_number = 800 then 'The balance finally reaches zero. Whether that means relief, a loophole, or something worse is up to the archive.'
    when p_number between 1 and 30 then 'The accountant follows another lead on the debtor’s file and finds that a simple collection job is becoming personal.'
    when p_number between 31 and 40 then 'The notices get sharper and the office loses patience. The debtor still does not answer.'
    when p_number between 220 and 300 then 'Grothkin Lore era. The smaller the debt gets, the more it pulls the accountant into old records and stranger obligations.'
    when p_number = 41 then 'The accountant starts a countdown at three. It should be simple. It is not.'
    when p_number = 42 then 'The count reaches two, and the debtor shows signs of knowing exactly what it means.'
    when p_number = 43 then 'One is left. Everyone in the office is waiting to see what comes next.'
    when p_number between 44 and 799 then 'The accountant keeps counting in smaller pieces. The debt is shrinking, but nobody is getting any closer to being done.'
    else 'A missing archive entry still needs its official description.'
  end;
$$;

update public.eras
set description = case slug
  when 'debt-collection' then 'An accountant is trying to recover one ordinary unpaid debt. At first, the job still looks normal.'
  when 'final-notices' then 'The reminders become more pointed, and the debtor’s silence starts to feel deliberate.'
  when 'long-division' then 'The accountant starts counting down. Nobody is quite sure what happens when the count runs out.'
  when 'grothkin-lore' then 'The story opens up into Grothkin: old creditors, strange records, and things that take unpaid promises seriously.'
  when 'diminishing-returns' then 'The number gets smaller, but the debt keeps spreading into places it should not be able to reach.'
  when 'settlement' then 'The last film is close. Every promise, shortcut, and missing receipt has caught up with the accountant.'
  else description
end,
writing_guidelines = case slug
  when 'debt-collection' then 'Keep it close to real life: calls, offices, notices, and the first signs that this debt is not routine.'
  when 'final-notices' then 'Raise the pressure and the absurdity, but do not settle the debt yet.'
  when 'long-division' then 'Treat the countdown as a real problem. Keep the person or force behind it unclear.'
  when 'grothkin-lore' then 'Start with a practical accounting problem, then connect it to Grothkin without breaking what has already been established.'
  when 'diminishing-returns' then 'Let things get strange, but give each story one clear human consequence.'
  when 'settlement' then 'Build toward payment without deciding in advance what “paid in full” actually means.'
  else writing_guidelines
end;

update public.films
set title = public.accountant_film_title(number),
    official_description = public.accountant_film_description(number)
where number between 1 and 800;
