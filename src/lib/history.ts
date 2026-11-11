import { loadLocal } from './export';
import { backfillSessions, buildContribution, forgetSessions } from './bioai';
import type { Session } from './types';

/**
 * Past sessions on this machine: which complexes were used, so none is ever shown twice, and how much
 * experience the player has. Complexes are recorded rather than items because the real and the fake of a
 * complex share a backbone - seeing one would give the other away.
 */
export interface HistoryEntry {
  session_id: string;
  start_time: string;
  n_trials: number;
  /** PDB ids used (both halves of each are then off limits). */
  pdbs: string[];
  item_ids: number[];
  /** Accuracy over the last 40 trials with feedback, overall and by truth. */
  final: { acc: number | null; byKind: Record<string, number | null> };
  simulated: boolean;
}

const KEY = 'bind.history';
/** Full copies of past sessions (so any attempt can be re-opened), keyed by session id. */
const ARCHIVE = 'bind.sessions';
const LAST = 'bind.lastSession';

function loadArchive(): Record<string, Session> {
  try { return JSON.parse(localStorage.getItem(ARCHIVE) ?? '{}') as Record<string, Session>; } catch { return {}; }
}
function saveArchive(a: Record<string, Session>) {
  // newest first; if storage is full, drop the oldest copies (the history entry itself is kept)
  let ids = Object.keys(a).sort((x, y) => a[y].meta.start_time.localeCompare(a[x].meta.start_time));
  while (ids.length) {
    try { localStorage.setItem(ARCHIVE, JSON.stringify(Object.fromEntries(ids.map((i) => [i, a[i]])))); return; } catch { ids = ids.slice(0, -1); }
  }
  try { localStorage.removeItem(ARCHIVE); } catch { /* storage unavailable */ }
}
export function loadArchived(id: string): Session | null { return loadArchive()[id] ?? null; }

/** The most recent real session on this device (archived, or the last one saved), for "Your stats" on the landing page.
 *  The results page merges it with the earlier ones, so this shows the same view as just finishing a game. */
export function latestSession(history: HistoryEntry[], last: Session | null): Session | null {
  return [last, ...history.map((h) => loadArchived(h.session_id))]
    .filter((s): s is Session => !!s?.meta && !s.meta.simulated && s.trials.length > 0)
    .sort((a, b) => b.meta.start_time.localeCompare(a.meta.start_time))[0] ?? null;
}

export function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[]; } catch { return []; }
}

function save(h: HistoryEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* storage unavailable — history just isn't kept */ }
}

export function entryFromSession(s: Session): HistoryEntry {
  const fb = s.trials.filter((t) => t.feedback !== 'none').slice(-40);
  const acc = (ts: typeof fb) => (ts.length ? ts.filter((t) => t.correct).length / ts.length : null);
  return {
    session_id: s.meta.session_id,
    start_time: s.meta.start_time,
    n_trials: s.trials.length,
    pdbs: [...new Set(s.trials.map((t) => t.pdb))],
    item_ids: s.trials.map((t) => t.item_id),
    final: { acc: acc(fb), byKind: { real: acc(fb.filter((t) => t.label === 1)), fake: acc(fb.filter((t) => t.label === 0)) } },
    simulated: s.meta.simulated,
  };
}

/** Add (or replace) a session. Simulated sessions are never added — they aren't real experience. */
export function addToHistory(s: Session): HistoryEntry[] {
  if (s.meta.simulated) return loadHistory();
  const h = loadHistory().filter((e) => e.session_id !== s.meta.session_id);
  h.push(entryFromSession(s));
  h.sort((a, b) => a.start_time.localeCompare(b.start_time));
  save(h);
  saveArchive({ ...loadArchive(), [s.meta.session_id]: s });
  return h;
}

export function removeFromHistory(id: string): HistoryEntry[] {
  forgetSessions({ ids: [id] });
  const h = loadHistory().filter((e) => e.session_id !== id);
  save(h);
  const a = loadArchive(); delete a[id]; saveArchive(a);
  try { if ((JSON.parse(localStorage.getItem(LAST) ?? 'null') as Session | null)?.meta.session_id === id) localStorage.removeItem(LAST); } catch { /* ignore */ }
  return h;
}

/** Forget every attempt on this device: history, saved sessions, and the last-session copy. Preferences are kept. */
export function clearAllAttempts(): HistoryEntry[] {
  forgetSessions({ games: ['binders'] });
  for (const k of [KEY, ARCHIVE, LAST]) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }
  return [];
}

/** History entries that started before this session (what the player had already done). */
export function priorTo(h: HistoryEntry[], s: Session): HistoryEntry[] {
  return h.filter((e) => e.session_id !== s.meta.session_id && e.start_time < s.meta.start_time);
}

/** This session as a BioAI by eye datapoint (may be short: the results card pools short sessions). */
export function sessionContribution(s: Session) {
  return buildContribution('binders', String(s.meta.app_version ?? ''), String(s.meta.dataset_version ?? ''), ['learn', 'new'],
    s.trials.map((t) => ({ item: t.item_id, response: String(t.response), phase: t.phase, rt: t.rt_ms })));
}

/** Let sessions saved before cumulative contributions existed count too: only ones still in history (not deleted), never simulated. */
export function backfillPastSessions() {
  const kept = new Set(loadHistory().map((e) => e.session_id));
  const seen = new Set<string>();
  backfillSessions([...Object.values(loadArchive()), loadLocal()].filter((s): s is Session => !!s?.meta && !s.meta.simulated && kept.has(s.meta.session_id))
    .filter((s) => !seen.has(s.meta.session_id) && !!seen.add(s.meta.session_id))
    .map((s) => ({ id: s.meta.session_id, startedAt: Date.parse(s.meta.start_time), c: sessionContribution(s) })));
}

/** Every real session on this device for the same dataset — this one included — merged in the order they were
 *  played, so the results page can analyse everything the player has done rather than one run. Trials keep their own
 *  phase, so phase and learning statistics simply span more of them; `sessions` is how many went in. */
export function cumulativeSession(s: Session): { session: Session; sessions: number } {
  const all = [s, ...Object.values(loadArchive())]
    .filter((x): x is Session => !!x?.meta && !x.meta.simulated && x.meta.dataset_version === s.meta.dataset_version)
    .filter((x, i, a) => a.findIndex((y) => y.meta.session_id === x.meta.session_id) === i)   // the live copy of s wins
    .sort((a, b) => a.meta.start_time.localeCompare(b.meta.start_time));
  if (all.length < 2) return { session: s, sessions: 1 };
  // Each session numbers its trials from 1 and times them from its own start; renumber and offset so the
  // merged sessions lie one after another in play order instead of all piling up at the start of the x axis.
  let elapsed = 0;
  const trials = all.flatMap((x) => {
    const base = elapsed;
    elapsed += Math.max(x.meta.active_duration_ms ?? 0, ...x.trials.map((t) => t.elapsed_ms ?? 0));
    return x.trials.map((t) => ({ ...t, elapsed_ms: (t.elapsed_ms ?? 0) + base }));
  }).map((t, i) => ({ ...t, trial: i + 1 }));
  const phase_starts: Record<string, number> = {};
  for (const t of trials) if (!(t.phase in phase_starts)) phase_starts[t.phase] = t.trial;
  const active = all.reduce((t, x) => t + (x.meta.active_duration_ms ?? 0), 0);
  return {
    session: { ...s, meta: { ...s.meta, start_time: all[0].meta.start_time, active_duration_ms: active, phase_starts }, trials },
    sessions: all.length,
  };
}
