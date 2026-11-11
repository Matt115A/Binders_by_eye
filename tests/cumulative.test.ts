import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/lib/types';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
const { cumulativeSession } = await import('../src/lib/history');

/** a session with `n` trials, each carrying its own id so order is checkable */
const mk = (id: string, start: string, n: number, ds = '1.0.0', simulated = false): Session =>
  ({ meta: { session_id: id, start_time: start, dataset_version: ds, simulated, active_duration_ms: 1000 },
     trials: Array.from({ length: n }, (_, i) => ({ item_id: i, tag: `${id}:${i}` })) } as unknown as Session);
const archive = (...ss: Session[]) => mem.set('bind.sessions', JSON.stringify(Object.fromEntries(ss.map((s) => [s.meta.session_id, s]))));
const tags = (s: Session) => (s.trials as unknown as { tag: string }[]).map((t) => t.tag);

beforeEach(() => mem.clear());

describe('cumulative analysis', () => {
  it('a lone session is returned untouched', () => {
    const s = mk('a', '2026-01-01', 5);
    const got = cumulativeSession(s);
    expect(got.sessions).toBe(1);
    expect(got.session).toBe(s);
  });

  it('merges the archive with the live session in the order they were played', () => {
    const older = mk('a', '2026-01-01', 3), newer = mk('b', '2026-03-01', 2), current = mk('c', '2026-06-01', 2);
    archive(newer, older);                                   // archive order is arbitrary
    const got = cumulativeSession(current);
    expect(got.sessions).toBe(3);
    expect(tags(got.session)).toEqual(['a:0', 'a:1', 'a:2', 'b:0', 'b:1', 'c:0', 'c:1']);
    expect(got.session.meta.start_time).toBe('2026-01-01');  // the span starts at the first session
    expect(got.session.meta.active_duration_ms).toBe(3000);
    expect(got.session.meta.session_id).toBe('c');           // still identified as the run just finished
  });

  it('prefers the live copy of the current session over a stale archived one', () => {
    const stale = mk('c', '2026-06-01', 1);
    archive(mk('a', '2026-01-01', 2), stale);
    const got = cumulativeSession(mk('c', '2026-06-01', 4));
    expect(got.sessions).toBe(2);
    expect(tags(got.session)).toEqual(['a:0', 'a:1', 'c:0', 'c:1', 'c:2', 'c:3']);
  });

  it('leaves out other dataset versions and simulated runs', () => {
    archive(mk('old-ds', '2026-01-01', 9, '0.9.0'), mk('fake', '2026-02-01', 9, '1.0.0', true), mk('real', '2026-03-01', 2));
    const got = cumulativeSession(mk('now', '2026-06-01', 1));
    expect(got.sessions).toBe(2);
    expect(tags(got.session)).toEqual(['real:0', 'real:1', 'now:0']);
  });
});
