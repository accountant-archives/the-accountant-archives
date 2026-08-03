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
  { name: 'Debt Collection', slug: 'debt-collection', description: 'One accountant, one debtor, and a balance that should have been settled before the opening credits.', writing_guidelines: 'Keep it grounded: offices, calls, notices, and a pressure that has not yet become supernatural.', accent: '#c75c48', start_movie: 1, end_movie: 30, display_order: 1 },
  { name: 'Final Notices', slug: 'final-notices', description: 'The paperwork gets louder. The bureaucracy is starting to take the debtor’s silence personally.', writing_guidelines: 'Escalate the urgency and absurdity without resolving the debt.', accent: '#e78d4b', start_movie: 31, end_movie: 40, display_order: 2 },
  { name: 'The Long Division', slug: 'long-division', description: 'A countdown begins. Ordinary time becomes just another negotiable term.', writing_guidelines: 'Treat the countdown as real and consequential. Preserve the mystery of who is keeping pace.', accent: '#d4b353', start_movie: 41, end_movie: 219, display_order: 3 },
  { name: 'Grothkin Lore', slug: 'grothkin-lore', description: 'The debt-mythology of Grothkin surfaces: creditors, relics, and entities who remember every unpaid promise.', writing_guidelines: 'Ground each entry in accounting, then connect it to Grothkin without contradicting established canon.', accent: '#8a6ecc', start_movie: 220, end_movie: 300, display_order: 4 },
  { name: 'Diminishing Returns', slug: 'diminishing-returns', description: 'The debt approaches mathematical insignificance while its consequences become cosmically significant.', writing_guidelines: 'Let the scale become strange, but keep one human consequence at the centre.', accent: '#568cb4', start_movie: 301, end_movie: 799, display_order: 5 },
  { name: 'Settlement', slug: 'settlement', description: 'The closing entry is finally in sight. Every prior promise wants to be counted.', writing_guidelines: 'Build toward payment without deciding what “paid in full” means.', accent: '#7b9b79', start_movie: 800, end_movie: 800, display_order: 6 }
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
  return `1 / 2^${number - 43}`
}

export function descriptionForFilm(number: number) {
  if (number === 800) return 'At last, the balance reaches zero. Whether this is closure, a loophole, or the beginning of a new debt is left to the archives.'
  if (number <= 30) return 'The accountant follows another thread in the debtor’s paper trail, discovering that routine collection is becoming uncomfortably personal.'
  if (number <= 40) return 'The notices become theatrical and the office grows impatient. Every stamped envelope makes the debtor’s silence feel more deliberate.'
  if (number >= 220 && number <= 300) return 'Grothkin Lore era. The ever-smaller debt pulls the accountant into a buried mythology where invoices are treated as sacred prophecies.'
  if (number === 41) return 'The accountant starts the countdown with impossible confidence. Three is more than enough time, surely.'
  if (number === 42) return 'The second mark on the countdown exposes an unsettling fact: the debtor has been counting too.'
  if (number === 43) return 'One final whole unit of patience remains. The office holds its breath.'
  return 'As the fraction shrinks, the stakes grow absurdly vast. The ledger insists there is still something left to collect.'
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
