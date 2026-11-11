import { beforeEach, describe, expect, it, vi } from 'vitest';

// in-memory localStorage (every game on the origin shares it)
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
const fetchMock = vi.fn(async (_url?: unknown, _init?: unknown) => ({ ok: true }) as unknown as Response);
vi.stubGlobal('fetch', fetchMock);

const { backfillSessions, buildContribution, contribute, flushSuperseded, forgetSessions, MAX_ANSWERS, MIN_ANSWERS, offerFor, uploadedFor, withdraw } =
  await import('../src/lib/bioai');

const session = (n: number, first = 0, game: 'binders' | 'mutations' = 'binders', ds = 'v1') =>
  buildContribution(game, 'a', ds, ['learn', 'new'], Array.from({ length: n }, (_, i) => ({ item: first + i, response: '1', phase: 'learn', rt: 1000 })))!;
const posts = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/submissions')).length;
const withdrawals = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/rpc/withdraw')).length;
const sessionsLogged = () => Object.keys(JSON.parse(mem.get('bioai.sessions') ?? '{}'));

beforeEach(() => { mem.clear(); fetchMock.mockClear(); fetchMock.mockImplementation(async () => ({ ok: true }) as unknown as Response); });

describe('cumulative contributions', () => {
  it('remembers every session, long ones included, and offers them as one datapoint in play order', () => {
    const a = offerFor('a', session(12, 0), 1000);
    expect(a.contribution).toBeNull();          // 12 < 20
    expect(a.answers).toBe(12);
    const b = offerFor('b', session(9, 100), 2000);
    expect(b.contribution?.n).toBe(21);
    expect(b.sessionIds).toEqual(['a', 'b']);
    expect(b.contribution!.items.slice(11, 13)).toEqual([11, 100]);   // a then b
    expect(b.contribution!.responses).toHaveLength(21);
    expect(b.contribution!.rt).toHaveLength(21);
    // a third, already-long session still accumulates rather than standing alone
    const c = offerFor('c', session(30, 200), 3000);
    expect(c.contribution!.n).toBe(51);
    expect(c.sessionIds).toEqual(['a', 'b', 'c']);
    expect(sessionsLogged().sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps games and dataset versions apart, and forgets deleted sessions', () => {
    offerFor('other-game', session(25, 0, 'mutations'), 1000);
    offerFor('other-ds', session(25, 0, 'binders', 'v2'), 1000);
    offerFor('gone', session(25), 1000);
    forgetSessions({ ids: ['gone'] });
    const o = offerFor('mine', session(21), 2000);
    expect(o.sessionIds).toEqual(['mine']);
    expect(o.contribution!.n).toBe(21);
    forgetSessions({ games: ['binders'] });
    expect(sessionsLogged().sort()).toEqual(['other-game']);          // v2 is binders too, so it goes as well
  });

  it('contributing again replaces the row: insert first, then withdraw the old token', async () => {
    const first = offerFor('a', session(25), 1000);
    expect(first.isUpdate).toBe(false);
    await contribute(first);
    expect([posts(), withdrawals()]).toEqual([1, 0]);
    expect(uploadedFor('binders', 'v1')!.n).toBe(25);
    expect(offerFor('a', session(25), 1000).upToDate).toBe(true);

    const next = offerFor('b', session(10, 500), 2000);
    expect([next.isUpdate, next.newAnswers, next.answers, next.upToDate]).toEqual([true, 10, 35, false]);
    await contribute(next);
    expect([posts(), withdrawals()]).toEqual([2, 1]);                 // inserted the merged row, retired the old one
    expect(uploadedFor('binders', 'v1')!.n).toBe(35);
    expect(offerFor('b', session(10, 500), 2000).upToDate).toBe(true);
  });

  it('a failed withdrawal leaves the data present and is retried later', async () => {
    await contribute(offerFor('a', session(25), 1000));
    fetchMock.mockImplementation(async (url: unknown) => ({ ok: !String(url).includes('/rpc/withdraw') }) as unknown as Response);
    await contribute(offerFor('b', session(10, 500), 2000));          // insert succeeds, withdraw fails
    const live = JSON.parse(mem.get('bioai.contributions')!).uploads.filter((u: { live: boolean }) => u.live);
    expect(live).toHaveLength(2);                                     // both rows stand: present twice, never absent
    fetchMock.mockImplementation(async () => ({ ok: true }) as unknown as Response);
    await flushSuperseded();
    const after = JSON.parse(mem.get('bioai.contributions')!).uploads.filter((u: { live: boolean }) => u.live);
    expect(after).toHaveLength(1);
    expect(after[0].n).toBe(35);
  });

  it('withdrawing removes the whole cumulative datapoint', async () => {
    await contribute(offerFor('a', session(25), 1000));
    await withdraw('binders', 'v1');
    expect(withdrawals()).toBe(1);
    expect(uploadedFor('binders', 'v1')).toBeNull();
    expect(offerFor('a', session(25), 1000).isUpdate).toBe(false);    // offerable again
  });

  it('migrates a pre-cumulative upload and supersedes it on the next contribution', async () => {
    mem.set('bioai.contributions', JSON.stringify({ old1: { token: 'tok', at: '2026-11-01', game: 'binders', with: ['old1', 'old2'] }, old2: { token: 'tok', at: '2026-11-01', game: 'binders', with: ['old1', 'old2'] } }));
    expect(uploadedFor('binders', 'v1')!.token).toBe('tok');          // matched by game: the old row has no dataset
    await contribute(offerFor('a', session(25), 1000));
    expect(withdrawals()).toBe(1);                                    // the legacy row was retired exactly once
    expect(uploadedFor('binders', 'v1')!.n).toBe(25);
  });

  it('stops growing at MAX_ANSWERS instead of dropping the oldest answers', () => {
    offerFor('a', session(MAX_ANSWERS - 5), 1000);
    const o = offerFor('b', session(10, 5000), 2000);
    expect(o.answers).toBe(MAX_ANSWERS - 5);                          // b does not fit, so it is left out
    expect(o.sessionIds).toEqual(['a']);
    expect(o.full).toBe(false);
    const p = offerFor('c', session(5, 9000), 3000);
    expect([p.answers, p.full, p.sessionIds]).toEqual([MAX_ANSWERS, true, ['a', 'c']]);
  });

  it('backfills past sessions of any length, without reviving deleted or re-adding known ones', () => {
    offerFor('known', session(7), 5000);
    backfillSessions([
      { id: 'old-long', startedAt: 1000, c: session(40, 100) },
      { id: 'old-short', startedAt: 2000, c: session(6, 200) },
      { id: 'known', startedAt: 9999, c: session(99, 300) },
      { id: 'no-answers', startedAt: 3000, c: null },
    ]);
    expect(sessionsLogged().sort()).toEqual(['known', 'old-long', 'old-short']);
    const o = offerFor('new', session(5, 400), 6000);
    expect(o.sessionIds).toEqual(['old-long', 'old-short', 'known', 'new']);   // ordered by when they were played
    expect(o.answers).toBe(40 + 6 + 7 + 5);
    expect(o.contribution!.items[0]).toBe(100);
    expect(JSON.parse(mem.get('bioai.sessions')!).known.c.n).toBe(7);          // the known session was not overwritten
  });

  it('adopts sessions remembered under the old pooling key', () => {
    mem.set('bioai.pending', JSON.stringify({ p1: { at: 1000, c: session(12) } }));
    const o = offerFor('p2', session(9, 100), 2000);
    expect(o.sessionIds).toEqual(['p1', 'p2']);
    expect(o.contribution!.n).toBe(21);
    expect(mem.get('bioai.pending')).toBe('{}');
    expect(sessionsLogged().sort()).toEqual(['p1', 'p2']);
  });

  it('needs MIN_ANSWERS before anything can be sent', async () => {
    const o = offerFor('a', session(MIN_ANSWERS - 1), 1000);
    expect(o.contribution).toBeNull();
    await expect(contribute(o)).rejects.toThrow(/at least 20/);
    expect(posts()).toBe(0);
  });
});
