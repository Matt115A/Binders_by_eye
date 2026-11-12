import { describe, expect, it } from 'vitest';
import { type Contribution, humanBaseline, type Peer, standing } from '../src/lib/bioai';

/** answers to items 0..n-1; '1' is right, anything else wrong */
const peer = (resp: string, first = 0): Peer => ({ n: resp.length, items: [...resp].map((_, i) => first + i), responses: resp });
const mine = (resp: string): Contribution => ({ game: 'binders', app_version: 'a', dataset_version: 'v1', n: resp.length, items: [...resp].map((_, i) => i), responses: resp, phases: '', rt: [] });
const score = (_item: number, r: string) => (r === '1' ? 1 : 0);

describe('where you stand', () => {
  it('leaves out your own row, including an older shorter copy of it', () => {
    const me = mine('1111100000');
    const st = standing([peer('1111100000'), peer('11111'), peer('0000000000', 50)], me, score);
    expect(st.others).toEqual([{ score: 0, n: 10 }]);
    expect(st.me).toEqual({ score: 0.5, n: 10 });
  });

  it('counts someone who added sessions once, at their longest', () => {
    const st = standing([peer('11', 100), peer('1100', 100), peer('110000', 100)], mine('1'.repeat(20)), score);
    expect(st.others).toEqual([{ score: 2 / 6, n: 6 }]);
  });

  it('keeps two people who answered identically as two people', () => {
    const st = standing([peer('1010', 100), peer('1010', 200)], mine('11'), score);
    expect(st.others).toHaveLength(2);
  });

  it('gives percentiles on both axes, ties counting half', () => {
    const others = [peer('0000', 100), peer('1100', 200), peer('11111111', 300), peer('1111', 400)];
    const st = standing(others, mine('111100'), score);   // score 2/3, n 6
    expect(st.scorePct).toBe(50);                         // ahead of 0 and 0.5; behind two perfect scores
    expect(st.nPct).toBe(75);                             // more answers than three of the four
  });

  it('has no percentile when nobody else has contributed', () => {
    const st = standing([peer('11')].map((p) => ({ ...p, items: [0, 1] })), mine('11'), score);
    expect(st.others).toHaveLength(0);
    expect(st.scorePct).toBeNull();
  });

  it('ignores items this dataset does not know', () => {
    const known = (item: number, r: string) => (item >= 100 ? null : r === '1' ? 1 : 0);
    const st = standing([peer('1100', 98)], mine('1'), known);   // items 98, 99 known (1, 1); 100, 101 unknown
    expect(st.others).toEqual([{ score: 1, n: 4 }]);
  });
});

describe('average human on the live leaderboard', () => {
  it('is the mean of each other person at the same stage, using everything they have if they stopped sooner', () => {
    const h = humanBaseline([peer('1111', 100), peer('0000', 200), peer('10', 300)], null, score)!;
    expect(h.people).toBe(3);
    expect(h.at(1, 10).all).toBeCloseTo((1 + 0 + 1) / 3);
    expect(h.at(4, 10).all).toBeCloseTo((1 + 0 + 0.5) / 3);   // the third person stopped at 2 answers
    expect(h.at(4, 2).recent).toBeCloseTo((1 + 0 + 0.5) / 3);  // last two of 1111, 0000, and all of 10
  });
  it('leaves you out and waits for enough other people', () => {
    expect(humanBaseline([peer('11'), peer('1100', 100), peer('0011', 200)], peer('11'), score)).toBeNull();
    expect(humanBaseline([peer('11', 50), peer('1100', 100), peer('0011', 200)], peer('11'), score)!.people).toBe(3);
  });
});
