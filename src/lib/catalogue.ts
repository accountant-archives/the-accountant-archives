export type Era = {
  id?: string
  name: string
  slug: string
  description: string
  writing_guidelines: string
  accent: string
  start_movie: number
  end_movie: number
  display_order: number
}

export type Film = {
  number: number
  title: string
  official_description: string
  era: Era
}

export const ERAS: Era[] = [
  { name: 'Debt Collection', slug: 'debt-collection', description: 'An accountant is trying to recover one ordinary unpaid debt. At first, the job still looks normal.', writing_guidelines: 'Keep it close to real life: calls, offices, notices, and the first signs that this debt is not routine.', accent: '#c75c48', start_movie: 1, end_movie: 30, display_order: 1 },
  { name: 'Final Notices', slug: 'final-notices', description: 'The reminders become more pointed, and the debtor’s silence starts to feel deliberate.', writing_guidelines: 'Raise the pressure and the absurdity, but do not settle the debt yet.', accent: '#e78d4b', start_movie: 31, end_movie: 40, display_order: 2 },
  { name: 'The Long Division', slug: 'long-division', description: 'The accountant starts counting down. Nobody is quite sure what happens when the count runs out.', writing_guidelines: 'Treat the countdown as a real problem. Keep the person or force behind it unclear.', accent: '#d4b353', start_movie: 41, end_movie: 219, display_order: 3 },
  { name: 'Grothkin Lore', slug: 'grothkin-lore', description: 'The story opens up into Grothkin: old creditors, strange records, and things that take unpaid promises seriously.', writing_guidelines: 'Start with a practical accounting problem, then connect it to Grothkin without breaking what has already been established.', accent: '#8a6ecc', start_movie: 220, end_movie: 300, display_order: 4 },
  { name: 'Diminishing Returns', slug: 'diminishing-returns', description: 'The number gets smaller, but the debt keeps spreading into places it should not be able to reach.', writing_guidelines: 'Let things get strange, but give each story one clear human consequence.', accent: '#568cb4', start_movie: 301, end_movie: 799, display_order: 5 },
  { name: 'Settlement', slug: 'settlement', description: 'The last film is close. Every promise, shortcut, and missing receipt has caught up with the accountant.', writing_guidelines: 'Build toward payment without deciding in advance what “paid in full” actually means.', accent: '#7b9b79', start_movie: 800, end_movie: 800, display_order: 6 }
]

const collectorTitles = [
  'Time to Pay', 'The Collector Is Here', 'The Ledger Never Sleeps', 'Outstanding Balance', 'Due Yesterday', 'A Gentle Reminder', 'Second Notice', 'The Accounts Receivable', 'Collections Department', 'Interest Accrued', 'Open Invoice', 'Paper Trail', 'The Cost of Delay', 'Unpaid in the City', 'Balance Pending', 'Terms and Conditions', 'Past Due', 'The Follow-Up', 'Reconciliation', 'Delinquent', 'The Last Receipt', 'Notice of Intent', 'Final Ledger', 'Accountability', 'The Debt Knows Your Name', 'Obligation', 'Collection Day', 'The Auditor Watches', 'No Extension', 'Payment Plan'
]

const noticeTitles = ['This Is the Last Chance', 'Okay, Very Last Chance', 'I’m Counting Down', 'You Have Been Warned', 'Notice of Notice', 'A Final Final Notice', 'The Deadline', 'No More Reminders', 'Please Pay', 'The Last Last Chance']

export function titleForFilm(number: number) {
  if (number === 800) return 'Paid In Full'
  if (number <= 30) return collectorTitles[number - 1]
  if (number <= 40) return noticeTitles[number - 31]
  if (number === 41) return '3'
  if (number === 42) return '2'
  if (number === 43) return '1'
  return `1/${number - 42}`
}

export function descriptionForFilm(number: number) {
  if (number === 800) return 'The balance finally reaches zero. Whether that means relief, a loophole, or something worse is up to the archive.'
  if (number <= 30) return 'The accountant follows another lead on the debtor’s file and finds that a simple collection job is becoming personal.'
  if (number <= 40) return 'The notices get sharper and the office loses patience. The debtor still does not answer.'
  if (number >= 220 && number <= 300) return 'Grothkin Lore era. The smaller the debt gets, the more it pulls the accountant into old records and stranger obligations.'
  if (number === 41) return 'The accountant starts a countdown at three. It should be simple. It is not.'
  if (number === 42) return 'The count reaches two, and the debtor shows signs of knowing exactly what it means.'
  if (number === 43) return 'One is left. Everyone in the office is waiting to see what comes next.'
  return 'The accountant keeps counting in smaller pieces. The debt is shrinking, but nobody is getting any closer to being done.'
}

export function eraForFilm(number: number, eras = ERAS) {
  return eras.find((era) => number >= era.start_movie && number <= era.end_movie) ?? ERAS[4]
}

export function filmForNumber(number: number, eras = ERAS): Film {
  return { number, title: titleForFilm(number), official_description: descriptionForFilm(number), era: eraForFilm(number, eras) }
}

export function words(text: string) {
  const clean = text.trim()
  return clean ? clean.split(/\s+/).length : 0
}

export function readingTime(wordCount: number) {
  return Math.max(1, Math.ceil(wordCount / 220))
}
