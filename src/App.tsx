import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bookmark, Check, ChevronRight, Clock3,
  FilePenLine, Flag, Gavel, Grid3X3, Layers3, LoaderCircle, LockKeyhole, Menu, MessageCircle,
  MoveRight, PenLine, Search, Send, Settings2, ShieldCheck, Sparkles, Trophy, UserRound, X
} from 'lucide-react'
import { ERAS, descriptionForFilm, eraForFilm, filmForNumber, readingTime, titleForFilm, words, type Era, type Film } from './lib/catalogue'
import { isSupabaseConfigured, signInWithGoogle, supabase } from './lib/supabase'

type Page = 'home' | 'archive' | 'timeline' | 'film' | 'write' | 'desk' | 'submitted' | 'admin'
type Role = 'writer' | 'moderator' | 'admin'
type Member = { id: string; handle: string; displayName: string; ledger: number; role: Role; avatarUrl?: string | null }
type Story = {
  id: string
  title: string
  body: string
  filmNumber: number
  status: 'draft' | 'submitted' | 'canon' | 'challenger' | 'archived' | 'rejected'
  author: { handle: string; displayName: string; ledger: number }
  wordCount: number
  readingMinutes: number
  createdAt: string
  metrics: { upvotes: number; downvotes: number; bookmarks: number; comments: number }
  continuityNote?: string
  viewerReaction?: 1 | -1
  viewerBookmarked?: boolean
}

const initialDraft = {
  title: '',
  body: '',
  continuityNote: ''
}

const showcaseStories: Story[] = [
  {
    id: 'showcase-time-to-pay', title: 'The Writ of 9', filmNumber: 1, status: 'canon',
    body: 'At 8:59, Arthur Vale closes the month-end workbook. At 9:00, the name in cell F19 changes from M. Dyer to a blank space. The invoice remains, but now it is addressed to him.\n\nArthur checks the audit log. It says the change was made tomorrow.',
    author: { handle: 'mothledger', displayName: 'Moth Ledger', ledger: 1284 }, wordCount: 74, readingMinutes: 1, createdAt: '2026-07-29T09:00:00Z', metrics: { upvotes: 143, downvotes: 4, bookmarks: 38, comments: 22 }
  },
  {
    id: 'showcase-three', title: 'The Third Reminder', filmNumber: 41, status: 'challenger',
    body: 'The number arrived by fax, although the fax machine had been disconnected since 1998. Three was written in the same red ink as the debtor’s original signature.',
    author: { handle: 'lornes', displayName: 'Lorne S.', ledger: 638 }, wordCount: 45, readingMinutes: 1, createdAt: '2026-08-01T09:00:00Z', metrics: { upvotes: 87, downvotes: 3, bookmarks: 21, comments: 15 }
  },
  {
    id: 'showcase-grothkin', title: 'A Deposit Made in Teeth', filmNumber: 220, status: 'canon',
    body: 'Grothkin had no mouth in the ordinary sense. It still insisted on a receipt.',
    author: { handle: 'marginalia', displayName: 'Mara Gin', ledger: 2218 }, wordCount: 34, readingMinutes: 1, createdAt: '2026-08-02T13:40:00Z', metrics: { upvotes: 412, downvotes: 8, bookmarks: 119, comments: 65 }
  }
]

function classNames(...names: Array<string | false | undefined>) { return names.filter(Boolean).join(' ') }
function formatNumber(value: number) { return new Intl.NumberFormat('en-AU').format(value) }
function relativeDate(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [member, setMember] = useState<Member | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [eras, setEras] = useState<Era[]>(ERAS)
  const [focusedFilm, setFocusedFilm] = useState(1)
  const [remoteFilm, setRemoteFilm] = useState<Film | null>(null)
  const [stories, setStories] = useState<Story[]>([])
  const [filmLoading, setFilmLoading] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [eraFilter, setEraFilter] = useState('all')
  const [draft, setDraft] = useState(initialDraft)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [timelineFocus, setTimelineFocus] = useState<string | null>(null)
  const [adminQueue, setAdminQueue] = useState<Story[]>([])
  const [myStories, setMyStories] = useState<Story[]>([])
  const [lastSubmission, setLastSubmission] = useState<Story | null>(null)
  const [filmStates, setFilmStates] = useState<Record<number, 'open' | 'canon' | 'challenger'>>({})
  const autosave = useRef<number | undefined>(undefined)

  const currentFilm = remoteFilm ?? filmForNumber(focusedFilm, eras)
  const currentEra = currentFilm.era
  const allFilms = useMemo(() => Array.from({ length: 800 }, (_, index) => filmForNumber(index + 1, eras)), [eras])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 3800)
  }

  function go(next: Page) {
    setPage(next)
    const target = next === 'home' ? '' : `#/${next}`
    if (window.location.hash !== target) window.history.pushState({ page: next }, '', `${window.location.pathname}${target}`)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function hydrateMember(session: Session | null) {
    const client = supabase
    if (!client || !session) { setMember(null); setAuthLoading(false); return }
    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      client.from('profiles').select('handle, display_name, ledger_balance, avatar_url').eq('id', session.user.id).single(),
      client.from('user_roles').select('role').eq('user_id', session.user.id).single()
    ])
    setMember({
      id: session.user.id,
      handle: profile?.handle ?? 'new-writer',
      displayName: profile?.display_name ?? session.user.user_metadata.full_name ?? 'New Writer',
      ledger: profile?.ledger_balance ?? 0,
      avatarUrl: profile?.avatar_url,
      role: (roleRow?.role as Role | undefined) ?? 'writer'
    })
    setAuthLoading(false)
  }

  useEffect(() => {
    const client = supabase
    if (!client) return
    void client.auth.getSession().then(({ data }) => void hydrateMember(data.session))
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => void hydrateMember(session))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (!supabase) return; void supabase.from('stories').select('film_number,status').in('status', ['canon', 'challenger']).then(({ data }) => { const states: Record<number, 'open' | 'canon' | 'challenger'> = {}; for (const entry of data ?? []) { const row = entry as { film_number: number; status: 'canon' | 'challenger' }; states[row.film_number] = row.status === 'challenger' ? 'challenger' : (states[row.film_number] ?? 'canon') }; setFilmStates(states) }) }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    void client.from('eras').select('*').order('display_order').then(({ data, error }) => {
      if (!error && data?.length) setEras(data as Era[])
    })
  }, [])

  async function loadFilm(number: number) {
    setFocusedFilm(number)
    const client = supabase
    if (!client) {
      setRemoteFilm(null)
      setStories(showcaseStories.filter((story) => story.filmNumber === number))
      return
    }
    setFilmLoading(true)
    setRemoteFilm(null)
    setStories([])
    const [filmResult, storyResult] = await Promise.all([
      client.from('films').select('number,title,official_description,era:eras(*)').eq('number', number).single(),
      client.from('stories').select('id,title,body_markdown,continuity_note,film_number,status,word_count,reading_minutes,created_at,author_id').eq('film_number', number).in('status', ['canon', 'challenger', 'archived']).order('created_at', { ascending: false })
    ])
    if (filmResult.data) {
      const raw = filmResult.data as unknown as { number: number; title: string; official_description: string; era: Era | null }
      setRemoteFilm({ number: raw.number, title: raw.title, official_description: raw.official_description, era: raw.era ?? eraForFilm(number, eras) })
    } else setRemoteFilm(null)
    if (storyResult.error) {
      setStories([])
    } else {
      const storyIds = (storyResult.data ?? []).map((entry) => (entry as { id: string }).id)
      const [{ data: metricRows }, { data: reactionRows }, { data: profileRows }] = storyIds.length ? await Promise.all([client.from('story_metrics').select('story_id,upvotes,downvotes,bookmarks,comments').in('story_id', storyIds), member ? client.from('story_reactions').select('story_id,value').eq('user_id', member.id).in('story_id', storyIds) : Promise.resolve({ data: [] as Array<{ story_id: string; value: 1 | -1 }> }), client.from('profiles').select('id,handle,display_name,ledger_balance')]) : [{ data: [] as Array<{ story_id: string; upvotes: number; downvotes: number; bookmarks: number; comments: number }> }, { data: [] as Array<{ story_id: string; value: 1 | -1 }> }, { data: [] as Array<{ id: string; handle: string; display_name: string; ledger_balance: number }> }]
      const metricByStory = new Map((metricRows ?? []).map((metric) => [metric.story_id, metric]))
      const reactionByStory = new Map((reactionRows ?? []).map((reaction) => [reaction.story_id, reaction.value]))
      const profileById = new Map((profileRows ?? []).map((profile) => [profile.id, profile]))
      const { data: bookmarkRows } = member && storyIds.length ? await client.from('bookmarks').select('story_id').eq('user_id', member.id).in('story_id', storyIds) : { data: [] as Array<{ story_id: string }> }
      const bookmarkedStoryIds = new Set((bookmarkRows ?? []).map((bookmark) => bookmark.story_id))
      const incoming = (storyResult.data ?? []).map((entry) => {
        const raw = entry as unknown as {
          id: string; title: string; body_markdown: string; continuity_note?: string; film_number: number; status: Story['status']; word_count: number; reading_minutes: number; created_at: string
          author_id: string
        }
        return {
          id: raw.id, title: raw.title, body: raw.body_markdown, filmNumber: raw.film_number, status: raw.status,
          wordCount: raw.word_count, readingMinutes: raw.reading_minutes, createdAt: raw.created_at, continuityNote: raw.continuity_note ?? '',
          author: { handle: profileById.get(raw.author_id)?.handle ?? 'unknown', displayName: profileById.get(raw.author_id)?.display_name ?? 'Unknown writer', ledger: profileById.get(raw.author_id)?.ledger_balance ?? 0 },
          metrics: (metricByStory.get(raw.id) as Story['metrics'] | undefined) ?? { upvotes: 0, downvotes: 0, bookmarks: 0, comments: 0 }, viewerReaction: reactionByStory.get(raw.id) as 1 | -1 | undefined, viewerBookmarked: bookmarkedStoryIds.has(raw.id)
        } satisfies Story
      })
      setStories(incoming)
    }
    setFilmLoading(false)
  }

  useEffect(() => { void loadFilm(focusedFilm) }, [])

  useEffect(() => {
    const restore = () => {
      const parts = window.location.hash.replace(/^#\/?/, '').split('/')
      const candidate = parts[0] as Page
      if (['home', 'archive', 'timeline', 'film', 'write', 'desk', 'submitted', 'admin'].includes(candidate)) setPage(candidate)
      const number = Number(parts[1]); if (candidate === 'film' && number >= 1 && number <= 800) void loadFilm(number)
    }
    restore(); window.addEventListener('popstate', restore); window.addEventListener('hashchange', restore)
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore) }
  }, [])

  function openFilm(number: number) {
    setDraft(initialDraft); setDraftId(null); setPreviewing(false)
    void loadFilm(number)
    go('film')
    window.history.replaceState({ page: 'film', number }, '', `${window.location.pathname}#/film/${number}`)
  }

  async function openWriter(number = focusedFilm) {
    if (!member) { setSignInOpen(true); return }
    await loadFilm(number)
    setDraft(initialDraft); setDraftId(null); setPreviewing(false)
    go('write')
  }

  async function login() {
    try {
      await signInWithGoogle()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to start sign in.')
    }
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    setMember(null)
    notify('Signed out of the archive.')
  }

  async function saveDraft(silent = false): Promise<string | null> {
    const client = supabase
    if (!client || !member) { if (!silent) setSignInOpen(true); return null }
    if (!draft.title.trim() && !draft.body.trim()) return draftId
    setDraftSaving(true)
    const payload = { title: draft.title.trim().length >= 5 ? draft.title.trim() : 'Untitled story', body_markdown: draft.body, continuity_note: draft.continuityNote.trim(), film_number: focusedFilm, author_id: member.id }
    let result
    if (draftId) {
      result = await client.from('stories').update({ title: payload.title, body_markdown: payload.body_markdown, continuity_note: payload.continuity_note }).eq('id', draftId).select('id').single()
    } else {
      const existing = await client.from('stories').select('id').eq('author_id', member.id).eq('film_number', focusedFilm).eq('status', 'draft').order('updated_at', { ascending: false }).limit(1).maybeSingle()
      result = existing.data
        ? await client.from('stories').update({ title: payload.title, body_markdown: payload.body_markdown, continuity_note: payload.continuity_note }).eq('id', existing.data.id).select('id').single()
        : await client.from('stories').insert(payload).select('id').single()
    }
    setDraftSaving(false)
    if (result.error) { if (!silent) notify(result.error.message); return null }
    const id = (result.data as { id: string }).id
    setDraftId(id)
    if (!silent) notify('Draft saved.')
    return id
  }

  useEffect(() => {
    if (page !== 'write' || !member || (!draft.title && !draft.body)) return
    window.clearTimeout(autosave.current)
    autosave.current = window.setTimeout(() => { void saveDraft(true) }, 1200)
    return () => window.clearTimeout(autosave.current)
  }, [draft.title, draft.body, draft.continuityNote, draftId, page, member?.id, focusedFilm])

  async function submitDraft() {
    const client = supabase
    if (draft.title.trim().length < 5) { notify('Give the story a title of at least 5 characters before publishing.'); return }
    if (!draft.continuityNote.trim()) { notify('Add a one-sentence hand-off for the next writer before publishing.'); return }
    const id = await saveDraft(true)
    if (!client || !id) return
    const { data, error } = await client.rpc('submit_story', { p_story_id: id })
    if (error) { notify(error.message); return }
    const submitted = data as unknown as Story
    setLastSubmission({ ...submitted, filmNumber: focusedFilm, body: draft.body, continuityNote: draft.continuityNote, author: member ? { handle: member.handle, displayName: member.displayName, ledger: member.ledger } : { handle: 'writer', displayName: 'Writer', ledger: 0 }, metrics: { upvotes: 0, downvotes: 0, bookmarks: 0, comments: 0 }, wordCount: words(draft.body), readingMinutes: readingTime(words(draft.body)), createdAt: new Date().toISOString() })
    setDraftId(null); setDraft(initialDraft); void loadMyStories(); go('submitted'); void loadFilm(focusedFilm)
  }

  async function loadMyStories() {
    if (!supabase || !member) { setMyStories([]); return }
    const { data, error } = await supabase.from('stories').select('id,title,body_markdown,continuity_note,film_number,status,word_count,reading_minutes,created_at,author_id,updated_at').eq('author_id', member.id).order('updated_at', { ascending: false })
    if (error) { notify(error.message); return }
    const seenDraftFilms = new Set<number>()
    setMyStories((data ?? []).filter((entry) => { const raw = entry as { film_number: number; status: Story['status'] }; if (raw.status !== 'draft') return true; if (seenDraftFilms.has(raw.film_number)) return false; seenDraftFilms.add(raw.film_number); return true }).map((entry) => { const raw = entry as any; return { id:raw.id,title:raw.title,body:raw.body_markdown,continuityNote:raw.continuity_note ?? '',filmNumber:raw.film_number,status:raw.status,wordCount:raw.word_count,readingMinutes:raw.reading_minutes,createdAt:raw.created_at,author:{handle:member.handle,displayName:member.displayName,ledger:member.ledger},metrics:{upvotes:0,downvotes:0,bookmarks:0,comments:0} } }))
  }

  function openDraft(story: Story) { setFocusedFilm(story.filmNumber); void loadFilm(story.filmNumber); setDraft({ title: story.title, body: story.body, continuityNote: story.continuityNote ?? '' }); setDraftId(story.id); go('write') }

  async function reactToStory(story: Story, value: 1 | -1) {
    if (!member || !supabase) { setSignInOpen(true); return }
    const removing = story.viewerReaction === value
    const { error } = removing
      ? await supabase.from('story_reactions').delete().eq('story_id', story.id).eq('user_id', member.id)
      : await supabase.from('story_reactions').upsert({ story_id: story.id, user_id: member.id, value }, { onConflict: 'story_id,user_id' })
    if (error) notify(error.message)
    else {
      setStories((all) => all.map((entry) => entry.id !== story.id ? entry : { ...entry, viewerReaction: removing ? undefined : value, metrics: { ...entry.metrics, upvotes: Math.max(0, entry.metrics.upvotes + (value === 1 ? (removing ? -1 : 1) : entry.viewerReaction === 1 ? -1 : 0)), downvotes: Math.max(0, entry.metrics.downvotes + (value === -1 ? (removing ? -1 : 1) : entry.viewerReaction === -1 ? -1 : 0)) } }))
      notify(removing ? 'Vote removed.' : value === 1 ? 'Support recorded.' : 'Vote recorded.')
      void loadFilm(focusedFilm)
    }
  }

  async function bookmarkStory(story: Story) {
    if (!member || !supabase) { setSignInOpen(true); return }
    const { error } = story.viewerBookmarked
      ? await supabase.from('bookmarks').delete().eq('story_id', story.id).eq('user_id', member.id)
      : await supabase.from('bookmarks').upsert({ story_id: story.id, user_id: member.id }, { onConflict: 'story_id,user_id' })
    if (error) notify(error.message); else { setStories((all) => all.map((entry) => entry.id === story.id ? { ...entry, viewerBookmarked: !entry.viewerBookmarked } : entry)); notify(story.viewerBookmarked ? 'Removed from saved stories.' : 'Story saved.') }
  }

  async function loadModerationQueue() {
    if (!supabase || !(member?.role === 'admin' || member?.role === 'moderator')) return
    const { data } = await supabase.from('stories').select('id,title,body_markdown,film_number,status,word_count,reading_minutes,created_at,author:profiles(handle,display_name,ledger_balance),metrics:story_metrics(upvotes,downvotes,bookmarks,comments)').eq('status', 'submitted').order('submitted_at')
    setAdminQueue((data ?? []).map((entry) => {
      const raw = entry as unknown as { id: string; title: string; body_markdown: string; film_number: number; status: Story['status']; word_count: number; reading_minutes: number; created_at: string; author: { handle: string; display_name: string; ledger_balance: number } | null; metrics: Story['metrics'] | null }
      return { id: raw.id, title: raw.title, body: raw.body_markdown, filmNumber: raw.film_number, status: raw.status, wordCount: raw.word_count, readingMinutes: raw.reading_minutes, createdAt: raw.created_at, author: { handle: raw.author?.handle ?? 'writer', displayName: raw.author?.display_name ?? 'Writer', ledger: raw.author?.ledger_balance ?? 0 }, metrics: raw.metrics ?? { upvotes: 0, downvotes: 0, bookmarks: 0, comments: 0 } }
    }))
  }

  async function moderate(story: Story, action: 'approve_canon' | 'archive' | 'reject') {
    if (!supabase) return
    const { error } = await supabase.rpc('moderate_story', { p_story_id: story.id, p_action: action, p_note: null })
    if (error) notify(error.message); else { notify(`Entry ${action.replace('_', ' ')}.`); void loadModerationQueue() }
  }

  function insertMarkdown(before: string, after = '') {
    const field = document.querySelector<HTMLTextAreaElement>('#story-body')
    const start = field?.selectionStart ?? draft.body.length
    const end = field?.selectionEnd ?? start
    const selection = draft.body.slice(start, end) || 'text'
    const body = `${draft.body.slice(0, start)}${before}${selection}${after}${draft.body.slice(end)}`
    setDraft((old) => ({ ...old, body }))
    window.requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start + before.length, start + before.length + selection.length) })
  }

  const nav = [
    { key: 'archive' as const, label: 'Archive', icon: BookOpen },
    { key: 'timeline' as const, label: 'Timeline', icon: Layers3 },
    { key: 'write' as const, label: 'Write', icon: PenLine },
    { key: 'desk' as const, label: 'My desk', icon: FilePenLine }
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => go('home')} aria-label="The Accountant Archives home">
          <span className="brand-mark">A</span><span>The Accountant <em>Archives</em></span>
        </button>
        <nav className={classNames('main-nav', menuOpen && 'is-open')}>
          {nav.map(({ key, label, icon: Icon }) => <button key={key} className={page === key ? 'active' : ''} onClick={() => key === 'write' ? void openWriter() : key === 'desk' ? (member ? (void loadMyStories(), go('desk')) : setSignInOpen(true)) : go(key)}><Icon size={16} />{label}</button>)}
          {member?.role === 'admin' && <button className={page === 'admin' ? 'active' : ''} onClick={() => { go('admin'); void loadModerationQueue() }}><ShieldCheck size={16} />Control room</button>}
        </nav>
        <div className="topbar-actions">
          {authLoading ? <LoaderCircle className="spin" size={18} /> : member ? <button className="member-pill" onClick={() => setProfileOpen(true)} title="Open your profile"><span className="avatar">{member.displayName.slice(0, 1)}</span><span><b>{member.handle}</b><small><Sparkles size={12} /> {formatNumber(member.ledger)}</small></span></button> : <button className="sign-in" onClick={() => setSignInOpen(true)}>Sign in <ArrowRight size={16} /></button>}
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Open navigation">{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <main>
        {page === 'home' && <Home onBrowse={() => go('archive')} onOpenFilm={openFilm} onWrite={() => void openWriter(1)} />}
        {page === 'archive' && <Archive films={allFilms} states={filmStates} search={archiveSearch} setSearch={setArchiveSearch} eraFilter={eraFilter} setEraFilter={setEraFilter} onOpenFilm={openFilm} />}
        {page === 'timeline' && <Timeline eras={eras} focus={timelineFocus} setFocus={setTimelineFocus} onOpenFilm={openFilm} />}
        {page === 'film' && <FilmPage film={currentFilm} stories={stories} loading={filmLoading} onBack={() => go('archive')} onOpenFilm={openFilm} onWrite={() => void openWriter()} onReact={reactToStory} onBookmark={bookmarkStory} />}
        {page === 'write' && <WritingStudio film={currentFilm} draft={draft} setDraft={setDraft} previewing={previewing} setPreviewing={setPreviewing} saving={draftSaving} onSave={() => void saveDraft()} onSubmit={() => void submitDraft()} onBack={() => go('film')} onFormat={insertMarkdown} />}
        {page === 'desk' && <WritingDesk stories={myStories} onOpenDraft={openDraft} onOpenFilm={openFilm} onWrite={() => void openWriter()} />}
        {page === 'submitted' && <SubmissionScreen story={lastSubmission} onDesk={() => { void loadMyStories(); go('desk') }} onFilm={() => openFilm(focusedFilm)} />}
        {page === 'admin' && <AdminRoom member={member} eras={eras} setEras={setEras} queue={adminQueue} onModerate={moderate} notify={notify} />}
      </main>

      <footer className="footer"><span>800 films about one unpaid bill.</span><span>Written by the people keeping the record.</span></footer>
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
      {signInOpen && <SignInSheet close={() => setSignInOpen(false)} login={login} />}
      {profileOpen && member && <ProfileSheet member={member} close={() => setProfileOpen(false)} logout={logout} />}
    </div>
  )
}

function Home({ onBrowse, onOpenFilm, onWrite }: { onBrowse: () => void; onOpenFilm: (number: number) => void; onWrite: () => void }) {
  return <>
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><span /> A shared fiction archive</p>
        <h1>One accountant.<br /><i>Eight hundred movies.</i></h1>
        <p className="hero-lede">Read and write stories for a movie series that starts with an unpaid bill and gets steadily less reasonable from there.</p>
        <div className="hero-actions"><button className="button primary" onClick={onBrowse}>Browse the archive <MoveRight size={17} /></button><button className="button ghost" onClick={onWrite}><FilePenLine size={17} /> Start with movie #1</button></div>
        <div className="hero-stats"><div><b>800</b><span>films in the catalogue</span></div><div><b>Open</b><span>stories can become canon</span></div><div><b>7 days</b><span>for a challenge vote</span></div></div>
      </div>
      <div className="hero-poster"><img src="./accountant-poster.png" alt="The Accountant movie poster" /><div className="poster-caption"><span>Case file</span><b>001 / 800</b><button onClick={() => onOpenFilm(1)}>Open <ChevronRight size={15} /></button></div></div>
    </section>
    <section className="home-grid section-wrap">
      <div className="section-title"><p className="eyebrow"><span /> Start anywhere</p><h2>Pick a film. <i>Leave a mark.</i></h2><p>Read what is there, offer a better version, or be the first person to write a film.</p></div>
      <div className="feature-cards">
        <button className="feature-card red" onClick={() => onOpenFilm(1)}><span className="card-no">01</span><BookOpen /><h3>Read the films</h3><p>Every film has a short official brief and room for the story people think belongs there.</p><MoveRight /></button>
        <button className="feature-card gold" onClick={onBrowse}><span className="card-no">02</span><Gavel /><h3>Put canon to a vote</h3><p>If you think a film needs a different story, submit one and let readers decide.</p><MoveRight /></button>
        <button className="feature-card blue" onClick={onWrite}><span className="card-no">03</span><PenLine /><h3>Write with context</h3><p>The writing desk shows the film before and after, so you can keep the thread going.</p><MoveRight /></button>
      </div>
    </section>
    <CommunityFeed onOpenFilm={onOpenFilm} />
    <section className="era-strip section-wrap"><div><p className="eyebrow"><span /> The chronology</p><h2>Six eras. <i>All still editable.</i></h2></div><div className="mini-timeline">{ERAS.map((era) => <button key={era.slug} style={{ '--era-colour': era.accent, flex: era.end_movie - era.start_movie + 1 } as React.CSSProperties} onClick={() => onOpenFilm(era.start_movie)}><b>{era.name}</b><small>#{era.start_movie}–{era.end_movie}</small></button>)}</div></section>
  </>
}

function CommunityFeed({ onOpenFilm }: { onOpenFilm: (number: number) => void }) {
  const [latest, setLatest] = useState<Array<{ id:string; title:string; film_number:number; status:string; created_at:string }>>([])
  useEffect(() => { if (!supabase) return; void supabase.from('stories').select('id,title,film_number,status,created_at').in('status', ['canon', 'challenger']).order('created_at', { ascending: false }).limit(8).then(({ data }) => setLatest(data ?? [])) }, [])
  const battles = latest.filter((story) => story.status === 'challenger'); const fresh = latest.filter((story) => story.status === 'canon').slice(0, 4)
  return <section className="community-feed section-wrap"><div><p className="eyebrow"><span /> The live archive</p><h2>What the group is <i>moving forward.</i></h2></div><div className="feed-columns"><div><header><Gavel size={17} /><b>Canon battles</b></header>{battles.length ? battles.map((story) => <button key={story.id} onClick={() => onOpenFilm(story.film_number)}><small>Movie #{story.film_number} · Vote open</small><b>{story.title}</b><ArrowRight size={15} /></button>) : <p>No active challenges yet. The next alternative story starts one automatically.</p>}</div><div><header><Sparkles size={17} /><b>Newest canon</b></header>{fresh.length ? fresh.map((story) => <button key={story.id} onClick={() => onOpenFilm(story.film_number)}><small>Movie #{story.film_number}</small><b>{story.title}</b><ArrowRight size={15} /></button>) : <p>The first published story will show up here.</p>}</div></div></section>
}

function Archive({ films, states, search, setSearch, eraFilter, setEraFilter, onOpenFilm }: { films: Film[]; states: Record<number, 'open' | 'canon' | 'challenger'>; search: string; setSearch: (value: string) => void; eraFilter: string; setEraFilter: (value: string) => void; onOpenFilm: (number: number) => void }) {
  const visible = films.filter((film) => {
    const query = search.toLowerCase().trim()
    return (!query || `${film.number} ${film.title} ${film.official_description}`.toLowerCase().includes(query)) && (eraFilter === 'all' || film.era.slug === eraFilter)
  })
  return <section className="archive section-wrap">
    <div className="archive-heading"><div><p className="eyebrow"><span /> The full paper trail</p><h1>All <i>800 films.</i></h1><p>Search by title or number, or jump straight to an era.</p></div><div className="archive-amount">{formatNumber(visible.length)} <span>films found</span></div></div>
    <div className="archive-tools"><label className="search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title or film number" /><kbd>⌘ K</kbd></label><div className="era-filters"><button className={eraFilter === 'all' ? 'selected' : ''} onClick={() => setEraFilter('all')}>All</button>{ERAS.map((era) => <button key={era.slug} className={eraFilter === era.slug ? 'selected' : ''} onClick={() => setEraFilter(era.slug)}>{era.name}</button>)}</div></div>
    <div className="archive-key"><span className="open">Open</span><span className="canon">Canon</span><span className="challenger">Challenge open</span></div><div className="film-grid">{visible.map((film) => { const state = states[film.number] ?? 'open'; return <button className={classNames('film-card', `film-${state}`)} key={film.number} onClick={() => onOpenFilm(film.number)} style={{ '--era-colour': film.era.accent } as React.CSSProperties}><span className="film-number">#{String(film.number).padStart(3, '0')}</span><span className="film-state">{state === 'canon' ? 'Canon' : state === 'challenger' ? 'Challenge' : 'Open'}</span><h3>{film.title}</h3><p>{film.official_description}</p><footer><span>{film.era.name}</span><ChevronRight size={16} /></footer></button> })}</div>
  </section>
}

function Timeline({ eras, focus, setFocus, onOpenFilm }: { eras: Era[]; focus: string | null; setFocus: (value: string | null) => void; onOpenFilm: (number: number) => void }) {
  const active = eras.find((era) => era.slug === focus)
  const scrollArea = useRef<HTMLDivElement>(null)
  const drag = useRef({ startX: 0, scrollLeft: 0, moved: false })
  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    const element = scrollArea.current
    if (!element) return
    drag.current = { startX: event.clientX, scrollLeft: element.scrollLeft, moved: false }
    element.setPointerCapture(event.pointerId)
    element.classList.add('dragging')
  }
  function dragTimeline(event: React.PointerEvent<HTMLDivElement>) {
    const element = scrollArea.current
    if (!element || !element.hasPointerCapture(event.pointerId)) return
    const distance = event.clientX - drag.current.startX
    if (Math.abs(distance) > 4) drag.current.moved = true
    element.scrollLeft = drag.current.scrollLeft - distance
  }
  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const element = scrollArea.current
    if (!element) return
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    element.classList.remove('dragging')
    window.setTimeout(() => { drag.current.moved = false }, 0)
  }
  return <section className="timeline-page section-wrap">
    <div className="timeline-heading"><div><p className="eyebrow"><span /> Continuity map</p><h1>How the <i>series fits together.</i></h1><p>Each era has its own brief. The administrator can adjust the map as the community develops the story.</p></div><div className="timeline-key"><span><i className="dot canon" />Canon</span><span><i className="dot challenger" />Open challenge</span><span><i className="dot unclaimed" />Awaiting story</span></div></div>
    <div className="timeline-graph-note"><span>Drag to explore the full 800-film record.</span><div><button onClick={() => scrollArea.current?.scrollTo({ left: 0, behavior: 'smooth' })}>Start</button><button onClick={() => scrollArea.current?.scrollTo({ left: scrollArea.current.scrollWidth, behavior: 'smooth' })}>End</button></div></div>
    <div ref={scrollArea} className="ledger-scroll" onPointerDown={beginDrag} onPointerMove={dragTimeline} onPointerUp={endDrag} onPointerCancel={endDrag}><div className="ledger-graph" aria-label="800 movie timeline"><div className="graph-axis"><span>#001</span><span>#100</span><span>#200</span><span>#300</span><span>#400</span><span>#500</span><span>#600</span><span>#700</span><span>#800</span></div><div className="era-lanes">{eras.map((era, index) => <button key={era.slug} className={classNames('era-lane', focus === era.slug && 'focused')} style={{ '--era-colour': era.accent, '--start': era.start_movie, '--length': era.end_movie - era.start_movie + 1, '--lane': index } as React.CSSProperties} onClick={() => { if (!drag.current.moved) setFocus(focus === era.slug ? null : era.slug) }}><span className="era-lane-label"><b>{era.name}</b><small>#{era.start_movie}–#{era.end_movie}</small></span></button>)}</div><div className="graph-marks">{[1, 30, 40, 41, 220, 300, 800].map((number) => <button key={number} style={{ left: `${((number - 1) / 799) * 100}%` }} onClick={() => { if (!drag.current.moved) onOpenFilm(number) }}><i /><span>#{number}</span></button>)}</div></div></div>
    <div className="timeline-detail">{active ? <><span className="era-swatch" style={{ background: active.accent }} /><div><p className="eyebrow">#{active.start_movie}–#{active.end_movie}</p><h2>{active.name}</h2><p>{active.description}</p></div><aside><b>Writer’s brief</b><p>{active.writing_guidelines}</p><button className="text-button" onClick={() => onOpenFilm(active.start_movie)}>Open first film <ArrowRight size={15} /></button></aside></> : <><Grid3X3 size={28} /><div><h2>Select an era to read its writing notes.</h2><p>The map can change when the story needs it to.</p></div></>}</div>
    <div className="timeline-callout"><div><Sparkles /><h2>Grothkin starts at <i>movie #220.</i></h2><p>From there, the countdown is tied to old records, old promises, and an accounts department that should have stayed ordinary.</p></div><button className="button ghost" onClick={() => onOpenFilm(220)}>Open Grothkin Lore <ArrowRight size={16} /></button></div>
  </section>
}

function LegacyFilmPage({ film, stories, loading, onBack, onOpenFilm, onWrite, onReact, onBookmark }: { film: Film; stories: Story[]; loading: boolean; onBack: () => void; onOpenFilm: (number: number) => void; onWrite: () => void; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  const canon = stories.find((story) => story.status === 'canon')
  const challengers = stories.filter((story) => story.status === 'challenger')
  return <section className="film-page section-wrap">
    <div className="film-page-nav"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Archive</button><div className="film-switcher" aria-label="Browse adjacent films">{film.number > 1 ? <button onClick={() => onOpenFilm(film.number - 1)}><ArrowLeft size={17} /><span><small>Previous film</small><b>#{String(film.number - 1).padStart(3, '0')} · {titleForFilm(film.number - 1)}</b></span></button> : <span className="film-switcher-edge">Beginning of the record</span>}<span className="film-switcher-count">{film.number} / 800</span>{film.number < 800 ? <button onClick={() => onOpenFilm(film.number + 1)}><span><small>Next film</small><b>#{String(film.number + 1).padStart(3, '0')} · {titleForFilm(film.number + 1)}</b></span><ArrowRight size={17} /></button> : <span className="film-switcher-edge">Paid in full</span>}</div></div>
    <div className="film-hero" style={{ '--era-colour': film.era.accent } as React.CSSProperties}><div className="film-label"><span>Movie</span><b>#{String(film.number).padStart(3, '0')}</b></div><div className="film-hero-copy"><p className="eyebrow"><span /> {film.era.name}</p><h1>{film.title}</h1><p>{film.official_description}</p><div className="film-tags"><span>{film.era.start_movie}–{film.era.end_movie} era</span><span>~2h runtime</span><span>Open archive</span></div></div><button className="button primary" onClick={onWrite}><PenLine size={17} />{canon ? 'Challenge canon' : 'Write the first story'}</button></div>
    <div className="film-layout"><aside className="continuity-card"><p className="eyebrow">Continuity</p>{film.number > 1 ? <button onClick={() => onOpenFilm(film.number - 1)}><small>Before</small><b>#{film.number - 1}</b><span>{titleForFilm(film.number - 1)}</span></button> : <div><small>Before</small><b>#—</b><span>No earlier film.</span></div>}<div className="current"><small>Now</small><b>#{film.number}</b><span>{film.title}</span></div>{film.number < 800 ? <button onClick={() => onOpenFilm(film.number + 1)}><small>After</small><b>#{film.number + 1}</b><span>{titleForFilm(film.number + 1)}</span></button> : <div><small>After</small><b>#—</b><span>The series ends here.</span></div>}<hr /><p>{film.era.writing_guidelines}</p></aside>
      <div className="story-column">{loading ? <div className="loading-card"><LoaderCircle className="spin" />Loading film…</div> : canon ? <><StoryCard story={canon} featured onReact={onReact} onBookmark={onBookmark} /><EditProposalBox story={canon} /></> : <EmptyCanon film={film} onWrite={onWrite} />}{challengers.length > 0 && <section className="challenge-stack"><div className="stack-heading"><div><p className="eyebrow"><span /> Current vote</p><h2>Canon is being challenged.</h2></div><span className="vote-window">6d 18h remaining</span></div>{challengers.map((story) => <StoryCard key={story.id} story={story} challenge onReact={onReact} onBookmark={onBookmark} />)}</section>}<section className="archive-note"><LockKeyhole size={17} /><div><b>Nothing is deleted.</b><p>Stories that do not become canon remain available with their revision history.</p></div></section></div>
    </div>
  </section>
}

function FilmPage({ film, stories, loading, onBack, onOpenFilm, onWrite, onReact, onBookmark }: { film: Film; stories: Story[]; loading: boolean; onBack: () => void; onOpenFilm: (number: number) => void; onWrite: () => void; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  const canon = stories.find((story) => story.status === 'canon'); const challengers = stories.filter((story) => story.status === 'challenger'); const displayTitle = canon?.title ?? film.title
  return <section className="film-page section-wrap"><div className="film-page-nav"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Archive</button><div className="film-switcher"><button disabled={film.number === 1} onClick={() => onOpenFilm(film.number - 1)}><ArrowLeft size={16} /> Previous</button><span>{film.number} / 800</span><button disabled={film.number === 800} onClick={() => onOpenFilm(film.number + 1)}>Next <ArrowRight size={16} /></button></div></div><div className="film-hero" style={{ '--era-colour': film.era.accent } as React.CSSProperties}><div className="film-label"><span>Movie</span><b>#{String(film.number).padStart(3, '0')}</b></div><div className="film-hero-copy"><p className="eyebrow"><span /> {film.era.name}</p>{canon && <small className="official-film-title">Official prompt: {film.title}</small>}<h1>{displayTitle}</h1><p>{film.official_description}</p></div><button className="button primary" onClick={onWrite}><PenLine size={17} />{canon ? 'Challenge canon' : 'Write the first story'}</button></div><div className="film-layout"><aside className="continuity-card"><p className="eyebrow">Continuity</p><button disabled={film.number === 1} onClick={() => onOpenFilm(film.number - 1)}><small>Before</small><b>#{film.number - 1}</b><span>{film.number > 1 ? titleForFilm(film.number - 1) : 'Beginning of the record'}</span></button><div className="current"><small>Now</small><b>#{film.number}</b><span>{displayTitle}</span></div><button disabled={film.number === 800} onClick={() => onOpenFilm(film.number + 1)}><small>After</small><b>#{film.number + 1}</b><span>{film.number < 800 ? titleForFilm(film.number + 1) : 'Paid in full'}</span></button><hr /><p>{film.era.writing_guidelines}</p></aside><div className="story-column">{loading ? <div className="loading-card"><LoaderCircle className="spin" />Loading film…</div> : canon ? <><StoryCard story={canon} featured onReact={onReact} onBookmark={onBookmark} /><EditProposalBox story={canon} /></> : <EmptyCanon film={film} onWrite={onWrite} />}{challengers.length > 0 && <section className="challenge-stack"><div className="stack-heading"><div><p className="eyebrow"><span /> Current vote</p><h2>Canon is being challenged.</h2></div></div>{challengers.map((story) => <StoryCard key={story.id} story={story} challenge onReact={onReact} onBookmark={onBookmark} />)}</section>}</div></div></section>
}

function EmptyCanon({ film, onWrite }: { film: Film; onWrite: () => void }) { return <div className="empty-canon"><div className="empty-stamp">OPEN FILE</div><p className="eyebrow"><span /> No canon yet</p><h2>This film needs its <i>first story.</i></h2><p>Read the brief, check the films on either side, and write the version you think should be here.</p><button className="button primary" onClick={onWrite}>Write movie #{film.number} <ArrowRight size={16} /></button></div> }

function EditProposalBox({ story }: { story: Story }) {
  const [open, setOpen] = useState(false); const [body, setBody] = useState(story.body); const [reason, setReason] = useState(''); const [message, setMessage] = useState(''); const [proposals, setProposals] = useState<Array<{id:string;rationale:string;created_at:string}>>([])
  async function refresh() { if (!supabase) return; const { data } = await supabase.from('story_edit_proposals').select('id,rationale,created_at').eq('story_id', story.id).eq('status', 'open').order('created_at', { ascending: false }); setProposals(data ?? []) }
  useEffect(() => { void refresh() }, [story.id])
  async function propose() { if (!supabase) { setMessage('Sign in to suggest an edit.'); return }; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setMessage('Sign in to suggest an edit.'); return }; const { error } = await supabase.from('story_edit_proposals').insert({ story_id: story.id, author_id: auth.user.id, replacement_body_markdown: body, rationale: reason }); setMessage(error ? error.message : 'Edit proposal opened for voting.'); if (!error) { setOpen(false); void refresh() } }
  async function vote(proposalId: string, value: 1 | -1) { if (!supabase) { setMessage('Sign in to vote.'); return }; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setMessage('Sign in to vote.'); return }; const { error } = await supabase.from('story_edit_votes').upsert({ proposal_id: proposalId, user_id: auth.user.id, value }, { onConflict: 'proposal_id,user_id' }); setMessage(error ? error.message : 'Edit vote recorded.'); }
  return <section className="edit-proposal"><div><p className="eyebrow"><span /> Improve the record</p><h2>Suggest a targeted edit.</h2><p>Propose a paragraph-level rewrite without replacing the whole story. The group can vote it through.</p></div><button className="button ghost slim" onClick={() => setOpen((value) => !value)}>{open ? 'Close' : 'Suggest an edit'}</button>{open && <div className="proposal-form"><textarea value={body} onChange={(event) => setBody(event.target.value)} aria-label="Proposed story text" /><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why does this improve the story?" aria-label="Edit rationale" /><button className="button primary slim" onClick={() => void propose()}>Open edit vote <ArrowRight size={15} /></button></div>}{proposals.map((proposal) => <div className="proposal-vote" key={proposal.id}><span><b>Open edit vote</b><small>{proposal.rationale || 'A writer proposed a focused revision.'}</small></span><div><button onClick={() => void vote(proposal.id, 1)}><ArrowUp size={14} /> Support</button><button onClick={() => void vote(proposal.id, -1)}><ArrowDown size={14} /> Keep current</button></div></div>)}{message && <small>{message}</small>}</section>
}

function LegacyStoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : story.status === 'challenger' ? <><Gavel size={13} /> Challenger</> : story.status}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span><span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span></div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button><button><MessageCircle size={16} /> {formatNumber(story.metrics.comments)}</button></div><button className="icon-button" onClick={() => onBookmark(story)} aria-label="Save story"><Bookmark size={17} /></button></footer></article>
}

function StoryDiscussion({ storyId }: { storyId: string }) {
  const [open, setOpen] = useState(false); const [body, setBody] = useState(''); const [comments, setComments] = useState<Array<{ id: string; body: string; created_at: string; author?: { handle: string; display_name: string; ledger_balance: number } }>>([]); const [message, setMessage] = useState(''); const [battle, setBattle] = useState<{ id: string; canon_story_id: string; challenger_story_id: string; closes_at: string; canon_votes: number; challenger_votes: number; mine?: string } | null>(null)
  async function refresh() { if (!supabase) return; const { data, error } = await supabase.from('comments').select('id,body,created_at,author_id').eq('story_id', storyId).eq('is_removed', false).order('created_at'); if (error) { setMessage(error.message); return }; const ids = (data ?? []).map((comment) => comment.author_id); const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,handle,display_name,ledger_balance').in('id', ids) : { data: [] as Array<{ id: string; handle: string; display_name: string; ledger_balance: number }> }; const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile])); setComments((data ?? []).map((comment) => ({ ...comment, author: byId.get(comment.author_id) }))) }
  useEffect(() => { if (open) void refresh() }, [open, storyId])
  useEffect(() => { const client = supabase; if (!client) return; void (async () => { const { data } = await client.from('canon_challenges').select('id,canon_story_id,challenger_story_id,closes_at').eq('status', 'open').eq('challenger_story_id', storyId).maybeSingle(); if (!data) return; const { data: metrics } = await client.from('challenge_metrics').select('canon_votes,challenger_votes').eq('challenge_id', data.id).maybeSingle(); const { data: auth } = await client.auth.getUser(); const { data: vote } = auth.user ? await client.from('challenge_votes').select('story_id').eq('challenge_id', data.id).eq('user_id', auth.user.id).maybeSingle() : { data: null }; setBattle({ ...data, canon_votes: metrics?.canon_votes ?? 0, challenger_votes: metrics?.challenger_votes ?? 0, mine: vote?.story_id }) })() }, [storyId])
  async function castVote(storyIdToVote: string) { if (!supabase || !battle) return; const { error } = await supabase.rpc('cast_challenge_vote', { p_challenge_id: battle.id, p_story_id: storyIdToVote }); if (error) setMessage(error.message); else { setBattle((old) => old ? { ...old, mine: storyIdToVote, canon_votes: old.canon_votes + (storyIdToVote === old.canon_story_id && old.mine !== storyIdToVote ? 1 : 0), challenger_votes: old.challenger_votes + (storyIdToVote === old.challenger_story_id && old.mine !== storyIdToVote ? 1 : 0) } : old); setMessage('Canon vote recorded.') } }
  async function post() { if (!supabase) { setMessage('Sign in to leave a comment.'); return }; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setMessage('Sign in to leave a comment.'); return }; const { error } = await supabase.from('comments').insert({ story_id: storyId, author_id: auth.user.id, body }); if (error) setMessage(error.message); else { setBody(''); setMessage('Comment added.'); void refresh() } }
  return <section className="story-discussion">{battle && <div className="canon-ballot"><p className="eyebrow"><span /> Canon battle</p><h3>Which version stays?</h3><p>Choose the version that should lead into the next film. You can change your vote until the window closes.</p><div><button className={battle.mine === battle.canon_story_id ? 'selected' : ''} onClick={() => void castVote(battle.canon_story_id)}>Keep current canon <b>{battle.canon_votes}</b></button><button className={battle.mine === battle.challenger_story_id ? 'selected' : ''} onClick={() => void castVote(battle.challenger_story_id)}>Back this challenge <b>{battle.challenger_votes}</b></button></div></div>}<button className="text-button" onClick={() => setOpen((value) => !value)}><MessageCircle size={15} /> {open ? 'Hide discussion' : 'Open discussion'}</button>{open && <div className="comment-area">{comments.map((comment) => { const author = comment.author; return <article key={comment.id}><b>{author?.display_name ?? 'Archive member'}</b><small>@{author?.handle ?? 'member'}{author?.ledger_balance ? ` · ${formatNumber(author.ledger_balance)} ledger` : ''} · {relativeDate(comment.created_at)}</small><p>{comment.body}</p></article> })}<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add something useful to the record…" maxLength={3000} /><button className="button primary slim" disabled={body.trim().length < 2} onClick={() => void post()}>Post comment</button>{message && <small>{message}</small>}</div>}</section>
}

function RecentStoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span><span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span></div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button title="Support this story" onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button title="Vote against this story" onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div><button className="icon-button" onClick={() => onBookmark(story)} aria-label="Save story"><Bookmark size={17} /></button></footer><StoryDiscussion storyId={story.id} /></article>
}

function PriorStoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  const ledger = story.author.ledger > 0 ? <span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span> : null
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span>{ledger}</div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button className={story.viewerReaction === 1 ? 'selected' : ''} title={story.viewerReaction === 1 ? 'Remove your support' : 'Support this story'} onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button className={story.viewerReaction === -1 ? 'selected' : ''} title={story.viewerReaction === -1 ? 'Remove your vote' : 'Vote against this story'} onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div><button className="icon-button" onClick={() => onBookmark(story)} aria-label="Save story"><Bookmark size={17} /></button></footer><StoryDiscussion storyId={story.id} /></article>
}

function StoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span>{story.author.ledger > 0 && <span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span>}</div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button className={story.viewerReaction === 1 ? 'selected' : ''} onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button className={story.viewerReaction === -1 ? 'selected' : ''} onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div><button className={classNames('icon-button', story.viewerBookmarked && 'selected')} aria-pressed={story.viewerBookmarked} onClick={() => onBookmark(story)} aria-label={story.viewerBookmarked ? 'Remove saved story' : 'Save story'}><Bookmark size={17} /></button></footer><StoryDiscussion storyId={story.id} /></article>
}

function LegacyWritingStudio({ film, draft, setDraft, previewing, setPreviewing, saving, onSave, onSubmit, onBack, onFormat }: { film: Film; draft: { title: string; body: string; continuityNote: string }; setDraft: React.Dispatch<React.SetStateAction<{ title: string; body: string; continuityNote: string }>>; previewing: boolean; setPreviewing: (value: boolean) => void; saving: boolean; onSave: () => void; onSubmit: () => void; onBack: () => void; onFormat: (before: string, after?: string) => void }) {
  const wordCount = words(draft.body)
  const complete = Math.min(100, Math.round((wordCount / 300) * 100))
  return <section className="studio"><header className="studio-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Movie #{film.number}</button><div className="studio-state">{saving ? <><LoaderCircle className="spin" size={15} /> Saving</> : <><span /> Autosave on</>}</div><div><button className="button slim ghost" onClick={onSave}>Save draft</button><button className="button slim primary" onClick={onSubmit} disabled={wordCount < 300}>Publish story <Send size={15} /></button></div></header><div className="studio-layout"><aside className="studio-context"><p className="eyebrow">Your brief</p><div className="current-film"><span style={{ background: film.era.accent }} /> <small>Movie #{String(film.number).padStart(3, '0')}</small><h2>{film.title}</h2><p>{film.official_description}</p></div><div className="brief-box"><p className="eyebrow">{film.era.name} brief</p><p>{film.era.writing_guidelines}</p></div></aside><div className="editor-area"><div className="editor-top"><div><p className="eyebrow">Start a story</p><input value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="A title for this film" aria-label="Story title" /></div><div className="editor-mode"><button className={!previewing ? 'selected' : ''} onClick={() => setPreviewing(false)}>Write</button><button className={previewing ? 'selected' : ''} onClick={() => setPreviewing(true)}>Preview</button></div></div>{!previewing && <div className="format-bar"><button onClick={() => onFormat('## ')}>H2</button><button onClick={() => onFormat('**', '**')}><b>B</b></button><button onClick={() => onFormat('*', '*')}><i>I</i></button><button onClick={() => onFormat('> ')}>Quote</button><button onClick={() => onFormat('- ')}>List</button><span>Markdown supported</span></div>}{previewing ? <article className="preview-prose"><h1>{draft.title || 'Untitled story'}</h1>{draft.body.split(/\n{2,}/).map((paragraph, index) => paragraph.startsWith('## ') ? <h2 key={index}>{paragraph.slice(3)}</h2> : <p key={index}>{paragraph.replaceAll('**', '').replaceAll('*', '')}</p>)}</article> : <textarea id="story-body" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Start with the accountant, the debt, or the problem this film introduces." spellCheck /> }<label className="continuity-note"><span>Hand-off for the next writer <small>Optional · one sentence</small></span><input value={draft.continuityNote} maxLength={360} onChange={(event) => setDraft((old) => ({ ...old, continuityNote: event.target.value }))} placeholder="What should the next film pick up?" /></label><footer className="editor-footer"><div><b>{formatNumber(wordCount)}</b> words · {readingTime(wordCount)} min read<div className="word-meter"><i style={{ width: `${complete}%` }} /></div><small>{wordCount < 300 ? `${300 - wordCount} words until publication` : 'Ready to publish'}</small></div><p>First stories become canon automatically; later stories open a canon challenge.</p></footer></div></div></section>
}

function WritingStudio({ film, draft, setDraft, previewing, setPreviewing, saving, onSave, onSubmit, onBack, onFormat }: { film: Film; draft: { title: string; body: string; continuityNote: string }; setDraft: React.Dispatch<React.SetStateAction<{ title: string; body: string; continuityNote: string }>>; previewing: boolean; setPreviewing: (value: boolean) => void; saving: boolean; onSave: () => void; onSubmit: () => void; onBack: () => void; onFormat: (before: string, after?: string) => void }) {
  const [previous, setPrevious] = useState<{ number: number; title: string; note: string } | null>(null)
  const count = words(draft.body)
  useEffect(() => { const client = supabase; if (!client || film.number === 1) { setPrevious(null); return }; void client.from('stories').select('film_number,title,continuity_note').eq('film_number', film.number - 1).eq('status', 'canon').maybeSingle().then(({ data }) => setPrevious(data ? { number: data.film_number, title: data.title, note: data.continuity_note ?? '' } : null)) }, [film.number])
  function toggleFullScreen() { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen() }
  return <section className="studio"><header className="studio-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Movie #{film.number}</button><div className="studio-state">{saving ? <><LoaderCircle className="spin" size={15} /> Saving</> : <><span /> Autosave on</>}</div><div><button className="button slim ghost" onClick={toggleFullScreen}>Full screen</button><button className="button slim ghost" onClick={onSave}>Save draft</button><button className="button slim primary" onClick={onSubmit} disabled={count < 300 || !draft.continuityNote.trim()}>Publish story <Send size={15} /></button></div></header><div className="studio-layout"><aside className="studio-context"><p className="eyebrow">Writing brief</p><div className="current-film"><span style={{ background: film.era.accent }} /><small>Movie #{String(film.number).padStart(3, '0')}</small><h2>{film.title}</h2><p>{film.official_description}</p></div>{previous?.note && <div className="writer-handoff"><p className="eyebrow">From movie #{String(previous.number).padStart(3, '0')}</p><b>{previous.title}</b><p>{previous.note}</p></div>}<div className="brief-box"><p className="eyebrow">{film.era.name} brief</p><p>{film.era.writing_guidelines}</p></div></aside><div className="editor-area"><div className="editor-top"><div><p className="eyebrow">Start a story</p><input value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="A title for this film" aria-label="Story title" /></div><div className="editor-mode"><button className={!previewing ? 'selected' : ''} onClick={() => setPreviewing(false)}>Write</button><button className={previewing ? 'selected' : ''} onClick={() => setPreviewing(true)}>Preview</button></div></div>{!previewing && <div className="format-bar"><button onClick={() => onFormat('## ')}>H2</button><button onClick={() => onFormat('**', '**')}><b>B</b></button><button onClick={() => onFormat('*', '*')}><i>I</i></button><button onClick={() => onFormat('> ')}>Quote</button><button onClick={() => onFormat('- ')}>List</button></div>}{previewing ? <article className="preview-prose"><h1>{draft.title || 'Untitled story'}</h1>{draft.body.split(/\n{2,}/).map((paragraph, index) => paragraph.startsWith('## ') ? <h2 key={index}>{paragraph.slice(3)}</h2> : <p key={index}>{paragraph.replaceAll('**', '').replaceAll('*', '')}</p>)}</article> : <textarea id="story-body" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Start with the accountant, the debt, or the problem this film introduces." spellCheck /> }<label className="continuity-note"><span>Hand-off for the next writer <small>Required · one sentence</small></span><input value={draft.continuityNote} maxLength={360} onChange={(event) => setDraft((old) => ({ ...old, continuityNote: event.target.value }))} placeholder="What should the next film pick up?" /></label><footer className="editor-footer"><div><b>{formatNumber(count)}</b> words · {readingTime(count)} min read<div className="word-meter"><i style={{ width: `${Math.min(100, Math.round((count / 300) * 100))}%` }} /></div><small>{count < 300 ? `${300 - count} words until publication` : !draft.continuityNote.trim() ? 'Add the hand-off note to publish' : 'Ready to publish'}</small></div><p>First stories become canon automatically; later stories open a canon challenge.</p></footer></div></div></section>
}

function WritingDesk({ stories, onOpenDraft, onOpenFilm, onWrite }: { stories: Story[]; onOpenDraft: (story: Story) => void; onOpenFilm: (number: number) => void; onWrite: () => void }) { return <section className="archive section-wrap"><div className="archive-heading"><div><p className="eyebrow"><span /> Your workspace</p><h1>Writing <i>desk.</i></h1><p>Drafts stay here until you publish. Published stories and active challenges are kept together so nothing disappears.</p></div><button className="button primary" onClick={onWrite}><PenLine size={16} /> New story</button></div><div className="desk-list">{stories.length ? stories.map((story) => <article key={story.id} className="desk-card"><span className={classNames('status-badge', story.status)}>{story.status === 'draft' ? 'Draft' : story.status === 'canon' ? 'Canon' : story.status === 'challenger' ? 'Challenge open' : story.status}</span><div><p className="eyebrow">Movie #{story.filmNumber}</p><h2>{story.title}</h2><p>{story.status === 'draft' ? `${formatNumber(story.wordCount)} words · last saved automatically` : `Published · ${formatNumber(story.wordCount)} words`}</p></div><div>{story.status === 'draft' ? <button className="button ghost slim" onClick={() => onOpenDraft(story)}>Continue editing</button> : <button className="button ghost slim" onClick={() => onOpenFilm(story.filmNumber)}>Open film</button>}</div></article>) : <div className="empty-canon"><p className="eyebrow"><span /> Nothing saved yet</p><h2>Your drafts will <i>always live here.</i></h2><button className="button primary" onClick={onWrite}>Write your first one <ArrowRight size={16} /></button></div>}</div></section> }

function SubmissionScreen({ story, onDesk, onFilm }: { story: Story | null; onDesk: () => void; onFilm: () => void }) { const isChallenge = story?.status === 'challenger'; return <section className="submitted-screen section-wrap"><span className="brand-mark">A</span><p className="eyebrow"><span /> Publication recorded</p><h1>{isChallenge ? <>Your challenge is <i>live.</i></> : <>Your story is now <i>canon.</i></>}</h1><p>{isChallenge ? 'Readers can now choose between your version and the current canon.' : 'There was no existing canon, so the archive has published your story immediately. You can still see every revision in your writing desk.'}</p><div><button className="button primary" onClick={onFilm}>Open the film <ArrowRight size={16} /></button><button className="button ghost" onClick={onDesk}>Go to my desk</button></div></section> }

function LegacyAdminRoom({ member, eras, setEras, queue, onModerate, notify }: { member: Member | null; eras: Era[]; setEras: React.Dispatch<React.SetStateAction<Era[]>>; queue: Story[]; onModerate: (story: Story, action: 'approve_canon' | 'archive' | 'reject') => void; notify: (message: string) => void }) {
  const [selected, setSelected] = useState(eras[0]?.slug ?? '')
  const active = eras.find((era) => era.slug === selected) ?? eras[0]
  const [editing, setEditing] = useState(active)
  useEffect(() => setEditing(active), [selected, active])
  if (!member || member.role !== 'admin') return <section className="restricted section-wrap"><ShieldCheck size={34} /><h1>Admin access required.</h1><p>Only an administrator can edit eras and moderation settings.</p></section>
  async function saveEra() {
    if (!editing) return
    if (!supabase || !editing.id) { setEras((all) => all.map((era) => era.slug === editing.slug ? editing : era)); notify('Preview updated. Connect Supabase to persist it.'); return }
    const { error } = await supabase.from('eras').update({ name: editing.name, description: editing.description, writing_guidelines: editing.writing_guidelines, accent: editing.accent, start_movie: editing.start_movie, end_movie: editing.end_movie }).eq('id', editing.id)
    if (error) notify(error.message); else { setEras((all) => all.map((era) => era.id === editing.id ? editing : era)); notify('Era saved. Film assignments updated.') }
  }
  return <section className="admin-room section-wrap"><div className="admin-heading"><div><p className="eyebrow"><span /> Administrator</p><h1>Control room.</h1><p>Authority is intentional here: canon is community-made, but the archive still needs a careful keeper.</p></div><span className="admin-seal"><ShieldCheck /> Verified administrator</span></div><div className="admin-tabs"><button className="selected">Era map</button><button>Reports</button><button>Members</button><button>Settings</button></div><div className="admin-grid"><aside className="era-list">{eras.map((era) => <button key={era.slug} className={selected === era.slug ? 'selected' : ''} onClick={() => setSelected(era.slug)}><i style={{ background: era.accent }} /><span><b>{era.name}</b><small>#{era.start_movie}–#{era.end_movie}</small></span><ChevronRight size={15} /></button>)}</aside>{editing && <div className="era-editor"><div className="editor-heading"><div><p className="eyebrow">Edit era</p><h2>{editing.name}</h2></div><button className="button primary slim" onClick={() => void saveEra()}>Save changes</button></div><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Description<textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label>Writer’s brief<textarea value={editing.writing_guidelines} onChange={(event) => setEditing({ ...editing, writing_guidelines: event.target.value })} /></label><div className="admin-fields"><label>Starts at<input type="number" min="1" max="800" value={editing.start_movie} onChange={(event) => setEditing({ ...editing, start_movie: Number(event.target.value) })} /></label><label>Ends at<input type="number" min="1" max="800" value={editing.end_movie} onChange={(event) => setEditing({ ...editing, end_movie: Number(event.target.value) })} /></label><label>Accent<input type="color" value={editing.accent} onChange={(event) => setEditing({ ...editing, accent: event.target.value })} /></label></div><p className="admin-note"><Settings2 size={15} /> Range changes update the assigned films automatically. Overlapping eras are rejected by the database.</p></div>}</div><section className="moderation-panel"><div className="stack-heading"><div><p className="eyebrow"><span /> Review queue</p><h2>{queue.length ? `${queue.length} story${queue.length === 1 ? '' : 'ies'} awaiting a decision` : 'No stories awaiting a decision'}</h2></div><button className="text-button"><Flag size={15} /> Open reports</button></div>{queue.length ? queue.map((story) => <article className="queue-item" key={story.id}><span className="avatar">{story.author.displayName.slice(0, 1)}</span><div><b>{story.title}</b><p>Movie #{story.filmNumber} · @{story.author.handle} · {formatNumber(story.wordCount)} words</p></div><div className="queue-actions"><button onClick={() => onModerate(story, 'reject')}>Reject</button><button onClick={() => onModerate(story, 'archive')}>Archive</button><button className="approve" onClick={() => onModerate(story, 'approve_canon')}>Make canon</button></div></article>) : <p className="quiet-copy">New submissions will arrive here after writers pass the quality threshold.</p>}</section></section>
}

function AdminRoom({ member, eras, setEras, queue, onModerate, notify }: { member: Member | null; eras: Era[]; setEras: React.Dispatch<React.SetStateAction<Era[]>>; queue: Story[]; onModerate: (story: Story, action: 'approve_canon' | 'archive' | 'reject') => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'eras' | 'reports' | 'members' | 'settings'>('eras')
  const [selected, setSelected] = useState(eras[0]?.slug ?? '')
  const [editing, setEditing] = useState(eras[0])
  if (!member || member.role !== 'admin') return <section className="restricted section-wrap"><ShieldCheck size={34} /><h1>Admin access required.</h1></section>
  const tabs: Array<[typeof tab, string]> = [['eras', 'Era map'], ['reports', 'Reports'], ['members', 'Members'], ['settings', 'Settings']]
  async function saveEra() { if (!editing) return; if (!supabase || !editing.id) { setEras((all) => all.map((era) => era.slug === editing.slug ? editing : era)); notify('Era saved locally.'); return }; const { error } = await supabase.from('eras').update({ name: editing.name, description: editing.description, writing_guidelines: editing.writing_guidelines, accent: editing.accent, start_movie: editing.start_movie, end_movie: editing.end_movie }).eq('id', editing.id); if (error) notify(error.message); else { setEras((all) => all.map((era) => era.id === editing.id ? editing : era)); notify('Era saved.') } }
  return <section className="admin-room section-wrap"><div className="admin-heading"><div><p className="eyebrow"><span /> Administrator</p><h1>Control room.</h1><p>Automatic canon keeps the archive moving. This is where you set its guardrails.</p></div><span className="admin-seal"><ShieldCheck /> Verified administrator</span></div><div className="admin-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === 'eras' && <div className="admin-grid"><aside className="era-list">{eras.map((era) => <button key={era.slug} className={selected === era.slug ? 'selected' : ''} onClick={() => { setSelected(era.slug); setEditing(era) }}><i style={{ background: era.accent }} /><span><b>{era.name}</b><small>#{era.start_movie}–#{era.end_movie}</small></span><ChevronRight size={15} /></button>)}</aside>{editing && <div className="era-editor"><div className="editor-heading"><div><p className="eyebrow">Edit era</p><h2>{editing.name}</h2></div><button className="button primary slim" onClick={() => void saveEra()}>Save changes</button></div><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Description<textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label>Writer’s brief<textarea value={editing.writing_guidelines} onChange={(event) => setEditing({ ...editing, writing_guidelines: event.target.value })} /></label><div className="admin-fields"><label>Starts at<input type="number" min="1" max="800" value={editing.start_movie} onChange={(event) => setEditing({ ...editing, start_movie: Number(event.target.value) })} /></label><label>Ends at<input type="number" min="1" max="800" value={editing.end_movie} onChange={(event) => setEditing({ ...editing, end_movie: Number(event.target.value) })} /></label><label>Accent<input type="color" value={editing.accent} onChange={(event) => setEditing({ ...editing, accent: event.target.value })} /></label></div></div>}</div>}{tab === 'reports' && <section className="moderation-panel"><div className="stack-heading"><div><p className="eyebrow"><span /> Reports & review</p><h2>{queue.length ? `${queue.length} item${queue.length === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}</h2></div><Flag size={18} /></div>{queue.length ? queue.map((story) => <article className="queue-item" key={story.id}><div><b>{story.title}</b><p>Movie #{story.filmNumber} · @{story.author.handle}</p></div><div className="queue-actions"><button onClick={() => onModerate(story, 'archive')}>Archive</button><button className="approve" onClick={() => onModerate(story, 'approve_canon')}>Set canon</button></div></article>) : <p className="quiet-copy">Stories become canon or challenges automatically. Reports will appear here when someone flags one.</p>}</section>}{tab === 'members' && <section className="moderation-panel"><p className="eyebrow"><span /> Community</p><h2>Small group, clear roles.</h2><p className="quiet-copy">Everyone can read. Signed-in members can write, vote, comment, and earn ledger. Moderators can handle reports; administrators manage the overall record.</p><button className="button ghost slim" onClick={() => notify('Member controls are tied to each account’s archive role.')}>Role guide</button></section>}{tab === 'settings' && <section className="moderation-panel"><p className="eyebrow"><span /> Archive rules</p><h2>Publishing is automatic.</h2><p className="quiet-copy">The first submission for a film becomes canon. Later submissions start a challenge. Each writer keeps one active draft per film, and all voting earns ledger points.</p><button className="button ghost slim" onClick={() => notify('These community rules are active.')}>Check archive rules</button></section>}</section>
}

function SignInSheet({ close, login }: { close: () => void; login: () => void }) { return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="sign-in-sheet" role="dialog" aria-modal="true" aria-label="Sign in" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><span className="brand-mark">A</span><p className="eyebrow"><span /> Reader account</p><h2>Join the<br /><i>archive.</i></h2><p>Sign in to write stories, vote on challenges, and keep track of the films you care about.</p><button className="google-button" onClick={login}><b>G</b> Continue with Google</button>{!isSupabaseConfigured && <p className="config-note"><LockKeyhole size={14} /> Add the Supabase URL and publishable key from <code>.env.example</code> to enable Google sign-in.</p>}<small>You can read everything without an account. Sign in when you want to contribute.</small></section></div> }

function ProfileSheet({ member, close, logout }: { member: Member; close: () => void; logout: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="profile-sheet" role="dialog" aria-modal="true" aria-label="Your profile" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><div className="profile-heading"><span className="profile-avatar">{member.displayName.slice(0, 1)}</span><div><p className="eyebrow"><span /> Your account</p><h2>{member.displayName}</h2><p>@{member.handle}</p></div></div><div className="profile-stats"><div><small>Ledger balance</small><b><Sparkles size={15} /> {formatNumber(member.ledger)}</b></div><div><small>Archive role</small><b>{member.role === 'admin' ? 'Administrator' : member.role === 'moderator' ? 'Moderator' : 'Writer'}</b></div></div><p className="profile-note">Your account keeps your drafts, votes, and stories tied to the archive. You can read without signing in; signing out only affects this device.</p><button className="profile-logout" onClick={() => { close(); void logout() }}>Sign out <ArrowRight size={16} /></button></section></div>
}
