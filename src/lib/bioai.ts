/**
 * BioAI by eye — anonymous contributions (shared by every game; keep the copies identical).
 * Uploads only datapoints: game, version, item ids, answers, part of the session, response times. No identifiers.
 * The withdrawal token stays in this browser; the database stores only its SHA-256.
 */
export const BIOAI_HUB = 'https://matt115a.github.io/BioAI_by_eye/';
/** Supabase project URL and its public "anon" key (safe to ship: row-level security allows insert + withdraw only). Empty = off. */
export const BIOAI_SUPABASE_URL: string = import.meta.env.VITE_BIOAI_URL ?? '';
export const BIOAI_SUPABASE_KEY: string = import.meta.env.VITE_BIOAI_KEY ?? '';
export const BIOAI_READY = !!(BIOAI_SUPABASE_URL && BIOAI_SUPABASE_KEY);

export interface Contribution { game: 'nanopore' | 'mutations' | 'seq' | 'struct' | 'binders'; app_version: string; dataset_version: string; n: number; items: number[]; responses: string; phases: string; rt: number[] }

/** Build the upload from trials; null if too short. `phases` is the canonical phase list shared with the hub. */
export function buildContribution(game: Contribution['game'], appVersion: string, datasetVersion: string, phases: string[],
  trials: { item: number; response: string; phase: string; rt: number }[]): Contribution | null {
  const ts = trials.filter((t) => typeof t.response === 'string' && /^[A-Z0-9]$/.test(t.response)).slice(0, 1000);
  if (ts.length < 20) return null;
  return {
    game, app_version: appVersion.slice(0, 20), dataset_version: datasetVersion.slice(0, 40), n: ts.length,
    items: ts.map((t) => t.item), responses: ts.map((t) => t.response).join(''),
    phases: ts.map((t) => { const k = phases.indexOf(t.phase); return String(k < 0 ? 9 : k); }).join(''),
    rt: ts.map((t) => Math.max(0, Math.min(600000, Math.round(t.rt / 10) * 10))),
  };
}

const KEY = 'bioai.contributions';
type Store = Record<string, { token: string; at: string; game: string }>;
const load = (): Store => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store; } catch { return {}; } };
const save = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };
export const contributionFor = (sessionId: string) => load()[sessionId] ?? null;

async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const headers = { apikey: BIOAI_SUPABASE_KEY, Authorization: `Bearer ${BIOAI_SUPABASE_KEY}`, 'Content-Type': 'application/json' };

export async function contribute(sessionId: string, c: Contribution): Promise<void> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch(`${BIOAI_SUPABASE_URL}/rest/v1/submissions`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ ...c, delete_hash: await sha256hex(token) }) });
  if (!r.ok) throw new Error(`upload failed (HTTP ${r.status})`);
  save({ ...load(), [sessionId]: { token, at: new Date().toISOString().slice(0, 10), game: c.game } });
}

export async function withdraw(sessionId: string): Promise<void> {
  const c = contributionFor(sessionId);
  if (!c) return;
  const r = await fetch(`${BIOAI_SUPABASE_URL}/rest/v1/rpc/withdraw`, { method: 'POST', headers, body: JSON.stringify({ token: c.token }) });
  if (!r.ok) throw new Error(`withdraw failed (HTTP ${r.status})`);
  const s = load(); delete s[sessionId]; save(s);
}
