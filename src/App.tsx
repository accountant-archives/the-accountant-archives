import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bookmark, Check, ChevronRight, Clock3,
  FilePenLine, Flag, Gavel, Grid3X3, Heart, ImagePlus, Layers3, LoaderCircle, LockKeyhole, Maximize2, Menu, MessageCircle,
  Minimize2,
  MoveRight, PenLine, Search, Send, Settings2, ShieldCheck, Sparkles, Trophy, UserRound, X
} from 'lucide-react'
import { ERAS, descriptionForFilm, eraForFilm, filmForNumber, readingTime, titleForFilm, words, type Era, type Film } from './lib/catalogue'
import { isSupabaseConfigured, signInWithGoogle, supabase } from './lib/supabase'

type Page = 'home' | 'archive' | 'facts' | 'fanart' | 'timeline' | 'film' | 'write' | 'desk' | 'submitted' | 'admin'
type Role = 'writer' | 'moderator' | 'admin'
type Member = { id: string; handle: string; displayName: string; ledger: number; role: Role; avatarUrl?: string | null }
type PublicProfile = { id: string; handle: string; displayName: string; bio: string; ledger: number; avatarUrl?: string | null; createdAt: string }
type Story = {
  id: string
  title: string
  body: string
  filmNumber: number
  status: 'draft' | 'submitted' | 'canon' | 'challenger' | 'archived' | 'rejected'
  author: { id?: string; handle: string; displayName: string; ledger: number }
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

function classNames(...names: Array<string | false | undefined | null>) { return names.filter(Boolean).join(' ') }
function formatNumber(value: number) { return new Intl.NumberFormat('en-AU').format(value) }
function rankFor(points: number) {
  if (points >= 1000) return 'inferno'
  if (points >= 200) return 'obsidian'
  if (points >= 100) return 'gold'
  if (points >= 50) return 'silver'
  if (points >= 15) return 'bronze'
  return 'paper'
}
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
  const [publicProfileId, setPublicProfileId] = useState<string | null>(null)
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
          author: { id: raw.author_id, handle: profileById.get(raw.author_id)?.handle ?? 'unknown', displayName: profileById.get(raw.author_id)?.display_name ?? 'Unknown writer', ledger: profileById.get(raw.author_id)?.ledger_balance ?? 0 },
          metrics: (metricByStory.get(raw.id) as Story['metrics'] | undefined) ?? { upvotes: 0, downvotes: 0, bookmarks: 0, comments: 0 }, viewerReaction: reactionByStory.get(raw.id) as 1 | -1 | undefined, viewerBookmarked: bookmarkedStoryIds.has(raw.id)
        } satisfies Story
      })
      setStories(incoming)
    }
    setFilmLoading(false)
  }

  useEffect(() => { void loadFilm(focusedFilm) }, [])

  // The initial film request can finish before Supabase restores a persisted session.
  // Load once more for a signed-in member so their saved reaction/bookmark state is included.
  useEffect(() => {
    if (member?.id && page === 'film') void loadFilm(focusedFilm)
  }, [member?.id])

  useEffect(() => {
    const restore = () => {
      const parts = window.location.hash.replace(/^#\/?/, '').split('/')
      const candidate = parts[0] as Page
      if (['home', 'archive', 'facts', 'fanart', 'timeline', 'film', 'write', 'desk', 'submitted', 'admin'].includes(candidate)) setPage(candidate)
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
    { key: 'facts' as const, label: 'Fact sheet', icon: Layers3 },
    { key: 'fanart' as const, label: 'Fan art', icon: ImagePlus },
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
          {(member?.role === 'admin' || member?.role === 'moderator') && <button className={page === 'admin' ? 'active' : ''} onClick={() => { go('admin'); void loadModerationQueue() }}><ShieldCheck size={16} />Control room</button>}
        </nav>
        <div className="topbar-actions">
          {authLoading ? <LoaderCircle className="spin" size={18} /> : member ? <button className={classNames('member-pill', `rank-${rankFor(member.ledger)}`)} onClick={() => setProfileOpen(true)} title="Open your profile"><span className="avatar">{member.displayName.slice(0, 1)}</span><span><b>{member.handle}</b><small><Sparkles size={12} /> {formatNumber(member.ledger)}</small></span></button> : <button className="sign-in" onClick={() => setSignInOpen(true)}>Sign in <ArrowRight size={16} /></button>}
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Open navigation">{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <main>
        {page === 'home' && <Home onBrowse={() => go('archive')} onOpenFilm={openFilm} onOpenAuthor={setPublicProfileId} onWrite={() => void openWriter(1)} />}
        {page === 'archive' && <Archive films={allFilms} states={filmStates} search={archiveSearch} setSearch={setArchiveSearch} eraFilter={eraFilter} setEraFilter={setEraFilter} onOpenFilm={openFilm} />}
        {page === 'facts' && <FactsPage member={member} />}
        {page === 'fanart' && <FanArtPage member={member} onSignIn={() => setSignInOpen(true)} onOpenFilm={openFilm} onOpenAuthor={setPublicProfileId} notify={notify} />}
        {page === 'timeline' && <Timeline eras={eras} focus={timelineFocus} setFocus={setTimelineFocus} onOpenFilm={openFilm} />}
        {page === 'film' && <FilmPage film={currentFilm} stories={stories} loading={filmLoading} onBack={() => go('archive')} onOpenFilm={openFilm} onWrite={() => void openWriter()} onReact={reactToStory} onBookmark={bookmarkStory} onOpenAuthor={setPublicProfileId} />}
        {page === 'write' && <WritingStudio film={currentFilm} draft={draft} setDraft={setDraft} previewing={previewing} setPreviewing={setPreviewing} saving={draftSaving} onSave={() => void saveDraft()} onSubmit={() => void submitDraft()} onBack={() => go('film')} onFormat={insertMarkdown} />}
        {page === 'desk' && <WritingDesk stories={myStories} onOpenDraft={openDraft} onOpenFilm={openFilm} onWrite={() => void openWriter()} />}
        {page === 'submitted' && <SubmissionScreen story={lastSubmission} onDesk={() => { void loadMyStories(); go('desk') }} onFilm={() => openFilm(focusedFilm)} />}
        {page === 'admin' && <AdminRoom member={member} eras={eras} setEras={setEras} queue={adminQueue} onModerate={moderate} notify={notify} />}
      </main>

      <footer className="footer"><span>800 films about one unpaid bill.</span><span>Written by the people keeping the record.</span></footer>
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
      {signInOpen && <SignInSheet close={() => setSignInOpen(false)} login={login} />}
      {profileOpen && member && <ProfileSheet member={member} close={() => setProfileOpen(false)} logout={logout} onSaved={(displayName) => setMember((current) => current ? { ...current, displayName } : current)} />}
      {publicProfileId && <ContributorProfileSheet profileId={publicProfileId} close={() => setPublicProfileId(null)} onOpenFilm={openFilm} />}
    </div>
  )
}

function Home({ onBrowse, onOpenFilm, onOpenAuthor, onWrite }: { onBrowse: () => void; onOpenFilm: (number: number) => void; onOpenAuthor: (id: string) => void; onWrite: () => void }) {
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
    <Leaderboard onOpenAuthor={onOpenAuthor} />
    <section className="era-strip section-wrap"><div><p className="eyebrow"><span /> The chronology</p><h2>Six eras. <i>All still editable.</i></h2></div><div className="mini-timeline">{ERAS.map((era) => <button key={era.slug} style={{ '--era-colour': era.accent, flex: era.end_movie - era.start_movie + 1 } as React.CSSProperties} onClick={() => onOpenFilm(era.start_movie)}><b>{era.name}</b><small>#{era.start_movie}–{era.end_movie}</small></button>)}</div></section>
  </>
}

function Leaderboard({ onOpenAuthor }: { onOpenAuthor: (id: string) => void }) {
  const [members, setMembers] = useState<Array<{ id: string; handle: string; display_name: string; ledger_balance: number }>>([])
  useEffect(() => { if (!supabase) return; void supabase.from('profiles').select('id,handle,display_name,ledger_balance').order('ledger_balance', { ascending: false }).order('created_at').limit(10).then(({ data }) => setMembers(data ?? [])) }, [])
  return <section className="leaderboard section-wrap"><div className="leaderboard-heading"><div><p className="eyebrow"><span /> The ledger board</p><h2>The people keeping<br /><i>the record moving.</i></h2></div><p>Sparkle points reflect useful writing, votes, evidence, and time spent improving the archive.</p></div><div className="leaderboard-list">{members.length ? members.map((member, index) => <button key={member.id} className={classNames('leaderboard-row', `rank-${rankFor(member.ledger_balance)}`)} onClick={() => onOpenAuthor(member.id)}><span className="leaderboard-place">{String(index + 1).padStart(2, '0')}</span><span className="leaderboard-avatar">{member.display_name.slice(0, 1)}</span><span className="contributor-label"><b>{member.display_name}</b><small>@{member.handle}</small></span><span className="leaderboard-score"><Sparkles size={15} /> {formatNumber(member.ledger_balance)}</span></button>) : <div className="leaderboard-empty">The ledger will start filling as the group writes and votes.</div>}</div></section>
}

function CommunityFeed({ onOpenFilm }: { onOpenFilm: (number: number) => void }) {
  const [latest, setLatest] = useState<Array<{ id:string; title:string; film_number:number; status:string; created_at:string }>>([])
  useEffect(() => { if (!supabase) return; void supabase.from('stories').select('id,title,film_number,status,created_at').in('status', ['canon', 'challenger']).order('created_at', { ascending: false }).limit(8).then(({ data }) => setLatest(data ?? [])) }, [])
  const battles = latest.filter((story) => story.status === 'challenger'); const fresh = latest.filter((story) => story.status === 'canon').slice(0, 4)
  return <section className="community-feed section-wrap"><div><p className="eyebrow"><span /> The live archive</p><h2>What the group is <i>moving forward.</i></h2></div><div className="feed-columns"><div><header><Gavel size={17} /><b>Canon battles</b></header>{battles.length ? battles.map((story) => <button key={story.id} onClick={() => onOpenFilm(story.film_number)}><small>Movie #{story.film_number} · Vote open</small><b>{story.title}</b><ArrowRight size={15} /></button>) : <p>No active challenges yet. The next alternative story starts one automatically.</p>}</div><div><header><Sparkles size={17} /><b>Newest canon</b></header>{fresh.length ? fresh.map((story) => <button key={story.id} onClick={() => onOpenFilm(story.film_number)}><small>Movie #{story.film_number}</small><b>{story.title}</b><ArrowRight size={15} /></button>) : <p>The first published story will show up here.</p>}</div></div></section>
}

function Archive({ films, states, search, setSearch, eraFilter, setEraFilter, onOpenFilm }: { films: Film[]; states: Record<number, 'open' | 'canon' | 'challenger'>; search: string; setSearch: (value: string) => void; eraFilter: string; setEraFilter: (value: string) => void; onOpenFilm: (number: number) => void }) {
  const [stateFilter, setStateFilter] = useState<'all' | 'open' | 'canon' | 'challenger'>('all')
  const visible = films.filter((film) => {
    const query = search.toLowerCase().trim()
    const state = states[film.number] ?? 'open'
    return (!query || `${film.number} ${film.title} ${film.official_description}`.toLowerCase().includes(query)) && (eraFilter === 'all' || film.era.slug === eraFilter) && (stateFilter === 'all' || state === stateFilter)
  })
  return <section className="archive section-wrap">
    <div className="archive-heading"><div><p className="eyebrow"><span /> The full paper trail</p><h1>All <i>800 films.</i></h1><p>Search by title or number, or jump straight to an era.</p></div><div className="archive-amount">{formatNumber(visible.length)} <span>films found</span></div></div>
    <div className="archive-tools"><label className="search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title or film number" /><kbd>⌘ K</kbd></label><div className="archive-filter-groups"><div className="era-filters"><button className={eraFilter === 'all' ? 'selected' : ''} onClick={() => setEraFilter('all')}>All eras</button>{ERAS.map((era) => <button key={era.slug} className={eraFilter === era.slug ? 'selected' : ''} onClick={() => setEraFilter(era.slug)}>{era.name}</button>)}</div><div className="state-filters" aria-label="Filter by story state"><button className={stateFilter === 'all' ? 'selected' : ''} onClick={() => setStateFilter('all')}>Everything</button><button className={stateFilter === 'open' ? 'selected' : ''} onClick={() => setStateFilter('open')}>Unwritten</button><button className={stateFilter === 'canon' ? 'selected' : ''} onClick={() => setStateFilter('canon')}>Canon</button><button className={stateFilter === 'challenger' ? 'selected' : ''} onClick={() => setStateFilter('challenger')}>In challenge</button></div></div></div>
    <div className="archive-key"><span className="open">Open</span><span className="canon">Canon</span><span className="challenger">Challenge open</span></div><div className="film-grid">{visible.map((film) => { const state = states[film.number] ?? 'open'; return <button className={classNames('film-card', `film-${state}`)} key={film.number} onClick={() => onOpenFilm(film.number)} style={{ '--era-colour': film.era.accent } as React.CSSProperties}><span className="film-number">#{String(film.number).padStart(3, '0')}</span><span className="film-state">{state === 'canon' ? 'Canon' : state === 'challenger' ? 'Challenge' : 'Open'}</span><h3>{film.title}</h3><p>{film.official_description}</p><footer><span>{film.era.name}</span><ChevronRight size={16} /></footer></button> })}</div>
  </section>
}

type FactNode = { id: string; parent_id: string | null; author_id: string; title: string; body: string; status: 'pending' | 'confirmed' | 'declined'; created_at: string }
type FactSource = { id: string; fact_id: string; story_id: string; quoted_text: string; note: string }
type FactStory = { id: string; film_number: number; title: string }

function LegacyFactsPage({ member }: { member: Member | null }) {
  const [facts, setFacts] = useState<FactNode[]>([])
  const [sources, setSources] = useState<FactSource[]>([])
  const [authors, setAuthors] = useState<Map<string, { handle: string; display_name: string }>>(new Map())
  const [stories, setStories] = useState<FactStory[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [storyId, setStoryId] = useState('')
  const [quote, setQuote] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const canContribute = Boolean(member && member.ledger >= 50)
  const isModerator = member?.role === 'admin' || member?.role === 'moderator'

  async function refresh() {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const { data: factRows, error } = await supabase.from('fact_nodes').select('id,parent_id,author_id,title,body,status,created_at').order('created_at', { ascending: true })
    if (error) { setMessage(error.message); setLoading(false); return }
    const nextFacts = (factRows ?? []) as FactNode[]
    const ids = nextFacts.map((fact) => fact.id)
    const authorIds = [...new Set(nextFacts.map((fact) => fact.author_id))]
    const [{ data: sourceRows }, { data: profileRows }, { data: storyRows }] = await Promise.all([
      ids.length ? supabase.from('fact_sources').select('id,fact_id,story_id,quoted_text,note').in('fact_id', ids) : Promise.resolve({ data: [] as FactSource[] }),
      authorIds.length ? supabase.from('profiles').select('id,handle,display_name').in('id', authorIds) : Promise.resolve({ data: [] as Array<{ id: string; handle: string; display_name: string }> }),
      supabase.from('stories').select('id,film_number,title').in('status', ['canon', 'challenger', 'archived']).order('published_at', { ascending: false }).limit(100)
    ])
    setFacts(nextFacts); setSources((sourceRows ?? []) as FactSource[]); setAuthors(new Map((profileRows ?? []).map((profile) => [profile.id, profile]))); setStories((storyRows ?? []) as FactStory[]); setLoading(false)
  }

  useEffect(() => { void refresh() }, [member?.id])

  async function submitFact() {
    if (!supabase || !member) { setMessage('Sign in to submit a fact.'); return }
    if (!canContribute) { setMessage('Fact Sheet contributors need 50 Sparkle Points.'); return }
    if (title.trim().length < 5 || body.trim().length < 20 || !storyId || quote.trim().length < 12) { setMessage('Add a title, a short fact, and a meaningful quote from a published story.'); return }
    const { data: created, error } = await supabase.from('fact_nodes').insert({ author_id: member.id, title: title.trim(), body: body.trim() }).select('id').single()
    if (error || !created) { setMessage(error?.message ?? 'Could not save that fact.'); return }
    const sourceResult = await supabase.from('fact_sources').insert({ fact_id: created.id, story_id: storyId, quoted_text: quote.trim(), note: note.trim() })
    if (sourceResult.error) { setMessage(sourceResult.error.message); return }
    setTitle(''); setBody(''); setStoryId(''); setQuote(''); setNote(''); setComposerOpen(false); setMessage('Fact submitted for review.'); void refresh()
  }

  async function reviewFact(fact: FactNode, status: 'confirmed' | 'declined') {
    if (!supabase || !member) return
    if (status === 'confirmed' && !sources.some((source) => source.fact_id === fact.id)) { setMessage('A fact needs a story quote before it can be confirmed.'); return }
    const { error } = await supabase.from('fact_nodes').update({ status, reviewed_by: member.id }).eq('id', fact.id)
    if (error) setMessage(error.message); else { setMessage(status === 'confirmed' ? 'Fact confirmed.' : 'Fact declined.'); void refresh() }
  }

  return <section className="facts-page section-wrap"><div className="facts-heading"><div><p className="eyebrow"><span /> Shared reference</p><h1>The <i>Fact Sheet.</i></h1><p>A living record of confirmed details, each one anchored to the stories that established it.</p></div><div className="facts-actions"><span><Sparkles size={15} /> 50 points to contribute</span>{canContribute ? <button className="button primary" onClick={() => setComposerOpen((value) => !value)}><PenLine size={16} /> Add a fact</button> : <button className="button ghost" onClick={() => setComposerOpen((value) => !value)}>How it works</button>}</div></div>{composerOpen && <section className="fact-composer"><div><p className="eyebrow"><span /> New fact</p><h2>Put it on the record.</h2><p>Keep it specific. Quote the story that supports it so readers can check the claim for themselves.</p></div>{canContribute ? <div className="fact-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fact title" maxLength={120} /><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="State the fact in plain language…" maxLength={6000} /><select value={storyId} onChange={(event) => setStoryId(event.target.value)}><option value="">Choose the source story</option>{stories.map((story) => <option key={story.id} value={story.id}>#{String(story.film_number).padStart(3, '0')} · {story.title}</option>)}</select><textarea value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Paste the exact supporting quote" maxLength={1200} /><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this quote supports the fact (optional)" maxLength={400} /><div><button className="button primary slim" onClick={() => void submitFact()}>Submit for review <Send size={14} /></button><button className="button ghost slim" onClick={() => setComposerOpen(false)}>Cancel</button></div></div> : <div className="fact-threshold"><Sparkles size={22} /><b>Fact Sheet contributors unlock at 50 Sparkle Points.</b><p>Read, write, vote, and leave useful comments first. The threshold keeps the reference page considered without making it closed off.</p></div>}</section>}<div className="facts-key"><span className="confirmed">Confirmed fact</span>{isModerator && <span className="pending">Awaiting review</span>}<span>Every entry links back to a story quote.</span></div>{loading ? <div className="loading-card"><LoaderCircle className="spin" /> Loading the record…</div> : facts.length ? <div className="facts-list">{facts.map((fact) => { const factSources = sources.filter((source) => source.fact_id === fact.id); const author = authors.get(fact.author_id); return <article key={fact.id} className={classNames('fact-card', fact.status)}><header><span className={classNames('fact-status', fact.status)}>{fact.status === 'confirmed' ? <><Check size={14} /> Confirmed</> : fact.status === 'pending' ? 'Pending review' : 'Declined'}</span><small>{author ? `${author.display_name} · @${author.handle}` : 'Archive contributor'} · {relativeDate(fact.created_at)}</small></header><h2>{fact.title}</h2><p>{fact.body}</p>{factSources.map((source) => { const story = stories.find((entry) => entry.id === source.story_id); return <blockquote key={source.id}><span>Source · {story ? `Movie #${String(story.film_number).padStart(3, '0')} — ${story.title}` : 'Published story'}</span><p>“{source.quoted_text}”</p>{source.note && <small>{source.note}</small>}</blockquote> })}{isModerator && fact.status === 'pending' && <footer><button className="button primary slim" onClick={() => void reviewFact(fact, 'confirmed')}>Confirm</button><button className="button ghost slim" onClick={() => void reviewFact(fact, 'declined')}>Decline</button></footer>}</article> })}</div> : <div className="empty-canon fact-empty"><p className="eyebrow"><span /> Blank reference</p><h2>The record has not been <i>annotated yet.</i></h2><p>Confirmed facts will appear here as the archive grows.</p></div>}{message && <p className="fact-message">{message}</p>}</section>
}

type FactDispute = { id: string; fact_id: string; reporter_id: string; reason: string; status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; created_at: string }

function LegacyModeratedFactsPage({ member }: { member: Member | null }) {
  const [facts, setFacts] = useState<FactNode[]>([])
  const [sources, setSources] = useState<FactSource[]>([])
  const [disputes, setDisputes] = useState<FactDispute[]>([])
  const [authors, setAuthors] = useState<Map<string, { handle: string; display_name: string }>>(new Map())
  const [stories, setStories] = useState<FactStory[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [parentId, setParentId] = useState('')
  const [storyId, setStoryId] = useState('')
  const [quote, setQuote] = useState('')
  const [note, setNote] = useState('')
  const [citationFor, setCitationFor] = useState<string | null>(null)
  const [citationStoryId, setCitationStoryId] = useState('')
  const [citationQuote, setCitationQuote] = useState('')
  const [citationNote, setCitationNote] = useState('')
  const [disputeFor, setDisputeFor] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const canContribute = Boolean(member && member.ledger >= 50)
  const isModerator = member?.role === 'admin' || member?.role === 'moderator'

  async function refresh() {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const { data: factRows, error } = await supabase.from('fact_nodes').select('id,parent_id,author_id,title,body,status,created_at').order('created_at', { ascending: true })
    if (error) { setMessage(error.message); setLoading(false); return }
    const nextFacts = (factRows ?? []) as FactNode[]
    const ids = nextFacts.map((fact) => fact.id)
    const authorIds = [...new Set(nextFacts.map((fact) => fact.author_id))]
    const [{ data: sourceRows }, { data: profileRows }, { data: storyRows }, disputeResult] = await Promise.all([
      ids.length ? supabase.from('fact_sources').select('id,fact_id,story_id,quoted_text,note').in('fact_id', ids) : Promise.resolve({ data: [] as FactSource[] }),
      authorIds.length ? supabase.from('profiles').select('id,handle,display_name').in('id', authorIds) : Promise.resolve({ data: [] as Array<{ id: string; handle: string; display_name: string }> }),
      supabase.from('stories').select('id,film_number,title').in('status', ['canon', 'challenger', 'archived']).order('published_at', { ascending: false }).limit(100),
      member ? supabase.from('fact_disputes').select('id,fact_id,reporter_id,reason,status,created_at').order('created_at', { ascending: true }) : Promise.resolve({ data: [] as FactDispute[] })
    ])
    setFacts(nextFacts); setSources((sourceRows ?? []) as FactSource[]); setAuthors(new Map((profileRows ?? []).map((profile) => [profile.id, profile]))); setStories((storyRows ?? []) as FactStory[]); setDisputes((disputeResult.data ?? []) as FactDispute[]); setLoading(false)
  }

  useEffect(() => { void refresh() }, [member?.id])

  async function submitFact() {
    if (!supabase || !member) { setMessage('Sign in to submit a fact.'); return }
    if (!canContribute) { setMessage('Fact Sheet contributors need 50 Sparkle Points.'); return }
    if (title.trim().length < 5 || body.trim().length < 20 || !storyId || quote.trim().length < 12) { setMessage('Add a title, a short fact, and a meaningful quote from a published story.'); return }
    const { data: created, error } = await supabase.from('fact_nodes').insert({ author_id: member.id, parent_id: parentId || null, title: title.trim(), body: body.trim() }).select('id').single()
    if (error || !created) { setMessage(error?.message ?? 'Could not save that fact.'); return }
    const sourceResult = await supabase.from('fact_sources').insert({ fact_id: created.id, story_id: storyId, quoted_text: quote.trim(), note: note.trim() })
    if (sourceResult.error) { setMessage(sourceResult.error.message); return }
    setTitle(''); setBody(''); setParentId(''); setStoryId(''); setQuote(''); setNote(''); setComposerOpen(false); setMessage('Sourced fact published.'); void refresh()
  }

  async function addCitation() {
    if (!supabase || !citationFor || !canContribute) { setMessage('You need 50 Sparkle Points to add evidence.'); return }
    if (!citationStoryId || citationQuote.trim().length < 12) { setMessage('Choose a story and add the exact supporting quote.'); return }
    const { error } = await supabase.from('fact_sources').insert({ fact_id: citationFor, story_id: citationStoryId, quoted_text: citationQuote.trim(), note: citationNote.trim() })
    if (error) { setMessage(error.message); return }
    setCitationFor(null); setCitationStoryId(''); setCitationQuote(''); setCitationNote(''); setMessage('Source added to the record.'); void refresh()
  }

  async function submitDispute() {
    if (!supabase || !member || !disputeFor) { setMessage('Sign in to flag a contradiction.'); return }
    if (disputeReason.trim().length < 20) { setMessage('Explain the conflict in at least 20 characters.'); return }
    const { error } = await supabase.from('fact_disputes').insert({ fact_id: disputeFor, reporter_id: member.id, reason: disputeReason.trim() })
    if (error) { setMessage(error.message); return }
    setDisputeFor(null); setDisputeReason(''); setMessage('Contradiction sent to the review queue.'); void refresh()
  }

  async function reviewFact(fact: FactNode, status: 'confirmed' | 'declined') {
    if (!supabase || !member) return
    if (status === 'confirmed' && !sources.some((source) => source.fact_id === fact.id)) { setMessage('A fact needs a story quote before it can be confirmed.'); return }
    const { error } = await supabase.from('fact_nodes').update({ status, reviewed_by: member.id }).eq('id', fact.id)
    if (error) setMessage(error.message); else { setMessage(status === 'confirmed' ? 'Fact confirmed.' : 'Fact declined.'); void refresh() }
  }

  async function moveFact(factId: string, nextParentId: string) {
    if (!supabase || !isModerator) return
    const { error } = await supabase.from('fact_nodes').update({ parent_id: nextParentId || null }).eq('id', factId)
    if (error) setMessage(error.message); else { setMessage('Fact moved.'); void refresh() }
  }

  async function resolveDispute(dispute: FactDispute, status: 'resolved' | 'dismissed') {
    if (!supabase || !member || !isModerator) return
    const { error } = await supabase.from('fact_disputes').update({ status, handled_by: member.id, resolution_note: status === 'resolved' ? 'Reviewed against the cited stories.' : 'No contradiction found in the cited stories.' }).eq('id', dispute.id)
    if (error) setMessage(error.message); else { setMessage(status === 'resolved' ? 'Contradiction resolved.' : 'Report dismissed.'); void refresh() }
  }

  const listedFacts = facts.filter((fact) => fact.status !== 'declined')
  const children = new Map<string, FactNode[]>()
  for (const fact of listedFacts) if (fact.parent_id) children.set(fact.parent_id, [...(children.get(fact.parent_id) ?? []), fact])
  const roots = listedFacts.filter((fact) => !fact.parent_id || !listedFacts.some((candidate) => candidate.id === fact.parent_id))

  function FactCard({ fact, depth = 0 }: { fact: FactNode; depth?: number }) {
    const factSources = sources.filter((source) => source.fact_id === fact.id); const author = authors.get(fact.author_id); const openDisputes = disputes.filter((dispute) => dispute.fact_id === fact.id && ['open', 'reviewing'].includes(dispute.status)); const childFacts = children.get(fact.id) ?? []
    return <li className="fact-tree-item" style={{ '--fact-depth': depth } as React.CSSProperties}><article className={classNames('fact-card', fact.status)}><header><span className={classNames('fact-status', fact.status)}>{fact.status === 'confirmed' ? <><Check size={14} /> Confirmed</> : 'Pending review'}</span><small>{author ? `${author.display_name} · @${author.handle}` : 'Archive contributor'} · {relativeDate(fact.created_at)}</small></header><h2>{fact.title}</h2><p>{fact.body}</p>{factSources.map((source) => { const story = stories.find((entry) => entry.id === source.story_id); return <blockquote key={source.id}><span>Source · {story ? `Movie #${String(story.film_number).padStart(3, '0')} — ${story.title}` : 'Published story'}</span><p>“{source.quoted_text}”</p>{source.note && <small>{source.note}</small>}</blockquote> })}<footer>{canContribute && <button className="button ghost slim" onClick={() => setCitationFor(citationFor === fact.id ? null : fact.id)}>Add source</button>}{member && fact.status === 'confirmed' && <button className="text-button flag-fact" onClick={() => setDisputeFor(disputeFor === fact.id ? null : fact.id)}><Flag size={14} /> Flag contradiction</button>}{isModerator && fact.status === 'pending' && <><button className="button primary slim" onClick={() => void reviewFact(fact, 'confirmed')}>Confirm</button><button className="button ghost slim" onClick={() => void reviewFact(fact, 'declined')}>Decline</button></>}{isModerator && <span className="fact-review-count">{openDisputes.length ? `${openDisputes.length} conflict${openDisputes.length === 1 ? '' : 's'} open` : 'No open conflicts'}</span>}</footer>{citationFor === fact.id && <div className="fact-inline-form"><select value={citationStoryId} onChange={(event) => setCitationStoryId(event.target.value)}><option value="">Choose another story</option>{stories.map((story) => <option key={story.id} value={story.id}>#{String(story.film_number).padStart(3, '0')} · {story.title}</option>)}</select><textarea value={citationQuote} onChange={(event) => setCitationQuote(event.target.value)} placeholder="Exact supporting quote" maxLength={1200} /><input value={citationNote} onChange={(event) => setCitationNote(event.target.value)} placeholder="Why it matters (optional)" maxLength={400} /><button className="button primary slim" onClick={() => void addCitation()}>Add source</button></div>}{disputeFor === fact.id && <div className="fact-inline-form dispute-form"><textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="Which part conflicts with the archive, and why?" maxLength={1200} /><button className="button ghost slim" onClick={() => void submitDispute()}>Send for review</button></div>}{isModerator && <label className="fact-parent"><span>Filed under</span><select value={fact.parent_id ?? ''} onChange={(event) => void moveFact(fact.id, event.target.value)}><option value="">Top-level entry</option>{listedFacts.filter((candidate) => candidate.id !== fact.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>}</article>{childFacts.length > 0 && <ol className="fact-tree">{childFacts.map((child) => <FactCard key={child.id} fact={child} depth={depth + 1} />)}</ol>}{isModerator && openDisputes.length > 0 && <section className="fact-dispute-queue">{openDisputes.map((dispute) => <article key={dispute.id}><p className="eyebrow"><span /> Contradiction report</p><p>{dispute.reason}</p><div><button className="button primary slim" onClick={() => void resolveDispute(dispute, 'resolved')}>Resolve</button><button className="button ghost slim" onClick={() => void resolveDispute(dispute, 'dismissed')}>Dismiss</button></div></article>)}</section>}</li>
  }

  return <section className="facts-page section-wrap"><div className="facts-heading"><div><p className="eyebrow"><span /> Shared reference</p><h1>The <i>Fact Sheet.</i></h1><p>A living, sourced record. Facts can be filed under each other, strengthened with more evidence, or sent back to review when the archive contradicts them.</p></div><div className="facts-actions"><span><Sparkles size={15} /> 50 points to contribute</span>{canContribute ? <button className="button primary" onClick={() => setComposerOpen((value) => !value)}><PenLine size={16} /> Add a fact</button> : <button className="button ghost" onClick={() => setComposerOpen((value) => !value)}>How it works</button>}</div></div>{composerOpen && <section className="fact-composer"><div><p className="eyebrow"><span /> New fact</p><h2>Put it on the record.</h2><p>Keep it specific, file it where it belongs, and quote the story that supports it.</p></div>{canContribute ? <div className="fact-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fact title" maxLength={120} /><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="State the fact in plain language…" maxLength={6000} /><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">File as a top-level entry</option>{listedFacts.filter((fact) => fact.status === 'confirmed').map((fact) => <option key={fact.id} value={fact.id}>{fact.title}</option>)}</select><select value={storyId} onChange={(event) => setStoryId(event.target.value)}><option value="">Choose the source story</option>{stories.map((story) => <option key={story.id} value={story.id}>#{String(story.film_number).padStart(3, '0')} · {story.title}</option>)}</select><textarea value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Paste the exact supporting quote" maxLength={1200} /><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this quote supports the fact (optional)" maxLength={400} /><div><button className="button primary slim" onClick={() => void submitFact()}>Submit for review <Send size={14} /></button><button className="button ghost slim" onClick={() => setComposerOpen(false)}>Cancel</button></div></div> : <div className="fact-threshold"><Sparkles size={22} /><b>Fact Sheet contributors unlock at 50 Sparkle Points.</b><p>Read, write, vote, and leave useful comments first. The threshold keeps the reference page considered without making it closed off.</p></div>}</section>}<div className="facts-key"><span className="confirmed">Confirmed fact</span>{isModerator && <span className="pending">Awaiting review</span>}<span>Every entry links back to a story quote.</span></div>{loading ? <div className="loading-card"><LoaderCircle className="spin" /> Loading the record…</div> : roots.length ? <ol className="fact-tree fact-tree-root">{roots.map((fact) => <FactCard key={fact.id} fact={fact} />)}</ol> : <div className="empty-canon fact-empty"><p className="eyebrow"><span /> Blank reference</p><h2>The record has not been <i>annotated yet.</i></h2><p>Confirmed facts will appear here as the archive grows.</p></div>}{message && <p className="fact-message">{message}</p>}</section>
}

type EvidenceStory = { id: string; film_number: number; title: string; body_markdown: string }
type FactMetric = { fact_id: string; supports: number; disputes: number; sources: number }

function PassagePicker({ stories, storyId, setStoryId, quote, setQuote }: { stories: EvidenceStory[]; storyId: string; setStoryId: (value: string) => void; quote: string; setQuote: (value: string) => void }) {
  const source = stories.find((story) => story.id === storyId)
  function capture(event: React.SyntheticEvent<HTMLTextAreaElement>) { const field = event.currentTarget; const passage = field.value.slice(field.selectionStart, field.selectionEnd).trim(); if (passage) setQuote(passage) }
  return <div className="passage-picker"><label>Source story<select value={storyId} onChange={(event) => { setStoryId(event.target.value); setQuote('') }}><option value="">Choose a published story</option>{stories.map((story) => <option key={story.id} value={story.id}>#{String(story.film_number).padStart(3, '0')} · {story.title}</option>)}</select></label>{source ? <><p className="source-reader-label">Select a passage from the story below.</p><textarea className="source-reader" value={source.body_markdown} readOnly onSelect={capture} aria-label={`Source text for ${source.title}`} />{quote ? <div className="selected-passage"><Check size={15} /><span>Passage selected</span><p>“{quote}”</p><button onClick={() => setQuote('')}>Clear</button></div> : <small className="source-reader-help">Highlight a sentence or paragraph in the source reader. The passage cannot be typed manually.</small>}</> : <div className="source-reader-empty">Choose a story to inspect and cite its text.</div>}</div>
}

function ArchiveSignal() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const context = element.getContext('2d')
    if (!context) return
    let frame = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (time: number) => {
      const box = element.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(box.width * scale)); const height = Math.max(1, Math.round(box.height * scale))
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height }
      context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, box.width, box.height)
      const originX = box.width * .66; const originY = box.height * .47; const radius = Math.min(box.width, box.height) * .28
      context.strokeStyle = 'rgba(49, 93, 126, .16)'; context.lineWidth = 1
      for (let ring = 1; ring <= 3; ring += 1) { context.beginPath(); context.arc(originX, originY, radius * (ring / 3), 0, Math.PI * 2); context.stroke() }
      context.setLineDash([2, 6]); context.strokeStyle = 'rgba(167, 67, 55, .3)'; context.beginPath(); context.moveTo(originX - radius * 1.15, originY); context.lineTo(originX + radius * 1.15, originY); context.stroke(); context.setLineDash([])
      const orbit = reducedMotion ? 0 : time * .00032; const dotX = originX + Math.cos(orbit) * radius; const dotY = originY + Math.sin(orbit * 1.35) * radius * .56
      const glow = context.createRadialGradient(dotX, dotY, 0, dotX, dotY, 16); glow.addColorStop(0, 'rgba(167,67,55,.7)'); glow.addColorStop(1, 'rgba(167,67,55,0)'); context.fillStyle = glow; context.beginPath(); context.arc(dotX, dotY, 16, 0, Math.PI * 2); context.fill()
      context.fillStyle = '#a74337'; context.beginPath(); context.arc(dotX, dotY, 2.4, 0, Math.PI * 2); context.fill()
      if (!reducedMotion) frame = requestAnimationFrame(draw)
    }
    if (reducedMotion) draw(0)
    else frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <canvas ref={canvas} className="archive-signal" aria-hidden="true" />
}

function FactsPage({ member }: { member: Member | null }) {
  const [facts, setFacts] = useState<FactNode[]>([])
  const [sources, setSources] = useState<FactSource[]>([])
  const [metrics, setMetrics] = useState<Map<string, FactMetric>>(new Map())
  const [mine, setMine] = useState<Map<string, 1 | -1>>(new Map())
  const [authors, setAuthors] = useState<Map<string, { handle: string; display_name: string }>>(new Map())
  const [stories, setStories] = useState<EvidenceStory[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [parentId, setParentId] = useState(''); const [storyId, setStoryId] = useState(''); const [quote, setQuote] = useState(''); const [note, setNote] = useState('')
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null); const [evidenceStoryId, setEvidenceStoryId] = useState(''); const [evidenceQuote, setEvidenceQuote] = useState(''); const [evidenceNote, setEvidenceNote] = useState('')
  const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState('')

  async function refresh() {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const { data: factRows, error } = await supabase.from('fact_nodes').select('id,parent_id,author_id,title,body,status,created_at').eq('status', 'confirmed').order('created_at', { ascending: true })
    if (error) { setMessage(error.message); setLoading(false); return }
    const nextFacts = (factRows ?? []) as FactNode[]; const factIds = nextFacts.map((fact) => fact.id); const authorIds = [...new Set(nextFacts.map((fact) => fact.author_id))]
    const [{ data: sourceRows }, { data: metricRows }, { data: authorRows }, { data: storyRows }, reactionResult] = await Promise.all([
      factIds.length ? supabase.from('fact_sources').select('id,fact_id,story_id,quoted_text,note').in('fact_id', factIds) : Promise.resolve({ data: [] as FactSource[] }),
      factIds.length ? supabase.from('fact_metrics').select('fact_id,supports,disputes,sources').in('fact_id', factIds) : Promise.resolve({ data: [] as FactMetric[] }),
      authorIds.length ? supabase.from('profiles').select('id,handle,display_name').in('id', authorIds) : Promise.resolve({ data: [] as Array<{ id: string; handle: string; display_name: string }> }),
      supabase.from('stories').select('id,film_number,title,body_markdown').in('status', ['canon', 'challenger', 'archived']).order('published_at', { ascending: false }).limit(120),
      member && factIds.length ? supabase.from('fact_reactions').select('fact_id,value').eq('user_id', member.id).in('fact_id', factIds) : Promise.resolve({ data: [] as Array<{ fact_id: string; value: 1 | -1 }> })
    ])
    setFacts(nextFacts); setSources((sourceRows ?? []) as FactSource[]); setMetrics(new Map(((metricRows ?? []) as FactMetric[]).map((metric) => [metric.fact_id, metric]))); setAuthors(new Map((authorRows ?? []).map((author) => [author.id, author]))); setStories((storyRows ?? []) as EvidenceStory[]); setMine(new Map((reactionResult.data ?? []).map((reaction) => [reaction.fact_id, reaction.value as 1 | -1]))); setLoading(false)
  }
  useEffect(() => { void refresh() }, [member?.id])

  async function publishFact() {
    if (!supabase || !member) { setMessage('Sign in to add a fact.'); return }
    if (title.trim().length < 5 || body.trim().length < 30 || !storyId || quote.length < 12) { setMessage('Add a clear title and fact, then select a passage from a published story.'); return }
    setSubmitting(true); setMessage('')
    const { data: created, error } = await supabase.from('fact_nodes').insert({ author_id: member.id, parent_id: parentId || null, title: title.trim(), body: body.trim(), status: 'confirmed' }).select('id').single()
    if (error || !created) { setSubmitting(false); setMessage(error?.message ?? 'The fact could not be published.'); return }
    const sourceResult = await supabase.from('fact_sources').insert({ fact_id: created.id, story_id: storyId, quoted_text: quote, note: note.trim() })
    setSubmitting(false)
    if (sourceResult.error) { setMessage(`The fact was saved, but its source needs retrying: ${sourceResult.error.message}`); void refresh(); return }
    setTitle(''); setBody(''); setParentId(''); setStoryId(''); setQuote(''); setNote(''); setComposerOpen(false); setMessage('Sourced fact published.'); void refresh()
  }

  async function addEvidence() {
    if (!supabase || !evidenceFor || !evidenceStoryId || evidenceQuote.length < 12) { setMessage('Choose a story and select a passage before adding evidence.'); return }
    const { error } = await supabase.from('fact_sources').insert({ fact_id: evidenceFor, story_id: evidenceStoryId, quoted_text: evidenceQuote, note: evidenceNote.trim() })
    if (error) { setMessage(error.message); return }; setEvidenceFor(null); setEvidenceStoryId(''); setEvidenceQuote(''); setEvidenceNote(''); setMessage('Evidence added.'); void refresh()
  }

  async function react(fact: FactNode, value: 1 | -1) {
    if (!supabase || !member) { setMessage('Sign in to weigh in on a fact.'); return }
    const remove = mine.get(fact.id) === value
    const { error } = remove ? await supabase.from('fact_reactions').delete().eq('fact_id', fact.id).eq('user_id', member.id) : await supabase.from('fact_reactions').upsert({ fact_id: fact.id, user_id: member.id, value }, { onConflict: 'fact_id,user_id' })
    if (error) setMessage(error.message); else { setMine((current) => { const next = new Map(current); if (remove) next.delete(fact.id); else next.set(fact.id, value); return next }); void refresh() }
  }

  const children = new Map<string, FactNode[]>(); for (const fact of facts) if (fact.parent_id) children.set(fact.parent_id, [...(children.get(fact.parent_id) ?? []), fact]); const roots = facts.filter((fact) => !fact.parent_id || !facts.some((candidate) => candidate.id === fact.parent_id)); const sourceCount = sources.length
  function jumpToFact(id: string) { document.getElementById(`fact-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  function FactCard({ fact, depth = 0 }: { fact: FactNode; depth?: number }) {
    const evidence = sources.filter((source) => source.fact_id === fact.id); const metric = metrics.get(fact.id) ?? { fact_id: fact.id, supports: 0, disputes: 0, sources: evidence.length }; const author = authors.get(fact.author_id); const childFacts = children.get(fact.id) ?? []
    return <li className="fact-tree-item wiki-tree-item" style={{ '--fact-depth': depth } as React.CSSProperties}><article id={`fact-${fact.id}`} className="fact-card sourced wiki-entry"><header><div><span className="wiki-section-number">{String(depth + 1).padStart(2, '0')}</span><span className="fact-status confirmed"><Check size={13} /> Sourced</span></div><small>Added by {author ? <><b>{author.display_name}</b> · @{author.handle}</> : 'an archive contributor'} · {relativeDate(fact.created_at)}</small></header><h2>{fact.title}</h2><p className="wiki-entry-body">{fact.body}</p>{evidence.length > 0 && <section className="wiki-citations"><div><b>Evidence</b><span>{evidence.length} cited passage{evidence.length === 1 ? '' : 's'}</span></div>{evidence.map((source, index) => { const story = stories.find((entry) => entry.id === source.story_id); return <blockquote key={source.id}><sup>[{index + 1}]</sup><p>“{source.quoted_text}”</p><footer><span>Movie #{story ? String(story.film_number).padStart(3, '0') : '—'} · {story?.title ?? 'Published source'}</span>{source.note && <small>{source.note}</small>}</footer></blockquote> })}</section>}<footer className="wiki-entry-footer"><div className="fact-reactions"><button className={mine.get(fact.id) === 1 ? 'selected' : ''} onClick={() => void react(fact, 1)} title="Support this sourced fact"><ArrowUp size={15} /> Support {metric.supports}</button><button className={mine.get(fact.id) === -1 ? 'selected' : ''} onClick={() => void react(fact, -1)} title="Dispute this fact"><ArrowDown size={15} /> Dispute {metric.disputes}</button></div>{member && <button className="text-button" onClick={() => setEvidenceFor(evidenceFor === fact.id ? null : fact.id)}><BookOpen size={15} /> Add a source</button>}</footer>{evidenceFor === fact.id && <div className="evidence-drawer"><PassagePicker stories={stories} storyId={evidenceStoryId} setStoryId={setEvidenceStoryId} quote={evidenceQuote} setQuote={setEvidenceQuote} /><input value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} placeholder="Why this passage belongs here (optional)" maxLength={400} /><button className="button primary slim" onClick={() => void addEvidence()}>Attach source</button></div>}</article>{childFacts.length > 0 && <ol className="fact-tree wiki-children">{childFacts.map((child) => <FactCard key={child.id} fact={child} depth={depth + 1} />)}</ol>}</li>
  }
  return <section className="facts-page wiki-page"><header className="wiki-masthead"><ArchiveSignal /><div><p className="eyebrow"><span /> The shared reference</p><h1>Fact <i>Sheet.</i></h1><p>A cited, collaborative record of what the archive has actually established. Every claim links back to the story that earned it.</p></div><div className="wiki-masthead-actions">{member ? <button className="button primary" onClick={() => setComposerOpen((open) => !open)}><PenLine size={16} /> Add an entry</button> : <span>Sign in to add to the record</span>}<small>Last updated live</small></div></header>{composerOpen && <section className="fact-composer fact-composer-premium wiki-composer"><div><p className="eyebrow"><span /> New referenced entry</p><h2>Start with the source.</h2><p>Write a concise claim, then select the exact line that supports it. No free-floating lore.</p></div><div className="fact-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Entry title" maxLength={120} /><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="State the fact clearly and without speculation…" maxLength={6000} /><label>Place in the record<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Top-level entry</option>{facts.map((fact) => <option key={fact.id} value={fact.id}>{fact.title}</option>)}</select></label><PassagePicker stories={stories} storyId={storyId} setStoryId={setStoryId} quote={quote} setQuote={setQuote} /><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this source supports the entry (optional)" maxLength={400} /><div><button className="button primary slim" disabled={submitting} onClick={() => void publishFact()}>{submitting ? 'Publishing…' : 'Publish entry'} <Send size={14} /></button><button className="button ghost slim" onClick={() => setComposerOpen(false)}>Cancel</button></div></div></section>}<div className="wiki-layout"><aside className="wiki-rail"><section><p className="eyebrow"><span /> Contents</p>{roots.length ? <ol>{roots.map((fact) => <li key={fact.id}><button onClick={() => jumpToFact(fact.id)}>{fact.title}</button>{(children.get(fact.id) ?? []).map((child) => <button className="wiki-rail-child" key={child.id} onClick={() => jumpToFact(child.id)}>{child.title}</button>)}</li>)}</ol> : <p>Entries will appear here.</p>}</section><section className="wiki-health"><p className="eyebrow"><span /> Record health</p><div><b>{facts.length}</b><span>entries</span></div><div><b>{sourceCount}</b><span>sources</span></div><p>Support a claim you can trace. Dispute one with another source.</p></section></aside><main className="wiki-record"><div className="wiki-record-bar"><span><Check size={14} /> All entries are sourced</span><span>{sourceCount} passages on record</span></div>{loading ? <div className="loading-card"><LoaderCircle className="spin" /> Opening the record…</div> : roots.length ? <ol className="fact-tree fact-tree-root wiki-tree">{roots.map((fact) => <FactCard key={fact.id} fact={fact} />)}</ol> : <div className="empty-canon fact-empty"><p className="eyebrow"><span /> First edition</p><h2>Nothing has been entered <i>yet.</i></h2><p>Choose a published story, select a passage, and establish the first piece of the record.</p></div>}{message && <p className="fact-message">{message}</p>}</main></div></section>
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

function FilmPage({ film, stories, loading, onBack, onOpenFilm, onWrite, onReact, onBookmark, onOpenAuthor }: { film: Film; stories: Story[]; loading: boolean; onBack: () => void; onOpenFilm: (number: number) => void; onWrite: () => void; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void; onOpenAuthor: (id: string) => void }) {
  const canon = stories.find((story) => story.status === 'canon'); const challengers = stories.filter((story) => story.status === 'challenger'); const displayTitle = canon?.title ?? film.title
  return <section className="film-page section-wrap"><div className="film-page-nav"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Archive</button><div className="film-switcher"><button disabled={film.number === 1} onClick={() => onOpenFilm(film.number - 1)}><ArrowLeft size={16} /> Previous</button><span>{film.number} / 800</span><button disabled={film.number === 800} onClick={() => onOpenFilm(film.number + 1)}>Next <ArrowRight size={16} /></button></div></div><div className="film-hero" style={{ '--era-colour': film.era.accent } as React.CSSProperties}><div className="film-label"><span>Movie</span><b>#{String(film.number).padStart(3, '0')}</b></div><div className="film-hero-copy"><p className="eyebrow"><span /> {film.era.name}</p>{canon && <small className="official-film-title">Official prompt: {film.title}</small>}<h1>{displayTitle}</h1><p>{film.official_description}</p></div><button className="button primary" onClick={onWrite}><PenLine size={17} />{canon ? 'Challenge canon' : 'Write the first story'}</button></div><div className="film-layout"><aside className="continuity-card"><p className="eyebrow">Continuity</p><button disabled={film.number === 1} onClick={() => onOpenFilm(film.number - 1)}><small>Before</small><b>#{film.number - 1}</b><span>{film.number > 1 ? titleForFilm(film.number - 1) : 'Beginning of the record'}</span></button><div className="current"><small>Now</small><b>#{film.number}</b><span>{displayTitle}</span></div><button disabled={film.number === 800} onClick={() => onOpenFilm(film.number + 1)}><small>After</small><b>#{film.number + 1}</b><span>{film.number < 800 ? titleForFilm(film.number + 1) : 'Paid in full'}</span></button><hr /><p>{film.era.writing_guidelines}</p></aside><div className="story-column">{loading ? <div className="loading-card"><LoaderCircle className="spin" />Loading film…</div> : canon ? <><StoryCard story={canon} featured onReact={onReact} onBookmark={onBookmark} onOpenAuthor={onOpenAuthor} /><EditProposalBox story={canon} /></> : <EmptyCanon film={film} onWrite={onWrite} />}{challengers.length > 0 && <section className="challenge-stack"><div className="stack-heading"><div><p className="eyebrow"><span /> Current vote</p><h2>Canon is being challenged.</h2></div></div>{challengers.map((story) => <StoryCard key={story.id} story={story} challenge onReact={onReact} onBookmark={onBookmark} onOpenAuthor={onOpenAuthor} />)}</section>}</div></div></section>
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

function StoryDiscussion({ storyId, onOpenAuthor }: { storyId: string; onOpenAuthor?: (id: string) => void }) {
  const [open, setOpen] = useState(true); const [body, setBody] = useState(''); const [comments, setComments] = useState<Array<{ id: string; body: string; created_at: string; author?: { id: string; handle: string; display_name: string; ledger_balance: number } }>>([]); const [message, setMessage] = useState(''); const [battle, setBattle] = useState<{ id: string; canon_story_id: string; challenger_story_id: string; closes_at: string; canon_votes: number; challenger_votes: number; mine?: string } | null>(null); const [now, setNow] = useState(() => Date.now())
  async function refresh() { if (!supabase) return; const { data, error } = await supabase.from('comments').select('id,body,created_at,author_id').eq('story_id', storyId).eq('is_removed', false).order('created_at'); if (error) { setMessage(error.message); return }; const ids = (data ?? []).map((comment) => comment.author_id); const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,handle,display_name,ledger_balance').in('id', ids) : { data: [] as Array<{ id: string; handle: string; display_name: string; ledger_balance: number }> }; const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile])); setComments((data ?? []).map((comment) => ({ ...comment, author: byId.get(comment.author_id) }))) }
  useEffect(() => { if (open) void refresh() }, [open, storyId])
  useEffect(() => { const client = supabase; if (!client) return; void (async () => { const { data } = await client.from('canon_challenges').select('id,canon_story_id,challenger_story_id,closes_at').eq('status', 'open').eq('challenger_story_id', storyId).maybeSingle(); if (!data) return; const { data: metrics } = await client.from('challenge_metrics').select('canon_votes,challenger_votes').eq('challenge_id', data.id).maybeSingle(); const { data: auth } = await client.auth.getUser(); const { data: vote } = auth.user ? await client.from('challenge_votes').select('story_id').eq('challenge_id', data.id).eq('user_id', auth.user.id).maybeSingle() : { data: null }; setBattle({ ...data, canon_votes: metrics?.canon_votes ?? 0, challenger_votes: metrics?.challenger_votes ?? 0, mine: vote?.story_id }) })() }, [storyId])
  useEffect(() => { if (!battle) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [battle?.id])
  async function castVote(storyIdToVote: string) { if (!supabase || !battle) return; const { error } = await supabase.rpc('cast_challenge_vote', { p_challenge_id: battle.id, p_story_id: storyIdToVote }); if (error) setMessage(error.message); else { setBattle((old) => { if (!old || old.mine === storyIdToVote) return old; return { ...old, mine: storyIdToVote, canon_votes: old.canon_votes + (storyIdToVote === old.canon_story_id ? 1 : old.mine === old.canon_story_id ? -1 : 0), challenger_votes: old.challenger_votes + (storyIdToVote === old.challenger_story_id ? 1 : old.mine === old.challenger_story_id ? -1 : 0) } }); setMessage('Canon vote recorded.') } }
  async function post() { if (!supabase) { setMessage('Sign in to leave a comment.'); return }; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setMessage('Sign in to leave a comment.'); return }; const { error } = await supabase.from('comments').insert({ story_id: storyId, author_id: auth.user.id, body }); if (error) setMessage(error.message); else { setBody(''); setMessage('Comment added.'); void refresh() } }
  const secondsRemaining = battle ? Math.max(0, Math.ceil((new Date(battle.closes_at).getTime() - now) / 1000)) : 0
  const countdown = secondsRemaining >= 86400 ? `${Math.floor(secondsRemaining / 86400)}d ${Math.floor((secondsRemaining % 86400) / 3600)}h` : secondsRemaining >= 3600 ? `${Math.floor(secondsRemaining / 3600)}h ${Math.floor((secondsRemaining % 3600) / 60)}m` : `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`
  return <section className="story-discussion">{battle && <div className="canon-ballot"><p className="eyebrow"><span /> Canon battle</p><div className="ballot-heading"><h3>Which version stays?</h3><time className={secondsRemaining === 0 ? 'closing' : ''}>{secondsRemaining > 0 ? `${countdown} left` : 'Decision being recorded'}</time></div><p>Choose the version that should lead into the next film. You can change your vote until the window closes.</p><div><button disabled={secondsRemaining === 0} className={battle.mine === battle.canon_story_id ? 'selected' : ''} onClick={() => void castVote(battle.canon_story_id)}>Keep current canon <b>{battle.canon_votes}</b></button><button disabled={secondsRemaining === 0} className={battle.mine === battle.challenger_story_id ? 'selected' : ''} onClick={() => void castVote(battle.challenger_story_id)}>Back this challenge <b>{battle.challenger_votes}</b></button></div></div>}<button className="text-button" onClick={() => setOpen((value) => !value)}><MessageCircle size={15} /> {open ? 'Hide discussion' : 'Open discussion'}</button>{open && <div className="comment-area">{comments.map((comment) => { const author = comment.author; const authorClass = `rank-${rankFor(author?.ledger_balance ?? 0)}`; return <article key={comment.id}>{author && onOpenAuthor ? <button className={classNames('comment-author', authorClass)} onClick={() => onOpenAuthor(author.id)}><b>{author.display_name}</b><small>@{author.handle}{author.ledger_balance ? ` · ${formatNumber(author.ledger_balance)} sparkle points` : ''} · {relativeDate(comment.created_at)}</small></button> : <span className={authorClass}><b>{author?.display_name ?? 'Archive member'}</b><small>@{author?.handle ?? 'member'}{author?.ledger_balance ? ` · ${formatNumber(author.ledger_balance)} sparkle points` : ''} · {relativeDate(comment.created_at)}</small></span>}<p>{comment.body}</p></article> })}<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add something useful to the record…" maxLength={3000} /><button className="button primary slim" disabled={body.trim().length < 2} onClick={() => void post()}>Post comment</button>{message && <small>{message}</small>}</div>}</section>
}

function RecentStoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span><span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span></div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button title="Support this story" onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button title="Vote against this story" onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div><button className="icon-button" onClick={() => onBookmark(story)} aria-label="Save story"><Bookmark size={17} /></button></footer><StoryDiscussion storyId={story.id} /></article>
}

function PriorStoryCard({ story, featured = false, challenge = false, onReact, onBookmark }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void }) {
  const ledger = story.author.ledger > 0 ? <span><Sparkles size={14} /> {formatNumber(story.author.ledger)} ledger</span> : null
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header><div className="story-byline"><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></div><span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span>{ledger}</div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer><div className="story-votes"><button className={story.viewerReaction === 1 ? 'selected' : ''} title={story.viewerReaction === 1 ? 'Remove your support' : 'Support this story'} onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button className={story.viewerReaction === -1 ? 'selected' : ''} title={story.viewerReaction === -1 ? 'Remove your vote' : 'Vote against this story'} onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div><button className="icon-button" onClick={() => onBookmark(story)} aria-label="Save story"><Bookmark size={17} /></button></footer><StoryDiscussion storyId={story.id} /></article>
}

function StoryCard({ story, featured = false, challenge = false, onReact, onBookmark, onOpenAuthor }: { story: Story; featured?: boolean; challenge?: boolean; onReact: (story: Story, value: 1 | -1) => void; onBookmark: (story: Story) => void; onOpenAuthor?: (id: string) => void }) {
  const byline = <><span className="avatar">{story.author.displayName.slice(0, 1)}</span><span><b>{story.author.displayName}</b><small>@{story.author.handle} · {relativeDate(story.createdAt)}</small></span></>
  return <article className={classNames('story-card', featured && 'featured', challenge && 'challenge')}><header>{story.author.id && onOpenAuthor ? <button className={classNames('story-byline', 'story-author', `rank-${rankFor(story.author.ledger)}`)} onClick={() => onOpenAuthor(story.author.id!)}>{byline}</button> : <div className={classNames('story-byline', `rank-${rankFor(story.author.ledger)}`)}>{byline}</div>}<span className={classNames('status-badge', story.status)}>{story.status === 'canon' ? <><Check size={13} /> Canon</> : <><Gavel size={13} /> Challenger</>}</span></header><div className="story-main"><h2>{story.title}</h2><div className="story-meta"><span><Clock3 size={14} /> {story.readingMinutes} min</span><span>{formatNumber(story.wordCount)} words</span>{story.author.ledger > 0 && <span><Sparkles size={14} /> {formatNumber(story.author.ledger)} sparkle points</span>}</div><p className="story-excerpt">{story.body}</p>{story.continuityNote && <aside className="story-handoff"><b>For the next film</b><p>{story.continuityNote}</p></aside>}</div><footer>{challenge ? <div className="challenge-vote-note"><Gavel size={14} /> Vote in the canon ballot below.</div> : <div className="story-votes"><button className={story.viewerReaction === 1 ? 'selected' : ''} onClick={() => onReact(story, 1)}><ArrowUp size={16} /> {formatNumber(story.metrics.upvotes)}</button><button className={story.viewerReaction === -1 ? 'selected' : ''} onClick={() => onReact(story, -1)}><ArrowDown size={16} /> {formatNumber(story.metrics.downvotes)}</button></div>}<div className="story-card-actions"><ReportStoryButton storyId={story.id} /><button className={classNames('icon-button', story.viewerBookmarked && 'selected')} aria-pressed={story.viewerBookmarked} onClick={() => onBookmark(story)} aria-label={story.viewerBookmarked ? 'Remove saved story' : 'Save story'}><Bookmark size={17} /></button></div></footer><StoryDiscussion storyId={story.id} onOpenAuthor={onOpenAuthor} /></article>
}

function ReportStoryButton({ storyId }: { storyId: string }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [message, setMessage] = useState('')
  async function report() { if (!supabase) { setMessage('Sign in to file a report.'); return }; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { setMessage('Sign in to file a report.'); return }; if (reason.trim().length < 10) { setMessage('Give the moderators a little more detail.'); return }; const { error } = await supabase.from('reports').insert({ reporter_id: auth.user.id, story_id: storyId, reason: reason.trim() }); if (error) { setMessage(error.message); return }; setReason(''); setOpen(false); setMessage('Report sent to the review queue.') }
  return <span className="report-story">{open ? <span className="report-story-form"><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What needs review?" maxLength={1000} /><button className="button ghost slim" onClick={() => void report()}>Send</button></span> : <button className="icon-button quiet-icon" onClick={() => setOpen(true)} aria-label="Report this story" title="Report this story"><Flag size={15} /></button>}{message && <small>{message}</small>}</span>
}

function LegacyWritingStudio({ film, draft, setDraft, previewing, setPreviewing, saving, onSave, onSubmit, onBack, onFormat }: { film: Film; draft: { title: string; body: string; continuityNote: string }; setDraft: React.Dispatch<React.SetStateAction<{ title: string; body: string; continuityNote: string }>>; previewing: boolean; setPreviewing: (value: boolean) => void; saving: boolean; onSave: () => void; onSubmit: () => void; onBack: () => void; onFormat: (before: string, after?: string) => void }) {
  const wordCount = words(draft.body)
  const complete = Math.min(100, Math.round((wordCount / 300) * 100))
  return <section className="studio"><header className="studio-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Movie #{film.number}</button><div className="studio-state">{saving ? <><LoaderCircle className="spin" size={15} /> Saving</> : <><span /> Autosave on</>}</div><div><button className="button slim ghost" onClick={onSave}>Save draft</button><button className="button slim primary" onClick={onSubmit} disabled={wordCount < 300}>Publish story <Send size={15} /></button></div></header><div className="studio-layout"><aside className="studio-context"><p className="eyebrow">Your brief</p><div className="current-film"><span style={{ background: film.era.accent }} /> <small>Movie #{String(film.number).padStart(3, '0')}</small><h2>{film.title}</h2><p>{film.official_description}</p></div><div className="brief-box"><p className="eyebrow">{film.era.name} brief</p><p>{film.era.writing_guidelines}</p></div></aside><div className="editor-area"><div className="editor-top"><div><p className="eyebrow">Start a story</p><input value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="A title for this film" aria-label="Story title" /></div><div className="editor-mode"><button className={!previewing ? 'selected' : ''} onClick={() => setPreviewing(false)}>Write</button><button className={previewing ? 'selected' : ''} onClick={() => setPreviewing(true)}>Preview</button></div></div>{!previewing && <div className="format-bar"><button onClick={() => onFormat('## ')}>H2</button><button onClick={() => onFormat('**', '**')}><b>B</b></button><button onClick={() => onFormat('*', '*')}><i>I</i></button><button onClick={() => onFormat('> ')}>Quote</button><button onClick={() => onFormat('- ')}>List</button><span>Markdown supported</span></div>}{previewing ? <article className="preview-prose"><h1>{draft.title || 'Untitled story'}</h1>{draft.body.split(/\n{2,}/).map((paragraph, index) => paragraph.startsWith('## ') ? <h2 key={index}>{paragraph.slice(3)}</h2> : <p key={index}>{paragraph.replaceAll('**', '').replaceAll('*', '')}</p>)}</article> : <textarea id="story-body" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Start with the accountant, the debt, or the problem this film introduces." spellCheck /> }<label className="continuity-note"><span>Hand-off for the next writer <small>Optional · one sentence</small></span><input value={draft.continuityNote} maxLength={360} onChange={(event) => setDraft((old) => ({ ...old, continuityNote: event.target.value }))} placeholder="What should the next film pick up?" /></label><footer className="editor-footer"><div><b>{formatNumber(wordCount)}</b> words · {readingTime(wordCount)} min read<div className="word-meter"><i style={{ width: `${complete}%` }} /></div><small>{wordCount < 300 ? `${300 - wordCount} words until publication` : 'Ready to publish'}</small></div><p>First stories become canon automatically; later stories open a canon challenge.</p></footer></div></div></section>
}

function WritingStudio({ film, draft, setDraft, previewing, setPreviewing, saving, onSave, onSubmit, onBack, onFormat }: { film: Film; draft: { title: string; body: string; continuityNote: string }; setDraft: React.Dispatch<React.SetStateAction<{ title: string; body: string; continuityNote: string }>>; previewing: boolean; setPreviewing: (value: boolean) => void; saving: boolean; onSave: () => void; onSubmit: () => void; onBack: () => void; onFormat: (before: string, after?: string) => void }) {
  const [previous, setPrevious] = useState<{ number: number; title: string; note: string } | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const count = words(draft.body)
  useEffect(() => { const client = supabase; if (!client || film.number === 1) { setPrevious(null); return }; void client.from('stories').select('film_number,title,continuity_note').eq('film_number', film.number - 1).eq('status', 'canon').maybeSingle().then(({ data }) => setPrevious(data ? { number: data.film_number, title: data.title, note: data.continuity_note ?? '' } : null)) }, [film.number])
  return <section className={classNames('studio', focusMode && 'studio-focus-mode')}><header className="studio-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Movie #{film.number}</button><div className="studio-state">{saving ? <><LoaderCircle className="spin" size={15} /> Saving</> : <><span /> Autosave on</>}</div><div className="studio-actions"><button className="icon-button editor-expand" onClick={() => setFocusMode((value) => !value)} title={focusMode ? 'Restore writing layout' : 'Expand writing area'} aria-label={focusMode ? 'Restore writing layout' : 'Expand writing area'}>{focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button className="button slim ghost" onClick={onSave}>Save draft</button><button className="button slim primary" onClick={onSubmit} disabled={count < 300 || !draft.continuityNote.trim()}>Publish story <Send size={15} /></button></div></header><div className="studio-layout"><aside className="studio-context"><p className="eyebrow">Writing brief</p><div className="current-film"><span style={{ background: film.era.accent }} /><small>Movie #{String(film.number).padStart(3, '0')}</small><h2>{film.title}</h2><p>{film.official_description}</p></div>{previous?.note && <div className="writer-handoff"><p className="eyebrow">From movie #{String(previous.number).padStart(3, '0')}</p><b>{previous.title}</b><p>{previous.note}</p></div>}<div className="brief-box"><p className="eyebrow">{film.era.name} brief</p><p>{film.era.writing_guidelines}</p></div></aside><div className="editor-area"><div className="editor-top"><div><p className="eyebrow">Start a story</p><input value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="A title for this film" aria-label="Story title" /></div><div className="editor-mode"><button className={!previewing ? 'selected' : ''} onClick={() => setPreviewing(false)}>Write</button><button className={previewing ? 'selected' : ''} onClick={() => setPreviewing(true)}>Preview</button></div></div>{!previewing && <div className="format-bar"><button onClick={() => onFormat('## ')}>H2</button><button onClick={() => onFormat('**', '**')}><b>B</b></button><button onClick={() => onFormat('*', '*')}><i>I</i></button><button onClick={() => onFormat('> ')}>Quote</button><button onClick={() => onFormat('- ')}>List</button></div>}{previewing ? <article className="preview-prose"><h1>{draft.title || 'Untitled story'}</h1>{draft.body.split(/\n{2,}/).map((paragraph, index) => paragraph.startsWith('## ') ? <h2 key={index}>{paragraph.slice(3)}</h2> : <p key={index}>{paragraph.replaceAll('**', '').replaceAll('*', '')}</p>)}</article> : <textarea id="story-body" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Start with the accountant, the debt, or the problem this film introduces." spellCheck /> }<label className="continuity-note"><span>Hand-off for the next writer <small>Required · one sentence</small></span><input value={draft.continuityNote} maxLength={360} onChange={(event) => setDraft((old) => ({ ...old, continuityNote: event.target.value }))} placeholder="What should the next film pick up?" /></label><footer className="editor-footer"><div><b>{formatNumber(count)}</b> words · {readingTime(count)} min read<div className="word-meter"><i style={{ width: `${Math.min(100, Math.round((count / 300) * 100))}%` }} /></div><small>{count < 300 ? `${300 - count} words until publication` : !draft.continuityNote.trim() ? 'Add the hand-off note to publish' : 'Ready to publish'}</small></div><p>First stories become canon automatically; later stories open a canon challenge.</p></footer></div></div></section>
}

function WritingDesk({ stories, onOpenDraft, onOpenFilm, onWrite }: { stories: Story[]; onOpenDraft: (story: Story) => void; onOpenFilm: (number: number) => void; onWrite: () => void }) { return <section className="archive section-wrap"><div className="archive-heading"><div><p className="eyebrow"><span /> Your workspace</p><h1>Writing <i>desk.</i></h1><p>Drafts stay here until you publish. Published stories and active challenges are kept together so nothing disappears.</p></div><button className="button primary" onClick={onWrite}><PenLine size={16} /> New story</button></div><div className="desk-list">{stories.length ? stories.map((story) => <article key={story.id} className="desk-card"><span className={classNames('status-badge', story.status)}>{story.status === 'draft' ? 'Draft' : story.status === 'canon' ? 'Canon' : story.status === 'challenger' ? 'Challenge open' : story.status}</span><div><p className="eyebrow">Movie #{story.filmNumber}</p><h2>{story.title}</h2><p>{story.status === 'draft' ? `${formatNumber(story.wordCount)} words · last saved automatically` : `Published · ${formatNumber(story.wordCount)} words`}</p></div><div>{story.status === 'draft' ? <button className="button ghost slim" onClick={() => onOpenDraft(story)}>Continue editing</button> : <button className="button ghost slim" onClick={() => onOpenFilm(story.filmNumber)}>Open film</button>}</div></article>) : <div className="empty-canon"><p className="eyebrow"><span /> Nothing saved yet</p><h2>Your drafts will <i>always live here.</i></h2><button className="button primary" onClick={onWrite}>Write your first one <ArrowRight size={16} /></button></div>}</div></section> }

function SubmissionScreen({ story, onDesk, onFilm }: { story: Story | null; onDesk: () => void; onFilm: () => void }) { const isChallenge = story?.status === 'challenger'; return <section className="submitted-screen section-wrap"><span className="brand-mark">A</span><p className="eyebrow"><span /> Publication recorded</p><h1>{isChallenge ? <>Your challenge is <i>live.</i></> : <>Your story is now <i>canon.</i></>}</h1><p>{isChallenge ? 'Readers can now choose between your version and the current canon.' : 'There was no existing canon, so the archive has published your story immediately. You can still see every revision in your writing desk.'}</p><div><button className="button primary" onClick={onFilm}>Open the film <ArrowRight size={16} /></button><button className="button ghost" onClick={onDesk}>Go to my desk</button></div></section> }

function OriginalAdminRoom({ member, eras, setEras, queue, onModerate, notify }: { member: Member | null; eras: Era[]; setEras: React.Dispatch<React.SetStateAction<Era[]>>; queue: Story[]; onModerate: (story: Story, action: 'approve_canon' | 'archive' | 'reject') => void; notify: (message: string) => void }) {
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

type ArchiveReport = { id: string; story_id: string | null; comment_id: string | null; reporter_id: string; reason: string; status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; created_at: string }

function ReportsPanel({ member, notify }: { member: Member; notify: (message: string) => void }) {
  const [reports, setReports] = useState<ArchiveReport[]>([])
  const [reporters, setReporters] = useState<Map<string, { handle: string; display_name: string }>>(new Map())
  const [stories, setStories] = useState<Map<string, { title: string; film_number: number }>>(new Map())
  const [comments, setComments] = useState<Map<string, { body: string; story_id: string }>>(new Map())
  const [loading, setLoading] = useState(true)
  async function refresh() { if (!supabase) return; setLoading(true); const { data, error } = await supabase.from('reports').select('id,story_id,comment_id,reporter_id,reason,status,created_at').in('status', ['open', 'reviewing']).order('created_at', { ascending: true }); if (error) { notify(error.message); setLoading(false); return }; const rows = (data ?? []) as ArchiveReport[]; const reporterIds = [...new Set(rows.map((row) => row.reporter_id))]; const storyIds = rows.flatMap((row) => row.story_id ? [row.story_id] : []); const commentIds = rows.flatMap((row) => row.comment_id ? [row.comment_id] : []); const [{ data: profileRows }, { data: storyRows }, { data: commentRows }] = await Promise.all([reporterIds.length ? supabase.from('profiles').select('id,handle,display_name').in('id', reporterIds) : Promise.resolve({ data: [] as Array<{ id: string; handle: string; display_name: string }> }), storyIds.length ? supabase.from('stories').select('id,title,film_number').in('id', storyIds) : Promise.resolve({ data: [] as Array<{ id: string; title: string; film_number: number }> }), commentIds.length ? supabase.from('comments').select('id,body,story_id').in('id', commentIds) : Promise.resolve({ data: [] as Array<{ id: string; body: string; story_id: string }> })]); setReports(rows); setReporters(new Map((profileRows ?? []).map((profile) => [profile.id, profile]))); setStories(new Map((storyRows ?? []).map((story) => [story.id, story]))); setComments(new Map((commentRows ?? []).map((comment) => [comment.id, comment]))); setLoading(false) }
  useEffect(() => { void refresh() }, [])
  async function setStatus(report: ArchiveReport, status: 'reviewing' | 'resolved' | 'dismissed') { if (!supabase) return; const { error } = await supabase.from('reports').update({ status, handled_by: member.id, resolution_note: status === 'dismissed' ? 'Reviewed; no action taken.' : 'Reviewed in the control room.' }).eq('id', report.id); if (error) notify(error.message); else { notify(status === 'reviewing' ? 'Report claimed.' : status === 'resolved' ? 'Report resolved.' : 'Report dismissed.'); void refresh() } }
  async function hideContent(report: ArchiveReport) { if (!supabase) return; let error: { message: string } | null = null; if (report.story_id) { const result = await supabase.rpc('moderate_story', { p_story_id: report.story_id, p_action: 'archive', p_note: 'Archived from a report review.' }); error = result.error } else if (report.comment_id) { const result = await supabase.from('comments').update({ is_removed: true }).eq('id', report.comment_id); error = result.error }; if (error) { notify(error.message); return }; await setStatus(report, 'resolved') }
  return <section className="moderation-panel report-panel"><div className="stack-heading"><div><p className="eyebrow"><span /> Reports & review</p><h2>{loading ? 'Loading reports…' : reports.length ? `${reports.length} item${reports.length === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}</h2></div><Flag size={18} /></div>{reports.length ? reports.map((report) => { const reporter = reporters.get(report.reporter_id); const story = report.story_id ? stories.get(report.story_id) : null; const comment = report.comment_id ? comments.get(report.comment_id) : null; return <article className="report-item" key={report.id}><header><span className={classNames('fact-status', report.status)}>{report.status === 'reviewing' ? 'In review' : 'Open report'}</span><small>{reporter ? `${reporter.display_name} · @${reporter.handle}` : 'Archive member'} · {relativeDate(report.created_at)}</small></header><b>{story ? `Movie #${String(story.film_number).padStart(3, '0')} · ${story.title}` : comment ? 'Comment report' : 'Archive content'}</b><p>{report.reason}</p>{comment && <blockquote>{comment.body}</blockquote>}<footer>{report.status === 'open' && <button className="button ghost slim" onClick={() => void setStatus(report, 'reviewing')}>Claim review</button>}<button className="button primary slim" onClick={() => void hideContent(report)}>Hide content</button><button className="button ghost slim" onClick={() => void setStatus(report, 'dismissed')}>Dismiss</button></footer></article> }) : !loading && <p className="quiet-copy">Reports from readers will appear here. You can claim, dismiss, or remove the reported content without taking the rest of the archive offline.</p>}</section>
}

type FanArtStatus = 'pending' | 'approved' | 'rejected'
type FanArt = {
  id: string; author_id: string; image_path: string; caption: string; alt_text: string; film_number: number | null
  safety_status: FanArtStatus; safety_note: string; is_removed: boolean; created_at: string
  imageUrl?: string; reactions: number; comments: number; viewerReacted?: boolean
  author: { id: string; handle: string; displayName: string; ledger: number }
}
type FanArtComment = { id: string; author_id: string; body: string; created_at: string; author: { handle: string; displayName: string; ledger: number } }

function FanArtPage({ member, onSignIn, onOpenFilm, onOpenAuthor, notify }: { member: Member | null; onSignIn: () => void; onOpenFilm: (number: number) => void; onOpenAuthor: (id: string) => void; notify: (message: string) => void }) {
  const [artwork, setArtwork] = useState<FanArt[]>([])
  const [myArtwork, setMyArtwork] = useState<FanArt[]>([])
  const [selected, setSelected] = useState<FanArt | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [loading, setLoading] = useState(true)

  async function enrich(rows: Array<any>, viewerId?: string) {
    if (!supabase || !rows.length) return [] as FanArt[]
    const client = supabase
    const ids = rows.map((row) => row.id)
    const authorIds = [...new Set(rows.map((row) => row.author_id))]
    const [urls, reactionRows, commentRows, viewerRows, profileRows] = await Promise.all([
      Promise.all(rows.map(async (row) => (await client.storage.from('fan-art').createSignedUrl(row.image_path, 3600)).data?.signedUrl ?? '')),
      client.from('fan_art_reactions').select('art_id').in('art_id', ids),
      client.from('fan_art_comments').select('art_id').eq('is_removed', false).in('art_id', ids),
      viewerId ? client.from('fan_art_reactions').select('art_id').eq('user_id', viewerId).in('art_id', ids) : Promise.resolve({ data: [] as Array<{ art_id: string }> }),
      client.from('profiles').select('id,handle,display_name,ledger_balance').in('id', authorIds)
    ])
    const reactionCounts = new Map<string, number>(); for (const row of reactionRows.data ?? []) reactionCounts.set(row.art_id, (reactionCounts.get(row.art_id) ?? 0) + 1)
    const commentCounts = new Map<string, number>(); for (const row of commentRows.data ?? []) commentCounts.set(row.art_id, (commentCounts.get(row.art_id) ?? 0) + 1)
    const reacted = new Set((viewerRows.data ?? []).map((row) => row.art_id))
    const profiles = new Map((profileRows.data ?? []).map((row) => [row.id, row]))
    return rows.map((row, index) => ({
      ...row, imageUrl: urls[index], reactions: reactionCounts.get(row.id) ?? 0, comments: commentCounts.get(row.id) ?? 0, viewerReacted: reacted.has(row.id),
      author: { id: row.author_id, handle: profiles.get(row.author_id)?.handle ?? 'archive-writer', displayName: profiles.get(row.author_id)?.display_name ?? 'Archive writer', ledger: profiles.get(row.author_id)?.ledger_balance ?? 0 }
    })) as FanArt[]
  }

  async function refresh() {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const [galleryResult, mineResult] = await Promise.all([
      supabase.from('fan_art').select('id,author_id,image_path,caption,alt_text,film_number,safety_status,safety_note,is_removed,created_at').eq('safety_status', 'approved').eq('is_removed', false).order('created_at', { ascending: false }),
      Promise.resolve({ data: [] as Array<any> })
    ])
    if (galleryResult.error) notify(galleryResult.error.message)
    const [gallery, mine] = await Promise.all([enrich(galleryResult.data ?? [], member?.id), enrich(mineResult.data ?? [], member?.id)])
    setArtwork(gallery); setMyArtwork(mine); setLoading(false)
  }

  useEffect(() => { void refresh() }, [member?.id])

  async function react(art: FanArt) {
    if (!member || !supabase) { onSignIn(); return }
    const result = art.viewerReacted
      ? await supabase.from('fan_art_reactions').delete().eq('art_id', art.id).eq('user_id', member.id)
      : await supabase.from('fan_art_reactions').insert({ art_id: art.id, user_id: member.id })
    if (result.error) { notify(result.error.message); return }
    const update = (rows: FanArt[]) => rows.map((row) => row.id === art.id ? { ...row, viewerReacted: !art.viewerReacted, reactions: Math.max(0, row.reactions + (art.viewerReacted ? -1 : 1)) } : row)
    setArtwork(update); if (selected?.id === art.id) setSelected((current) => current ? { ...current, viewerReacted: !art.viewerReacted, reactions: Math.max(0, current.reactions + (art.viewerReacted ? -1 : 1)) } : current)
  }

  return <section className="fanart-page"><header className="fanart-masthead"><div><p className="eyebrow"><span /> Community gallery</p><h1>What the archive<br /><i>looks like.</i></h1><p>Posters, receipts, close-ups, strange prop work — visual evidence from the 800-film record.</p></div><div className="fanart-masthead-actions"><button className="button primary" onClick={() => member ? setShowUpload(true) : onSignIn()}><ImagePlus size={17} /> Add fan art</button><small>New work appears immediately. Readers can still report anything that does not belong.</small></div></header><div className="fanart-intro"><span><Heart size={16} /> A small, made-by-hand collection</span><p>Link an image to a film when it belongs to one. The rest can sit in the margins.</p></div>{loading ? <div className="loading-card"><LoaderCircle className="spin" /> Loading the gallery…</div> : artwork.length ? <div className="fanart-grid">{artwork.map((art) => <article className="fanart-card" key={art.id}><button className="fanart-image" onClick={() => setSelected(art)} aria-label={`Open ${art.caption}`}><img src={art.imageUrl} alt={art.alt_text} /></button><div className="fanart-card-copy"><div className="fanart-card-meta"><button onClick={() => onOpenAuthor(art.author.id)}>@{art.author.handle}</button><span><Sparkles size={11} /> {formatNumber(art.author.ledger)}</span></div><h2>{art.caption}</h2>{art.film_number && <button className="fanart-film-link" onClick={() => onOpenFilm(art.film_number!)}>Film #{String(art.film_number).padStart(3, '0')} <ArrowRight size={13} /></button>}<footer><button className={classNames('fanart-react', art.viewerReacted && 'selected')} onClick={() => void react(art)} aria-label={art.viewerReacted ? 'Remove reaction' : 'React to artwork'}><Heart size={15} fill={art.viewerReacted ? 'currentColor' : 'none'} /> {art.reactions}</button><button onClick={() => setSelected(art)}><MessageCircle size={15} /> {art.comments}</button></footer></div></article>)}</div> : <div className="fanart-empty"><ImagePlus size={32} /><h2>The gallery is waiting for its first piece.</h2><p>It can be a poster, a strange receipt, a sketch from the Grothkin years — anything that feels at home in the archive.</p>{member && <button className="button primary" onClick={() => setShowUpload(true)}>Add the first image</button>}</div>}{showUpload && <FanArtUpload member={member!} close={() => setShowUpload(false)} onComplete={() => { setShowUpload(false); void refresh() }} notify={notify} />}{selected && <FanArtDetail art={selected} member={member} close={() => setSelected(null)} onReact={() => void react(selected)} onOpenFilm={onOpenFilm} onOpenAuthor={onOpenAuthor} onSignIn={onSignIn} notify={notify} onCommented={() => void refresh()} />}</section>
}

function FanArtUpload({ member, close, onComplete, notify }: { member: Member; close: () => void; onComplete: () => void; notify: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [caption, setCaption] = useState(''); const [alt, setAlt] = useState(''); const [film, setFilm] = useState(''); const [saving, setSaving] = useState(false)
  async function submit() {
    if (!supabase || !file) { notify('Choose an image first.'); return }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']; if (!allowed.includes(file.type)) { notify('Use a JPEG, PNG, WebP, or GIF.'); return }
    if (file.size > 8 * 1024 * 1024) { notify('Images need to be 8 MB or smaller.'); return }
    if (caption.trim().length < 3 || alt.trim().length < 3) { notify('Add a short caption and an alt-text description.'); return }
    const filmNumber = film ? Number(film) : null; if (film && (!Number.isInteger(filmNumber) || filmNumber! < 1 || filmNumber! > 800)) { notify('Film links run from 1 to 800.'); return }
    setSaving(true); const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-90); const key = `${member.id}/${crypto.randomUUID()}-${safeName}`
    const upload = await supabase.storage.from('fan-art').upload(key, file, { contentType: file.type, upsert: false })
    if (upload.error) { setSaving(false); notify(upload.error.message); return }
    const insert = await supabase.from('fan_art').insert({ author_id: member.id, image_path: key, caption: caption.trim(), alt_text: alt.trim(), film_number: filmNumber }).select('id').single()
    if (insert.error) { await supabase.storage.from('fan-art').remove([key]); setSaving(false); notify(insert.error.message); return }
    setSaving(false); notify('Added to the gallery.'); onComplete()
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="fanart-upload" role="dialog" aria-modal="true" aria-label="Add fan art" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><p className="eyebrow"><span /> Gallery contribution</p><h2>Put something<br /><i>on the wall.</i></h2><p className="quiet-copy">Keep it yours, keep it safe for the group, and give it enough context for people using a screen reader.</p><label className="fanart-file"><ImagePlus size={22} /><b>{file ? file.name : 'Choose an image'}</b><small>JPEG, PNG, WebP or GIF · up to 8 MB</small><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label>Caption<input value={caption} maxLength={500} placeholder="A title or useful caption" onChange={(event) => setCaption(event.target.value)} /></label><label>Describe the image<input value={alt} maxLength={280} placeholder="What should a reader who cannot see it know?" onChange={(event) => setAlt(event.target.value)} /></label><label>Optional film link<input type="number" min="1" max="800" value={film} placeholder="e.g. 220" onChange={(event) => setFilm(event.target.value)} /></label><button className="button primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Adding…' : 'Add to gallery'} <ArrowRight size={16} /></button></section></div>
}

function FanArtDetail({ art, member, close, onReact, onOpenFilm, onOpenAuthor, onSignIn, notify, onCommented }: { art: FanArt; member: Member | null; close: () => void; onReact: () => void; onOpenFilm: (number: number) => void; onOpenAuthor: (id: string) => void; onSignIn: () => void; notify: (message: string) => void; onCommented: () => void }) {
  const [comments, setComments] = useState<FanArtComment[]>([]); const [body, setBody] = useState(''); const [reporting, setReporting] = useState(false); const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false)
  async function refreshComments() { if (!supabase) return; const { data } = await supabase.from('fan_art_comments').select('id,author_id,body,created_at').eq('art_id', art.id).eq('is_removed', false).order('created_at'); const ids = [...new Set((data ?? []).map((row) => row.author_id))]; const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,handle,display_name,ledger_balance').in('id', ids) : { data: [] as Array<any> }; const profileById = new Map((profiles ?? []).map((row) => [row.id, row])); setComments((data ?? []).map((row) => ({ ...row, author: { handle: profileById.get(row.author_id)?.handle ?? 'archive-writer', displayName: profileById.get(row.author_id)?.display_name ?? 'Archive writer', ledger: profileById.get(row.author_id)?.ledger_balance ?? 0 } }))) }
  useEffect(() => { void refreshComments() }, [art.id])
  async function comment() { if (!member || !supabase) { onSignIn(); return }; if (body.trim().length < 2) { notify('Write a little more before posting.'); return }; setSaving(true); const { error } = await supabase.from('fan_art_comments').insert({ art_id: art.id, author_id: member.id, body: body.trim() }); setSaving(false); if (error) { notify(error.message); return }; setBody(''); void refreshComments(); onCommented() }
  async function report() { if (!member || !supabase) { onSignIn(); return }; if (reason.trim().length < 10) { notify('Please give the review team a little context.'); return }; const { error } = await supabase.from('fan_art_reports').insert({ art_id: art.id, reporter_id: member.id, reason: reason.trim() }); if (error) { notify(error.code === '23505' ? 'You have already flagged this image.' : error.message); return }; setReporting(false); setReason(''); notify('Sent to the review queue.') }
  return <div className="modal-backdrop fanart-backdrop" role="presentation" onMouseDown={close}><section className="fanart-detail" role="dialog" aria-modal="true" aria-label={art.caption} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><div className="fanart-detail-image"><img src={art.imageUrl} alt={art.alt_text} /></div><div className="fanart-detail-copy"><div className="fanart-card-meta"><button onClick={() => onOpenAuthor(art.author.id)}>{art.author.displayName} · @{art.author.handle}</button><span><Sparkles size={11} /> {formatNumber(art.author.ledger)}</span></div><h2>{art.caption}</h2>{art.film_number && <button className="fanart-film-link" onClick={() => { close(); onOpenFilm(art.film_number!) }}>Film #{String(art.film_number).padStart(3, '0')} <ArrowRight size={13} /></button>}<div className="fanart-detail-actions"><button className={classNames('fanart-react', art.viewerReacted && 'selected')} onClick={onReact}><Heart size={16} fill={art.viewerReacted ? 'currentColor' : 'none'} /> {art.reactions}</button><button className="text-button" onClick={() => setReporting((value) => !value)}><Flag size={15} /> Report</button></div>{reporting && <div className="fanart-report"><textarea value={reason} maxLength={1000} placeholder="Tell the review team what is wrong." onChange={(event) => setReason(event.target.value)} /><button className="button ghost slim" onClick={() => void report()}>Send report</button></div>}<section className="fanart-comments"><p className="eyebrow"><span /> Discussion</p>{comments.length ? comments.map((comment) => <article key={comment.id}><button onClick={() => onOpenAuthor(comment.author_id)}>{comment.author.displayName} <small>@{comment.author.handle} · <Sparkles size={10} /> {formatNumber(comment.author.ledger)}</small></button><p>{comment.body}</p></article>) : <p className="quiet-copy">No notes in the margin yet.</p>}<div className="fanart-comment-form"><textarea value={body} maxLength={3000} placeholder={member ? 'Leave a note…' : 'Sign in to discuss this piece.'} disabled={!member} onChange={(event) => setBody(event.target.value)} /><button className="button primary slim" disabled={saving} onClick={() => void comment()}>{saving ? 'Posting…' : <Send size={15} />}</button></div></section></div></section></div>
}

function FanArtReviewPanel({ member, notify }: { member: Member; notify: (message: string) => void }) {
  const [items, setItems] = useState<FanArt[]>([]); const [reports, setReports] = useState<Map<string, number>>(new Map()); const [loading, setLoading] = useState(true)
  async function refresh() { if (!supabase) return; const client = supabase; setLoading(true); const [artResult, reportResult] = await Promise.all([client.from('fan_art').select('id,author_id,image_path,caption,alt_text,film_number,safety_status,safety_note,is_removed,created_at').eq('safety_status', 'approved').eq('is_removed', false).order('created_at'), client.from('fan_art_reports').select('art_id').in('status', ['open', 'reviewing'])]); const rows = artResult.data ?? []; const urls = await Promise.all(rows.map(async (row) => (await client.storage.from('fan-art').createSignedUrl(row.image_path, 3600)).data?.signedUrl ?? '')); const profileIds = [...new Set(rows.map((row) => row.author_id))]; const { data: profileRows } = profileIds.length ? await client.from('profiles').select('id,handle,display_name,ledger_balance').in('id', profileIds) : { data: [] as Array<any> }; const profiles = new Map((profileRows ?? []).map((row) => [row.id, row])); setItems(rows.map((row, index) => ({ ...row, imageUrl: urls[index], reactions: 0, comments: 0, author: { id: row.author_id, handle: profiles.get(row.author_id)?.handle ?? 'archive-writer', displayName: profiles.get(row.author_id)?.display_name ?? 'Archive writer', ledger: profiles.get(row.author_id)?.ledger_balance ?? 0 } }))); const counts = new Map<string, number>(); for (const report of reportResult.data ?? []) counts.set(report.art_id, (counts.get(report.art_id) ?? 0) + 1); setReports(counts); setLoading(false) }
  useEffect(() => { void refresh() }, [])
  async function decide(art: FanArt) { if (!supabase) return; const { error } = await supabase.from('fan_art').update({ is_removed: true, reviewed_by: member.id, reviewed_at: new Date().toISOString(), safety_note: 'Removed following a community report.' }).eq('id', art.id); if (error) { notify(error.message); return }; await supabase.from('fan_art_reports').update({ status: 'resolved', handled_by: member.id, resolution_note: 'Removed following a community report.' }).eq('art_id', art.id).in('status', ['open', 'reviewing']); notify('Artwork removed from the gallery.'); void refresh() }
  const reported = items.filter((art) => reports.has(art.id))
  return <section className="moderation-panel fanart-review"><div className="stack-heading"><div><p className="eyebrow"><span /> Gallery reports</p><h2>{loading ? 'Loading reports…' : reported.length ? `${reported.length} reported image${reported.length === 1 ? '' : 's'} need attention` : 'No gallery reports need attention'}</h2></div><Flag size={18} /></div>{!loading && (reported.length ? <div className="fanart-reports">{reported.map((art) => <article key={art.id}><img src={art.imageUrl} alt="" /><div><b>{art.caption}</b><p>{reports.get(art.id)} open report{reports.get(art.id) === 1 ? '' : 's'} · @{art.author.handle}</p><div className="queue-actions"><button onClick={() => void decide(art)}>Remove from gallery</button></div></div></article>)}</div> : <p className="quiet-copy">Every image appears immediately. This is only for artwork that readers have reported.</p>)}</section>
}

function LegacyAdminRoom({ member, eras, setEras, queue, onModerate, notify }: { member: Member | null; eras: Era[]; setEras: React.Dispatch<React.SetStateAction<Era[]>>; queue: Story[]; onModerate: (story: Story, action: 'approve_canon' | 'archive' | 'reject') => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'eras' | 'reports' | 'members' | 'settings'>('eras')
  const [selected, setSelected] = useState(eras[0]?.slug ?? '')
  const [editing, setEditing] = useState(eras[0])
  if (!member || (member.role !== 'admin' && member.role !== 'moderator')) return <section className="restricted section-wrap"><ShieldCheck size={34} /><h1>Moderator access required.</h1></section>
  const isAdmin = member.role === 'admin'
  const tabs: Array<[typeof tab, string]> = isAdmin ? [['eras', 'Era map'], ['reports', 'Reports'], ['members', 'Members'], ['settings', 'Settings']] : [['reports', 'Reports']]
  async function saveEra() { if (!editing) return; if (!supabase || !editing.id) { setEras((all) => all.map((era) => era.slug === editing.slug ? editing : era)); notify('Era saved locally.'); return }; const { error } = await supabase.from('eras').update({ name: editing.name, description: editing.description, writing_guidelines: editing.writing_guidelines, accent: editing.accent, start_movie: editing.start_movie, end_movie: editing.end_movie }).eq('id', editing.id); if (error) notify(error.message); else { setEras((all) => all.map((era) => era.id === editing.id ? editing : era)); notify('Era saved.') } }
  return <section className="admin-room section-wrap"><div className="admin-heading"><div><p className="eyebrow"><span /> Administrator</p><h1>Control room.</h1><p>Automatic canon keeps the archive moving. This is where you set its guardrails.</p></div><span className="admin-seal"><ShieldCheck /> Verified administrator</span></div><div className="admin-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === 'eras' && <div className="admin-grid"><aside className="era-list">{eras.map((era) => <button key={era.slug} className={selected === era.slug ? 'selected' : ''} onClick={() => { setSelected(era.slug); setEditing(era) }}><i style={{ background: era.accent }} /><span><b>{era.name}</b><small>#{era.start_movie}–#{era.end_movie}</small></span><ChevronRight size={15} /></button>)}</aside>{editing && <div className="era-editor"><div className="editor-heading"><div><p className="eyebrow">Edit era</p><h2>{editing.name}</h2></div><button className="button primary slim" onClick={() => void saveEra()}>Save changes</button></div><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Description<textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label>Writer’s brief<textarea value={editing.writing_guidelines} onChange={(event) => setEditing({ ...editing, writing_guidelines: event.target.value })} /></label><div className="admin-fields"><label>Starts at<input type="number" min="1" max="800" value={editing.start_movie} onChange={(event) => setEditing({ ...editing, start_movie: Number(event.target.value) })} /></label><label>Ends at<input type="number" min="1" max="800" value={editing.end_movie} onChange={(event) => setEditing({ ...editing, end_movie: Number(event.target.value) })} /></label><label>Accent<input type="color" value={editing.accent} onChange={(event) => setEditing({ ...editing, accent: event.target.value })} /></label></div></div>}</div>}{tab === 'reports' && <section className="moderation-panel"><div className="stack-heading"><div><p className="eyebrow"><span /> Reports & review</p><h2>{queue.length ? `${queue.length} item${queue.length === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}</h2></div><Flag size={18} /></div>{queue.length ? queue.map((story) => <article className="queue-item" key={story.id}><div><b>{story.title}</b><p>Movie #{story.filmNumber} · @{story.author.handle}</p></div><div className="queue-actions"><button onClick={() => onModerate(story, 'archive')}>Archive</button><button className="approve" onClick={() => onModerate(story, 'approve_canon')}>Set canon</button></div></article>) : <p className="quiet-copy">Stories become canon or challenges automatically. Reports will appear here when someone flags one.</p>}</section>}{tab === 'members' && <section className="moderation-panel"><p className="eyebrow"><span /> Community</p><h2>Small group, clear roles.</h2><p className="quiet-copy">Everyone can read. Signed-in members can write, vote, comment, and earn ledger. Moderators can handle reports; administrators manage the overall record.</p><button className="button ghost slim" onClick={() => notify('Member controls are tied to each account’s archive role.')}>Role guide</button></section>}{tab === 'settings' && <section className="moderation-panel"><p className="eyebrow"><span /> Archive rules</p><h2>Publishing is automatic.</h2><p className="quiet-copy">The first submission for a film becomes canon. Later submissions start a challenge. Each writer keeps one active draft per film, and all voting earns ledger points.</p><button className="button ghost slim" onClick={() => notify('These community rules are active.')}>Check archive rules</button></section>}</section>
}

function AdminRoom({ member, eras, setEras, notify }: { member: Member | null; eras: Era[]; setEras: React.Dispatch<React.SetStateAction<Era[]>>; queue: Story[]; onModerate: (story: Story, action: 'approve_canon' | 'archive' | 'reject') => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'eras' | 'reports' | 'fanart' | 'members' | 'settings'>('reports')
  const [selected, setSelected] = useState(eras[0]?.slug ?? '')
  const active = eras.find((era) => era.slug === selected) ?? eras[0]
  const [editing, setEditing] = useState(active)
  const isAdmin = member?.role === 'admin'
  const canModerate = isAdmin || member?.role === 'moderator'
  const tabs: Array<[typeof tab, string]> = isAdmin ? [['eras', 'Era map'], ['reports', 'Reports'], ['fanart', 'Fan art'], ['members', 'Members'], ['settings', 'Settings']] : [['reports', 'Reports'], ['fanart', 'Fan art']]
  useEffect(() => setEditing(active), [active?.id])
  if (!member || !canModerate) return <section className="restricted section-wrap"><ShieldCheck size={34} /><h1>Moderator access required.</h1><p>This area is for people trusted to keep the record healthy.</p></section>
  async function saveEra() { if (!editing || !supabase) return; const { error } = await supabase.from('eras').update({ name: editing.name, description: editing.description, writing_guidelines: editing.writing_guidelines, accent: editing.accent, start_movie: editing.start_movie, end_movie: editing.end_movie }).eq('id', editing.id); if (error) notify(error.message); else { setEras((all) => all.map((era) => era.id === editing.id ? editing : era)); notify('Era saved.') } }
  return <section className="admin-room section-wrap"><div className="admin-heading"><div><p className="eyebrow"><span /> {isAdmin ? 'Administrator' : 'Moderator'}</p><h1>Control room.</h1><p>{isAdmin ? 'Set the archive’s structure and keep the community moving.' : 'Review reports and keep the shared record in good shape.'}</p></div><span className="admin-seal"><ShieldCheck /> Verified {isAdmin ? 'administrator' : 'moderator'}</span></div><div className="admin-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === 'reports' && <ReportsPanel member={member} notify={notify} />}{tab === 'fanart' && <FanArtReviewPanel member={member} notify={notify} />}{isAdmin && tab === 'eras' && <div className="admin-grid"><aside className="era-list">{eras.map((era) => <button key={era.slug} className={selected === era.slug ? 'selected' : ''} onClick={() => { setSelected(era.slug); setEditing(era) }}><i style={{ background: era.accent }} /><span><b>{era.name}</b><small>#{era.start_movie}–#{era.end_movie}</small></span><ChevronRight size={15} /></button>)}</aside>{editing && <div className="era-editor"><div className="editor-heading"><div><p className="eyebrow">Edit era</p><h2>{editing.name}</h2></div><button className="button primary slim" onClick={() => void saveEra()}>Save changes</button></div><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Description<textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label>Writer’s brief<textarea value={editing.writing_guidelines} onChange={(event) => setEditing({ ...editing, writing_guidelines: event.target.value })} /></label><div className="admin-fields"><label>Starts at<input type="number" min="1" max="800" value={editing.start_movie} onChange={(event) => setEditing({ ...editing, start_movie: Number(event.target.value) })} /></label><label>Ends at<input type="number" min="1" max="800" value={editing.end_movie} onChange={(event) => setEditing({ ...editing, end_movie: Number(event.target.value) })} /></label><label>Accent<input type="color" value={editing.accent} onChange={(event) => setEditing({ ...editing, accent: event.target.value })} /></label></div><p className="admin-note"><Settings2 size={15} /> The range and writer brief update the archive’s actual source data.</p></div>}</div>}{isAdmin && tab === 'members' && <section className="moderation-panel"><p className="eyebrow"><span /> Community roles</p><h2>Small group, clear responsibilities.</h2><p className="quiet-copy">Writers can publish, discuss, cite sources, and report problems. Moderators can review reports. Administrators can also shape eras and archive rules.</p></section>}{isAdmin && tab === 'settings' && <section className="moderation-panel"><p className="eyebrow"><span /> Archive rules</p><h2>Publishing stays automatic.</h2><p className="quiet-copy">The first eligible story becomes canon. Later stories open a challenge, while the Control Room steps in only for safety, structure, and genuinely contested records.</p></section>}</section>
}

function SignInSheet({ close, login }: { close: () => void; login: () => void }) { return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="sign-in-sheet" role="dialog" aria-modal="true" aria-label="Sign in" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><span className="brand-mark">A</span><p className="eyebrow"><span /> Reader account</p><h2>Join the<br /><i>archive.</i></h2><p>Sign in to write stories, vote on challenges, and keep track of the films you care about.</p><button className="google-button" onClick={login}><b>G</b> Continue with Google</button>{!isSupabaseConfigured && <p className="config-note"><LockKeyhole size={14} /> Add the Supabase URL and publishable key from <code>.env.example</code> to enable Google sign-in.</p>}<small>You can read everything without an account. Sign in when you want to contribute.</small></section></div> }

function ProfileSheet({ member, close, logout, onSaved }: { member: Member; close: () => void; logout: () => void; onSaved: (displayName: string) => void }) {
  const [editing, setEditing] = useState(false); const [displayName, setDisplayName] = useState(member.displayName); const [bio, setBio] = useState(''); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('')
  useEffect(() => { if (!supabase) return; void supabase.from('profiles').select('bio').eq('id', member.id).maybeSingle().then(({ data }) => setBio(data?.bio ?? '')) }, [member.id])
  async function save() { if (!supabase || displayName.trim().length < 1) { setMessage('Add a display name first.'); return }; setSaving(true); const { error } = await supabase.from('profiles').update({ display_name: displayName.trim(), bio: bio.trim() }).eq('id', member.id); setSaving(false); if (error) { setMessage(error.message); return }; onSaved(displayName.trim()); setEditing(false); setMessage('Profile saved.') }
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className={classNames('profile-sheet', `rank-${rankFor(member.ledger)}`)} role="dialog" aria-modal="true" aria-label="Your profile" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button><div className="profile-heading"><span className={classNames('profile-avatar', `rank-${rankFor(member.ledger)}`)}>{displayName.slice(0, 1)}</span><div><p className="eyebrow"><span /> Your account</p><h2>{displayName}</h2><p>@{member.handle}</p></div></div><div className="profile-stats"><div><small>Sparkle points</small><b><Sparkles size={15} /> {formatNumber(member.ledger)}</b></div><div><small>Archive role</small><b>{member.role === 'admin' ? 'Administrator' : member.role === 'moderator' ? 'Moderator' : 'Writer'}</b></div></div>{editing ? <div className="profile-editor"><label>Display name<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></label><label>About you<textarea value={bio} maxLength={500} onChange={(event) => setBio(event.target.value)} placeholder="A sentence or two about the kind of record you keep…" /></label><div><button className="button primary slim" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save profile'}</button><button className="button ghost slim" onClick={() => setEditing(false)}>Cancel</button></div></div> : <><p className={classNames('profile-bio', `rank-${rankFor(member.ledger)}`)}>{bio || 'No note in the margin yet.'}</p><button className="text-button profile-edit" onClick={() => setEditing(true)}><FilePenLine size={15} /> Edit profile</button></>}<p className="profile-note">Your account keeps your drafts, votes, and stories tied to the archive. Signing out only affects this device.</p>{message && <small className="profile-message">{message}</small>}<button className="profile-logout" onClick={() => { close(); void logout() }}>Sign out <ArrowRight size={16} /></button></section></div>
}

function ContributorProfileSheet({ profileId, close, onOpenFilm }: { profileId: string; close: () => void; onOpenFilm: (film: number) => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null); const [stories, setStories] = useState<Array<Pick<Story, 'id' | 'title' | 'filmNumber' | 'status' | 'wordCount' | 'createdAt'>>>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { const client = supabase; if (!client) { setLoading(false); return }; setLoading(true); void Promise.all([client.from('profiles').select('id,handle,display_name,bio,ledger_balance,avatar_url,created_at').eq('id', profileId).maybeSingle(), client.from('stories').select('id,title,film_number,status,word_count,created_at').eq('author_id', profileId).in('status', ['canon', 'challenger', 'archived']).order('updated_at', { ascending: false }).limit(50)]).then(([profileResult, storyResult]) => { const raw = profileResult.data; setProfile(raw ? { id: raw.id, handle: raw.handle, displayName: raw.display_name, bio: raw.bio ?? '', ledger: raw.ledger_balance, avatarUrl: raw.avatar_url, createdAt: raw.created_at } : null); setStories((storyResult.data ?? []).map((story) => ({ id: story.id, title: story.title, filmNumber: story.film_number, status: story.status as Story['status'], wordCount: story.word_count, createdAt: story.created_at }))); setLoading(false) }) }, [profileId])
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className={classNames('profile-sheet', 'contributor-sheet', profile && `rank-${rankFor(profile.ledger)}`)} role="dialog" aria-modal="true" aria-label="Contributor profile" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}><X size={18} /></button>{loading ? <div className="loading-card"><LoaderCircle className="spin" /> Loading contributor…</div> : profile ? <><div className="profile-heading"><span className={classNames('profile-avatar', `rank-${rankFor(profile.ledger)}`)}>{profile.displayName.slice(0, 1)}</span><div><p className="eyebrow"><span /> Contributor</p><h2>{profile.displayName}</h2><p>@{profile.handle}</p></div></div><div className="profile-stats"><div><small>Sparkle points</small><b><Sparkles size={15} /> {formatNumber(profile.ledger)}</b></div><div><small>Published work</small><b><BookOpen size={15} /> {stories.length}</b></div></div><p className={classNames('profile-bio', `rank-${rankFor(profile.ledger)}`)}>{profile.bio || 'No note in the margin yet.'}</p><section className="contributor-stories"><p className="eyebrow"><span /> Their record</p>{stories.length ? stories.map((story) => <button key={story.id} onClick={() => { close(); onOpenFilm(story.filmNumber) }}><span className={classNames('status-badge', story.status === 'canon' ? 'canon' : 'challenger')}>{story.status === 'canon' ? 'Canon' : story.status === 'challenger' ? 'Challenge' : 'Archived'}</span><div><small>Movie #{String(story.filmNumber).padStart(3, '0')}</small><b>{story.title}</b></div><ChevronRight size={16} /></button>) : <p className="quiet-copy">No published stories in the record yet.</p>}</section></> : <div className="empty-canon"><h2>This contributor is no longer in the record.</h2></div>}</section></div>
}
