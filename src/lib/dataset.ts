import type { Complex, Dataset, Features, Item, Label, ModelInfo } from './types';

interface RawItem {
  id: number; key: string; pdb: string; kind: 'real' | 'fake'; y: Label; n_mut: number; muts: string[];
  iface: { chain: string; i: number }[]; f: Features; c: string; scores: Record<string, number | null>;
}
interface RawDataset {
  version: string; source: string; mut_fraction: number; models: ModelInfo[]; model_order: string[];
  complexes: Complex[]; items: RawItem[];
}

export async function loadDataset(base = `${import.meta.env.BASE_URL}data/`): Promise<Dataset> {
  const raw = (await fetch(base + 'dataset.json').then((r) => r.json())) as RawDataset;
  return parseDataset(raw);
}

export function parseDataset(raw: RawDataset): Dataset {
  const byPdb = new Map(raw.complexes.map((c) => [c.pdb, c]));
  const items: Item[] = raw.items.map((it) => ({
    id: it.id, key: it.key, pdb: it.pdb, complex: byPdb.get(it.pdb)!, kind: it.kind, label: it.y, n_mut: it.n_mut,
    muts: it.muts, iface: it.iface, f: it.f, scores: it.scores,
    calls: Object.fromEntries(raw.model_order.map((m, i) => [m, Number(it.c[i]) as Label])),
  }));
  return { version: raw.version, source: raw.source, mut_fraction: raw.mut_fraction, models: raw.models, complexes: raw.complexes, items };
}

const pdbCache = new Map<string, Promise<string>>();
export function loadStructure(key: string, base = `${import.meta.env.BASE_URL}data/structures/`): Promise<string> {
  if (!pdbCache.has(key)) {
    const p = fetch(`${base}${key}.pdb`).then((r) => { if (!r.ok) throw new Error(`structure ${key}: HTTP ${r.status}`); return r.text(); });
    p.catch(() => pdbCache.delete(key));   // a failed (pre)fetch must not poison the cache: try again next time
    pdbCache.set(key, p);
  }
  return pdbCache.get(key)!;
}

/** The replaced residues of a fake, as chain + 1-based index. Only ever shown after an answer. */
export function mutatedResidues(item: Item): { chain: string; i: number }[] {
  return item.muts.map((m) => {
    const [chain, rest] = m.split(':');
    return { chain, i: Number(rest.slice(1, -1)) };
  }).filter((r) => Number.isFinite(r.i));
}

/** Shortest description of a chain that gives nothing away about the label. */
export const chainName = (desc: string) => (desc || 'protein').replace(/\s*\(.*\)\s*$/, '').slice(0, 54);
