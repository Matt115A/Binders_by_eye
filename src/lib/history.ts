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
  const h = loadHistory().filter((e) => e.session_id !== id);
  save(h);
  const a = loadArchive(); delete a[id]; saveArchive(a);
  try { if ((JSON.parse(localStorage.getItem(LAST) ?? 'null') as Session | null)?.meta.session_id === id) localStorage.removeItem(LAST); } catch { /* ignore */ }
  return h;
}

/** Forget every attempt on this device: history, saved sessions, and the last-session copy. Preferences are kept. */
export function clearAllAttempts(): HistoryEntry[] {
  for (const k of [KEY, ARCHIVE, LAST]) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }
  return [];
}

/** History entries that started before this session (what the player had already done). */
export function priorTo(h: HistoryEntry[], s: Session): HistoryEntry[] {
  return h.filter((e) => e.session_id !== s.meta.session_id && e.start_time < s.meta.start_time);
}
