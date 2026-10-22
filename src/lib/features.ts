import type { Features, Item } from './types';

/** The interface numbers shown on screen, as a vector: the same cues a player can read off the panel. */
export const FEATURE_NAMES: { key: string; label: string; get: (f: Features) => number }[] = [
  { key: 'bsa', label: 'Buried area', get: (f) => f.bsa },
  { key: 'n_contacts', label: 'Atom contacts', get: (f) => f.n_contacts },
  { key: 'clashes', label: 'Clashing atoms', get: (f) => f.clashes },
  { key: 'hbonds', label: 'Hydrogen bonds', get: (f) => f.hbonds },
  { key: 'salt_bridges', label: 'Salt bridges', get: (f) => f.salt_bridges },
  { key: 'hydrophobic', label: 'Oily share of the buried face', get: (f) => f.hydrophobic },
  { key: 'unsat_polar', label: 'Unpaired buried polars', get: (f) => f.unsat_polar },
  { key: 'charge_product', label: 'Charge complementarity', get: (f) => -f.charge_product },
  { key: 'packing', label: 'Packing density', get: (f) => f.packing },
  { key: 'gap_volume', label: 'Looseness of the fit', get: (f) => -f.gap_volume },
];

export function standardiser(all: Item[]) {
  const X = all.map((v) => FEATURE_NAMES.map((n) => n.get(v.f)));
  const d = FEATURE_NAMES.length;
  const mean = Array(d).fill(0), sd = Array(d).fill(0);
  X.forEach((r) => r.forEach((x, j) => (mean[j] += x / X.length)));
  X.forEach((r) => r.forEach((x, j) => (sd[j] += (x - mean[j]) ** 2 / X.length)));
  sd.forEach((s, j) => (sd[j] = Math.sqrt(s) || 1));
  return (v: Item) => FEATURE_NAMES.map((n, j) => (n.get(v.f) - mean[j]) / sd[j]);
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Online logistic regression (SGD) — used by the simulated player and the same-experience learners. */
export class OnlineLogReg {
  w: number[]; b = 0;
  constructor(d: number, private lr = 0.05, private l2 = 1e-3) { this.w = Array(d).fill(0); }
  p(x: number[]) { return sigmoid(this.b + x.reduce((a, xi, j) => a + xi * this.w[j], 0)); }
  update(x: number[], y: number) {
    const g = this.p(x) - y;
    this.w = this.w.map((wj, j) => wj - this.lr * (g * x[j] + this.l2 * wj));
    this.b -= this.lr * g;
  }
}

/** Batch logistic regression (L2) — for "what drives your choices" coefficients. */
export function fitLogReg(X: number[][], y: number[], iters = 600, lr = 0.3, l2 = 0.01): number[] {
  const d = X[0]?.length ?? 0;
  let w = Array(d).fill(0), b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = Array(d).fill(0); let gb = 0;
    X.forEach((x, i) => { const g = sigmoid(b + x.reduce((a, xi, j) => a + xi * w[j], 0)) - y[i]; x.forEach((xi, j) => (gw[j] += g * xi)); gb += g; });
    w = w.map((wj, j) => wj - lr * (gw[j] / X.length + l2 * wj));
    b -= lr * gb / X.length;
  }
  return w;
}
