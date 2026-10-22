import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { cueWeights, modelAccuracy, modelProfile, phaseList, streamLearners } from '../src/lib/analysis';
import { parseDataset } from '../src/lib/dataset';
import { CSV_COLUMNS, trialsToCsv } from '../src/lib/export';
import { SessionCore } from '../src/lib/session';
import { simulateSession } from '../src/lib/simulate';
import { DEFAULT_CONFIG, type Config, type Session } from '../src/lib/types';

const data = parseDataset(JSON.parse(readFileSync('public/data/dataset.json', 'utf8')));
const byId = new Map(data.items.map((v) => [v.id, v]));
/** A config that fits the dataset however many complexes it holds, so the tests don't depend on its size. */
const groupSize = (g: string) => data.complexes.filter((c) => c.group === g).length;
const CONFIG: Config = {
  ...DEFAULT_CONFIG,
  phases: DEFAULT_CONFIG.phases.map((p) => ({ ...p, trials: Math.min(p.trials, groupSize(p.group)) })),
};
const answer = (core: SessionCore, n: number, correct: (i: number) => boolean) => {
  for (let i = 0; i < n && !core.done; i++) {
    const s = core.nextStimulus();
    if (!s) break;
    const label = correct(i) ? s.it.label : (1 - s.it.label) as 0 | 1;
    core.record({ it: s.it, block: s.block, pressedKey: core.config.keys[label], rtMs: 9000, lookMs: 6000, viewActions: 4, onsetPerf: i * 12000, responsePerf: i * 12000 + 9000, wallOnset: new Date(), elapsedMs: i * 12000 });
  }
};

describe('dataset', () => {
  it('pairs every complex with one real and one fake item', () => {
    expect(data.complexes.length).toBeGreaterThan(20);
    expect(data.items).toHaveLength(data.complexes.length * 2);
    for (const c of data.complexes) {
      const its = data.items.filter((i) => i.pdb === c.pdb);
      expect(its.map((i) => i.label).sort()).toEqual([0, 1]);
      const fake = its.find((i) => i.label === 0)!, real = its.find((i) => i.label === 1)!;
      expect(real.muts).toHaveLength(0);
      expect(fake.muts.length).toBe(fake.n_mut);
      expect(fake.n_mut).toBeGreaterThan(0);
      // the fake replaces about half of the interface, and only interface positions
      expect(fake.n_mut / c.n_interface).toBeGreaterThan(0.3);
      expect(fake.n_mut / c.n_interface).toBeLessThanOrEqual(0.55);
      const iface = new Set(fake.iface.map((r) => `${r.chain}${r.i}`));
      for (const m of fake.muts) {
        const [chain, rest] = m.split(':');
        expect(iface.has(`${chain}${rest.slice(1, -1)}`)).toBe(true);
        expect(rest[0]).not.toBe(rest[rest.length - 1]);        // never a silent "mutation"
        expect(rest[rest.length - 1]).not.toBe('C');             // cysteine is excluded
      }
    }
  });
  it('every model calls exactly half the items real, so chance is 50%', () => {
    for (const m of data.models) {
      const real = data.items.filter((i) => i.calls[m.name] === 1).length;
      expect(real).toBe(data.items.length / 2);
      expect(modelAccuracy(data.items.map((i) => ({ item_id: i.id, label: i.label })) as never, byId, m.name))
        .toBeCloseTo(m.accuracy, 3);
    }
  });
  it('held-out complexes exist and no complex is in both groups', () => {
    expect(groupSize('new')).toBeGreaterThan(5);
    expect(groupSize('learn') + groupSize('new')).toBe(data.complexes.length);
  });
});

describe('session', () => {
  it('runs both parts from the right groups, one item per complex, balanced in blocks of 8', () => {
    const core = new SessionCore(CONFIG, data, { seed: 1 });
    answer(core, 10_000, (i) => i % 2 === 0);
    expect(core.endReason(0)).toBe('protocol_complete');
    const parts = phaseList({ meta: core.meta, trials: core.trials } as Session);
    expect(parts.map((p) => p.name)).toEqual(['learn', 'new']);
    parts.forEach((p) => expect(p.trials.every((t) => t.group === p.name)).toBe(true));
    // never the same complex twice, in either version
    expect(new Set(core.trials.map((t) => t.pdb)).size).toBe(core.trials.length);
    for (const p of parts) {
      for (let b = 0; b + 8 <= p.trials.length; b += 8) {
        expect(p.trials.slice(b, b + 8).filter((t) => t.label === 0)).toHaveLength(4);
      }
    }
  });
  it('maps keys to labels and never revisits a complex from an earlier session', () => {
    const exclude = new Set(data.complexes.filter((_c, i) => i % 2 === 0).map((c) => c.pdb));
    const core = new SessionCore({ ...CONFIG, keys: ['D', 'N'] }, data, { seed: 2, exclude });
    answer(core, 20, () => true);
    expect(core.trials.length).toBeGreaterThan(0);
    core.trials.forEach((t) => {
      expect(exclude.has(t.pdb)).toBe(false);
      expect(t.response).toBe(t.pressed_key === 'D' ? 0 : 1);
      expect(t.correct).toBe(t.response === t.label);
    });
  });
  it('stops cleanly when a group runs out instead of repeating complexes', () => {
    const keep = data.complexes.filter((c) => c.group === 'learn').slice(0, 3).map((c) => c.pdb);
    const exclude = new Set(data.complexes.filter((c) => !keep.includes(c.pdb)).map((c) => c.pdb));
    const core = new SessionCore({ ...CONFIG, phases: [CONFIG.phases[0]] }, data, { seed: 3, exclude });
    answer(core, 50, () => true);
    expect(core.trials).toHaveLength(3);
    expect(core.nextStimulus()).toBeNull();
  });
});

describe('analysis', () => {
  const s = simulateSession(CONFIG, data, 5);
  it('simulation completes; CSV has every trial', () => {
    expect(s.meta.end_reason).toBe('protocol_complete');
    const lines = trialsToCsv(s).trim().split('\n');
    expect(lines).toHaveLength(s.trials.length + 1);
    expect(lines[0].split(',')).toEqual(['session_id', ...CSV_COLUMNS]);
  });
  it('same-experience learners score every trial and learn something', () => {
    const learners = streamLearners(s, data, byId);
    learners.forEach((l) => expect(l.correct).toHaveLength(s.trials.length));
    const lr = learners[0].correct;
    expect(lr.reduce((a, b) => a + b, 0) / lr.length).toBeGreaterThan(0.5);
  });
  it('cue weights: the truth counts clashes against a complex', () => {
    const cw = cueWeights(s, data, byId)!;
    expect(cw.truth[cw.names.indexOf('Clashing atoms')]).toBeLessThan(0);
  });
});

describe('model profile', () => {
  it('ranks models by κ and puts a copycat at κ = 1', () => {
    const s = simulateSession(CONFIG, data, 7);
    const target = data.models[0].name;
    const prof = modelProfile(s, byId, data.models);
    expect(prof).toHaveLength(data.models.length);
    for (let i = 1; i < prof.length; i++) expect(prof[i - 1].kappa).toBeGreaterThanOrEqual(prof[i].kappa);
    const copy = { ...s, trials: s.trials.map((t) => { const r = byId.get(t.item_id)!.calls[target]; return { ...t, response: r, correct: r === t.label }; }) };
    const p2 = modelProfile(copy, byId, data.models);
    expect(p2[0].kappa).toBeCloseTo(1, 6);
    expect(p2.find((p) => p.name === target)!.kappa).toBeCloseTo(1, 6);
  });
});

describe('live scoreboard', () => {
  it('scores you and every model on the same answered complexes', async () => {
    const { boardRows } = await import('../src/components/LiveBoard');
    const core = new SessionCore(CONFIG, data, { seed: 3 });
    const seen: typeof data.items = [];
    for (let i = 0; i < 24; i++) {
      const s = core.nextStimulus()!;
      core.record({ it: s.it, block: s.block, pressedKey: 'TAP', label: (i % 3 ? s.it.label : 1 - s.it.label) as 0 | 1, rtMs: 7000, lookMs: 5000, viewActions: 3, onsetPerf: i * 9000, responsePerf: i * 9000 + 7000, wallOnset: new Date(), elapsedMs: i * 9000 });
      seen.push(s.it);
    }
    expect(core.trials[0].pressed_key).toBe('TAP');
    const rows = boardRows(seen, core.trials.map((t) => t.correct), data.models, 10);
    expect(rows[0].all).toBeCloseTo(16 / 24, 6);
    expect(rows[0].recent).toBeCloseTo(core.trials.slice(14).filter((t) => t.correct).length / 10, 6);
    const m = data.models[0];
    expect(rows.find((r) => r.name === m.name)!.all).toBeCloseTo(seen.filter((v) => v.calls[m.name] === v.label).length / 24, 6);
    expect(rows).toHaveLength(data.models.length + 1);
  });
});

describe('attempts', () => {
  it('archives, removes one, and clears all', async () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const { addToHistory, loadArchived, removeFromHistory, clearAllAttempts, loadHistory } = await import('../src/lib/history');
    const a = simulateSession(CONFIG, data, 1), b = simulateSession(CONFIG, data, 2);
    for (const s of [a, b]) s.meta.simulated = false;
    b.meta.session_id += '-b';
    addToHistory(a); addToHistory(b);
    store.set('bind.rival', 'af2');
    expect(loadHistory()).toHaveLength(2);
    expect(loadHistory()[0].pdbs.length).toBe(a.trials.length);     // one complex per trial
    expect(loadArchived(a.meta.session_id)?.trials.length).toBe(a.trials.length);
    expect(removeFromHistory(a.meta.session_id)).toHaveLength(1);
    expect(loadArchived(a.meta.session_id)).toBeNull();
    expect(clearAllAttempts()).toEqual([]);
    expect(loadHistory()).toEqual([]);
    expect(store.get('bind.rival')).toBe('af2');   // preferences survive
  });
});
