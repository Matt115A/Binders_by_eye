import { FEATURE_NAMES, OnlineLogReg, fitLogReg, standardiser } from './features';
import type { Dataset, Item, Session, TrialRecord } from './types';

export interface Pt { x: number; y: number }
export const acc = (ts: { correct: boolean }[]) => (ts.length ? ts.filter((t) => t.correct).length / ts.length : null);
export function median(xs: number[]): number | null { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Rolling mean over w trials (numbers), restarting at each part. */
export function rolling(trials: TrialRecord[], v: number[], w: number): Pt[] {
  const out: Pt[] = []; let buf: number[] = []; let phase = trials[0]?.phase;
  trials.forEach((t, i) => {
    if (t.phase !== phase) { buf = []; phase = t.phase; }
    buf.push(v[i]); if (buf.length > w) buf.shift();
    if (buf.length >= Math.min(6, w)) out.push({ x: t.trial, y: buf.reduce((a, b) => a + b, 0) / buf.length });
  });
  return out;
}

export function phaseList(s: Session) {
  const out: { name: string; label: string; start: number; trials: TrialRecord[] }[] = [];
  for (const t of s.trials) {
    let cur = out[out.length - 1];
    if (!cur || cur.name !== t.phase) { cur = { name: t.phase, label: s.meta.config.phases.find((p) => p.name === t.phase)?.label ?? t.phase, start: t.trial, trials: [] }; out.push(cur); }
    cur.trials.push(t);
  }
  return out;
}

export function phaseStats(s: Session) {
  return phaseList(s).map((p) => {
    const k = p.trials.filter((t) => t.correct).length, n = p.trials.length;
    const real = p.trials.filter((t) => t.label === 1), fake = p.trials.filter((t) => t.label === 0);
    return {
      ...p, n, acc: n ? k / n : null, ci: wilson(k, n), hitReal: acc(real), hitFake: acc(fake),
      saidReal: n ? p.trials.filter((t) => t.response === 1).length / n : null,
      rt: median(p.trials.map((t) => t.rt_ms)), look: median(p.trials.map((t) => t.look_ms)),
    };
  });
}

export function modelAccuracy(trials: TrialRecord[], byId: Map<number, Item>, model: string): number | null {
  if (!trials.length) return null;
  return trials.filter((t) => byId.get(t.item_id)!.calls[model] === t.label).length / trials.length;
}

export interface Subset { key: string; label: string; trials: TrialRecord[] }
export function subsets(s: Session): Subset[] {
  return [{ key: 'all', label: 'All trials', trials: s.trials }, ...phaseList(s).map((p) => ({ key: p.name, label: p.label, trials: p.trials }))];
}

/** Learners that see exactly your stream (predict each trial before its feedback; learn nothing from no-feedback trials). */
export function streamLearners(s: Session, data: Dataset, byId: Map<number, Item>, priorIds: number[] = []) {
  const X = standardiser(data.items);
  const stream = [...priorIds.map((id) => ({ v: byId.get(id), fb: true, prior: true })), ...s.trials.map((t) => ({ v: byId.get(t.item_id), fb: t.feedback !== 'none', prior: false }))]
    .filter((e): e is { v: Item; fb: boolean; prior: boolean } => !!e.v);
  const d = FEATURE_NAMES.length;
  const lr = new OnlineLogReg(d, 0.05);
  const nb = [0, 1].map(() => ({ n: 0, s: Array(d).fill(0), ss: Array(d).fill(0) }));
  const mem: { x: number[]; y: number }[] = [];
  const out = { lr: [] as number[], nb: [] as number[], knn: [] as number[] };
  for (const e of stream) {
    const x = X(e.v), y = e.v.label;
    if (!e.prior) {
      out.lr.push(+((lr.p(x) >= 0.5 ? 1 : 0) === y));
      const ll = nb.map((c) => (c.n < 3 ? -Infinity : x.reduce((a, xi, j) => { const m = c.s[j] / c.n, v = Math.max(0.05, c.ss[j] / c.n - m * m); return a - 0.5 * Math.log(v) - (xi - m) ** 2 / (2 * v); }, Math.log(c.n))));
      out.nb.push(Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? +((ll[1] > ll[0] ? 1 : 0) === y) : 0.5);
      if (mem.length >= 5) {
        const k = mem.map((m) => [m.x.reduce((a, xi, j) => a + (xi - x[j]) ** 2, 0), m.y]).sort((a, b) => a[0] - b[0]).slice(0, 11);
        out.knn.push(+((k.filter((q) => q[1] === 1).length * 2 > k.length ? 1 : 0) === y));
      } else out.knn.push(0.5);
    }
    if (!e.fb) continue;
    lr.update(x, y);
    nb[y].n++; x.forEach((xi, j) => { nb[y].s[j] += xi; nb[y].ss[j] += xi * xi; });
    mem.push({ x, y });
  }
  return [
    { key: 'lr', label: 'Logistic regression on the cues', correct: out.lr },
    { key: 'nb', label: 'Naive Bayes on the cues', correct: out.nb },
    { key: 'knn', label: '11-nearest-neighbour on the cues', correct: out.knn },
  ];
}

/** Which cues drive your answers vs the truth vs a chosen model (standardised logistic coefficients). */
export function cueWeights(s: Session, data: Dataset, byId: Map<number, Item>, model = 'mpnn_delta') {
  const X = standardiser(data.items);
  const ts = s.trials.filter((t) => byId.has(t.item_id));
  if (ts.length < 24) return null;
  const xs = ts.map((t) => X(byId.get(t.item_id)!));
  const have = ts.every((t) => byId.get(t.item_id)!.calls[model] !== undefined);
  return {
    names: FEATURE_NAMES.map((f) => f.label),
    you: fitLogReg(xs, ts.map((t) => t.response)),
    truth: fitLogReg(xs, ts.map((t) => t.label)),
    model: have ? fitLogReg(xs, ts.map((t) => byId.get(t.item_id)!.calls[model])) : null,
    modelName: model,
  };
}

/** Accuracy split by a property of the item: you vs chosen models. */
export function byCue(s: Session, byId: Map<number, Item>, models: string[]) {
  const splits: { label: string; groups: [string, (v: Item) => boolean][] }[] = [
    { label: 'Interface size', groups: [['small (under 50 residues)', (v) => v.complex.n_interface < 50], ['large', (v) => v.complex.n_interface >= 50]] },
    { label: 'Clashing atoms', groups: [['none', (v) => v.f.clashes === 0], ['one or more', (v) => v.f.clashes > 0]] },
    { label: 'Buried area', groups: [['under 800 A^2', (v) => v.f.bsa < 800], ['800 A^2 or more', (v) => v.f.bsa >= 800]] },
    { label: 'Smaller chain', groups: [['under 100 residues', (v) => Math.min(...v.complex.chains.map((c) => c.n)) < 100], ['100 or more', (v) => Math.min(...v.complex.chains.map((c) => c.n)) >= 100]] },
  ];
  return splits.map((sp) => ({
    label: sp.label,
    rows: sp.groups.map(([name, pred]) => {
      const ts = s.trials.filter((t) => byId.has(t.item_id) && pred(byId.get(t.item_id)!));
      return { name, n: ts.length, you: acc(ts), models: Object.fromEntries(models.map((m) => [m, modelAccuracy(ts, byId, m)])) };
    }),
  }));
}

/** Does spending longer looking pay off? Accuracy by quartile of time spent on the trial. */
export function byLookTime(s: Session) {
  const ts = s.trials.filter((t) => t.rt_ms > 0);
  if (ts.length < 16) return [];
  const sorted = ts.slice().sort((a, b) => a.rt_ms - b.rt_ms);
  const q = Math.ceil(sorted.length / 4);
  return [0, 1, 2, 3].map((i) => {
    const part = sorted.slice(i * q, (i + 1) * q);
    return {
      name: ['fastest quarter', 'second quarter', 'third quarter', 'slowest quarter'][i],
      n: part.length, acc: acc(part), rt: median(part.map((t) => t.rt_ms)),
      views: median(part.map((t) => t.view_actions)),
    };
  }).filter((r) => r.n > 0);
}

// ── model profile: which models answer like you? ──

export interface ModelResemblance { name: string; label: string; kind: string; agree: number; kappa: number; sharedErrors: number | null; accuracy: number }

/** Agreement with each model on your trials: raw %, Cohen's κ (beyond chance), and share of your mistakes the model also made. */
export function modelProfile(s: Session, byId: Map<number, Item>, models: { name: string; label: string; kind: string }[]): ModelResemblance[] {
  const ts = s.trials.filter((t) => byId.has(t.item_id));
  const n = ts.length;
  if (n < 16) return [];
  const you = ts.map((t) => t.response);
  const pYou1 = you.filter((x) => x === 1).length / n;
  const wrong = ts.filter((t) => !t.correct);
  return models.map((m) => {
    const calls = ts.map((t) => byId.get(t.item_id)!.calls[m.name]);
    const agree = calls.filter((c, i) => c === you[i]).length / n;
    const pM1 = calls.filter((c) => c === 1).length / n;
    const pe = pYou1 * pM1 + (1 - pYou1) * (1 - pM1);
    return {
      name: m.name, label: m.label, kind: m.kind, agree,
      kappa: pe >= 1 ? 0 : (agree - pe) / (1 - pe),
      sharedErrors: wrong.length ? wrong.filter((t) => byId.get(t.item_id)!.calls[m.name] === t.response).length / wrong.length : null,
      accuracy: calls.filter((c, i) => c === ts[i].label).length / n,
    };
  }).sort((a, b) => b.kappa - a.kappa);
}
