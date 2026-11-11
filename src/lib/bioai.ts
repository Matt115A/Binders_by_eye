/**
 * BioAI by eye — anonymous contributions (shared by every game; keep the copies identical).
 * Uploads only datapoints: game, version, item ids, answers, part of the session, response times. No identifiers.
 * The withdrawal token stays in this browser; the database stores only its SHA-256.
 *
 * **One contribution per game + dataset version, cumulative.** Every session this browser plays is remembered
 * (`bioai.sessions`) and appended in the order it was played, so contributing again does not add a second datapoint:
 * it replaces the row already in the database. The database only grants insert and `withdraw(token)`, so a replace is
 * "insert the merged row, then withdraw the token it supersedes" — in that order, so a failure in between leaves the
 * data present (briefly twice) rather than absent. Rows left behind that way stay marked live and are retried by
 * `flushSuperseded()`; the hub also treats a contribution that is a prefix of another as the same person.
 */
export const BIOAI_HUB = 'https://matt115a.github.io/BioAI_by_eye/';
/** Supabase project URL and its public "anon" key (safe to ship: row-level security allows insert + withdraw only). Empty = off. */
export const BIOAI_SUPABASE_URL: string = import.meta.env.VITE_BIOAI_URL ?? '';
export const BIOAI_SUPABASE_KEY: string = import.meta.env.VITE_BIOAI_KEY ?? '';
export const BIOAI_READY = !!(BIOAI_SUPABASE_URL && BIOAI_SUPABASE_KEY);
/** answers a datapoint needs, and the most it can hold (the database enforces the same bounds) */
export const MIN_ANSWERS = 20;
export const MAX_ANSWERS = 1000;

export interface Contribution { game: 'nanopore' | 'mutations' | 'seq' | 'struct' | 'binders'; app_version: string; dataset_version: string; n: number; items: number[]; responses: string; phases: string; rt: number[] }

/** Encode one session's trials; null if it holds no answers. `n` may be below MIN_ANSWERS: sessions accumulate. */
export function buildContribution(game: Contribution['game'], appVersion: string, datasetVersion: string, phases: string[],
  trials: { item: number; response: string; phase: string; rt: number }[]): Contribution | null {
  const ts = trials.filter((t) => typeof t.response === 'string' && /^[A-Z0-9]$/.test(t.response)).slice(0, MAX_ANSWERS);
  if (!ts.length) return null;
  return {
    game, app_version: appVersion.slice(0, 20), dataset_version: datasetVersion.slice(0, 40), n: ts.length,
    items: ts.map((t) => t.item), responses: ts.map((t) => t.response).join(''),
    phases: ts.map((t) => { const k = phases.indexOf(t.phase); return String(k < 0 ? 9 : k); }).join(''),
    rt: ts.map((t) => Math.max(0, Math.min(600000, Math.round(t.rt / 10) * 10))),
  };
}

const read = <T,>(k: string, empty: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? empty; } catch { return empty; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

/* ── every real session this browser has played, so a contribution can be cumulative ── */
const SESSIONS = 'bioai.sessions';
/** the pre-cumulative key, which held only sessions too short to contribute on their own */
const OLD_SESSIONS = 'bioai.pending';
const MAX_LOGGED = 400;
type Logged = Record<string, { at: number; c: Contribution }>;

function loadLogged(): Logged {
  const cur = read<Logged>(SESSIONS, {});
  const old = read<Logged>(OLD_SESSIONS, {});
  if (!Object.keys(old).length) return cur;
  const merged = { ...old, ...cur };                       // anything already under the new key wins
  write(SESSIONS, merged);
  write(OLD_SESSIONS, {});
  return merged;
}
function saveLogged(l: Logged) {
  const ids = Object.keys(l).sort((a, b) => l[b].at - l[a].at).slice(0, MAX_LOGGED);
  write(SESSIONS, Object.fromEntries(ids.map((i) => [i, l[i]])));
}

/** Forget sessions the player deleted: by id, or every one from the given games. */
export function forgetSessions(opts: { ids?: string[]; games?: Contribution['game'][] }) {
  const l = loadLogged();
  for (const [id, e] of Object.entries(l)) if (opts.ids?.includes(id) || opts.games?.includes(e.c.game)) delete l[id];
  saveLogged(l);
}

/** Remember sessions saved before any of this existed (from a game's own archive), so they accumulate too.
 *  Pass only sessions the player still has: not deleted, never simulated. Already-remembered ones are left alone. */
export function backfillSessions(sessions: { id: string; startedAt: number; c: Contribution | null }[]) {
  const l = loadLogged();
  let added = false;
  for (const { id, startedAt, c } of sessions) {
    if (!c || l[id]) continue;
    l[id] = { at: Number.isFinite(startedAt) ? startedAt : 0, c };
    added = true;
  }
  if (added) saveLogged(l);
}

/* ── what this browser has uploaded ── */
const KEY = 'bioai.contributions';
/** One row this browser put in the database. `live` = still there. `dataset` is absent on rows uploaded by the
 *  pre-cumulative app, which is why those are superseded by any later upload of the same game. */
export interface Upload { token: string; at: string; game: string; dataset?: string; sessions: string[]; n: number; live: boolean }
interface Store { uploads: Upload[] }

function loadStore(): Store {
  const raw = read<unknown>(KEY, null);
  if (raw && typeof raw === 'object' && Array.isArray((raw as Store).uploads)) return raw as Store;
  // migrate the pre-cumulative shape: one entry per session id, several ids sharing a token for a pooled upload
  const uploads: Upload[] = [];
  if (raw && typeof raw === 'object') {
    const seen = new Set<string>();
    for (const [id, v] of Object.entries(raw as Record<string, { token?: string; at?: string; game?: string; with?: string[] }>)) {
      if (!v?.token || !v.game || seen.has(v.token)) continue;
      seen.add(v.token);
      uploads.push({ token: v.token, at: v.at ?? '', game: v.game, sessions: v.with ?? [id], n: 0, live: true });
    }
  }
  const s: Store = { uploads };
  if (uploads.length) write(KEY, s);
  return s;
}
const saveStore = (s: Store) => write(KEY, s);

/** Does this upload still stand in the way of a new cumulative row for `game` + `dataset`? */
const supersededBy = (u: Upload, game: string, dataset: string) =>
  u.live && u.game === game && (u.dataset === undefined || u.dataset === dataset);

/** The row this browser currently has in the database for one game + dataset version. */
export const uploadedFor = (game: string, dataset: string): Upload | null =>
  loadStore().uploads.filter((u) => supersededBy(u, game, dataset)).at(-1) ?? null;

/** Concatenate sessions (already in play order) into one datapoint. */
function merge(cs: Contribution[], appVersion: string): Contribution {
  const c = cs[0];
  return {
    game: c.game, app_version: appVersion, dataset_version: c.dataset_version, n: cs.reduce((a, x) => a + x.n, 0),
    items: cs.flatMap((x) => x.items), responses: cs.map((x) => x.responses).join(''),
    phases: cs.map((x) => x.phases).join(''), rt: cs.flatMap((x) => x.rt),
  };
}

/** What the results card can offer for one session, given everything this browser has played and uploaded. */
export interface Offer {
  /** the cumulative datapoint to upload; null until there are MIN_ANSWERS answers */
  contribution: Contribution | null;
  /** the sessions it covers, oldest first */
  sessionIds: string[];
  /** answers it holds */
  answers: number;
  /** the row already in the database for this game + dataset, if any */
  uploaded: Upload | null;
  /** answers in this offer that the uploaded row does not have yet */
  newAnswers: number;
  /** uploading would replace an existing row rather than add one */
  isUpdate: boolean;
  /** everything played is already contributed */
  upToDate: boolean;
  /** the datapoint has reached MAX_ANSWERS, so later sessions no longer fit */
  full: boolean;
}

/** Remember this session, then offer every session of the same game and dataset version as one cumulative datapoint,
 *  oldest first. Sessions past MAX_ANSWERS are left out so the datapoint only ever grows at the end. */
export function offerFor(sessionId: string, c: Contribution | null, startedAt?: number): Offer {
  const none: Offer = { contribution: null, sessionIds: [], answers: 0, uploaded: null, newAnswers: 0, isUpdate: false, upToDate: false, full: false };
  if (!c) return none;
  const l = loadLogged();
  l[sessionId] = { at: l[sessionId]?.at ?? (Number.isFinite(startedAt) ? startedAt! : Date.now()), c };
  saveLogged(l);
  const mine = Object.entries(l)
    .filter(([, e]) => e.c.game === c.game && e.c.dataset_version === c.dataset_version)
    .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
  const keep: [string, Contribution][] = [];
  let answers = 0;
  for (const [id, e] of mine) {
    if (answers + e.c.n > MAX_ANSWERS) continue;
    answers += e.c.n;
    keep.push([id, e.c]);
  }
  const uploaded = uploadedFor(c.game, c.dataset_version);
  const newAnswers = Math.max(0, answers - (uploaded?.n ?? 0));
  return {
    contribution: answers >= MIN_ANSWERS ? merge(keep.map(([, x]) => x), c.app_version) : null,
    sessionIds: keep.map(([id]) => id), answers, uploaded, newAnswers,
    isUpdate: !!uploaded, upToDate: !!uploaded && newAnswers === 0, full: answers >= MAX_ANSWERS,
  };
}

async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const headers = { apikey: BIOAI_SUPABASE_KEY, Authorization: `Bearer ${BIOAI_SUPABASE_KEY}`, 'Content-Type': 'application/json' };

/** Withdraw one row and mark it gone. Returns false and leaves it marked live if the call fails, so it is retried. */
async function retire(token: string): Promise<boolean> {
  try {
    const r = await fetch(`${BIOAI_SUPABASE_URL}/rest/v1/rpc/withdraw`, { method: 'POST', headers, body: JSON.stringify({ token }) });
    if (!r.ok) return false;
  } catch { return false; }
  const s = loadStore();
  for (const u of s.uploads) if (u.token === token) u.live = false;
  saveStore(s);
  return true;
}

/** Upload the cumulative datapoint, then withdraw the row it replaces. */
export async function contribute(offer: Offer): Promise<void> {
  const c = offer.contribution;
  if (!c) throw new Error(`a contribution needs at least ${MIN_ANSWERS} answers`);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const old = loadStore().uploads.filter((u) => supersededBy(u, c.game, c.dataset_version));
  const r = await fetch(`${BIOAI_SUPABASE_URL}/rest/v1/submissions`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ ...c, delete_hash: await sha256hex(token) }) });
  if (!r.ok) throw new Error(`upload failed (HTTP ${r.status})`);
  const s = loadStore();
  s.uploads.push({ token, at: new Date().toISOString().slice(0, 10), game: c.game, dataset: c.dataset_version, sessions: offer.sessionIds, n: c.n, live: true });
  saveStore(s);
  // the new row is safely in, so retire what it replaces; anything that fails here is retried by flushSuperseded()
  for (const u of old) await retire(u.token);
}

/** Withdraw this browser's contribution to one game + dataset version (every row still standing for it). */
export async function withdraw(game: string, dataset: string): Promise<void> {
  const mine = loadStore().uploads.filter((u) => supersededBy(u, game, dataset));
  let failed = 0;
  for (const u of mine) if (!await retire(u.token)) failed++;
  if (failed) throw new Error(`withdraw failed for ${failed} of ${mine.length} uploads`);
}

/** Retry withdrawals that failed earlier: for each game + dataset, only the newest row should still stand. */
export async function flushSuperseded(): Promise<void> {
  const live = loadStore().uploads.filter((u) => u.live);
  const newest = new Map<string, Upload>();
  for (const u of live) if (u.dataset !== undefined) newest.set(`${u.game}|${u.dataset}`, u);
  for (const u of live) {
    const current = u.dataset === undefined
      ? [...newest.entries()].some(([k]) => k.startsWith(`${u.game}|`))      // a legacy row, replaced by any dated one
      : newest.get(`${u.game}|${u.dataset}`) !== u;
    if (current) await retire(u.token);
  }
}
