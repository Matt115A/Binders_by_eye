/**
 * One trial shows two protein chains in their crystal docked pose. Either they are a real complex from the
 * PDB, or half the residues at their interface have been replaced at random. The player decides which.
 */
export type Label = 0 | 1;          // 1 = real binders, 0 = faked interface
export type Group = 'learn' | 'new';
export type FeedbackMode = 'none' | 'correctness' | 'reveal';

export interface PhaseSpec {
  name: string;
  label: string;
  trials: number;
  group: Group;
  /** reveal = right/wrong, the PDB entry behind the complex, and what each model said. */
  feedback: FeedbackMode;
  intro: string;
}

export interface Config {
  protocol: string;
  /** Keys for [fake, real]. */
  keys: [string, string];
  phases: PhaseSpec[];
  maxDurationMin: number;
  hudWindow: number;
  excludeSeen: boolean;
}

export const PRESETS: Record<string, { title: string; description: string; phases: PhaseSpec[] }> = {
  session1: {
    title: 'Session 1: learn, then new complexes',
    description: 'Learn on complexes with feedback after every answer, then judge complexes held out from the start.',
    phases: [
      { name: 'learn', label: 'Learning', trials: 40, group: 'learn', feedback: 'reveal',
        intro: 'Part 1 of 2: learning.\nTwo protein chains, shown exactly as they sit in a crystal structure. Either they really do bind each other, or half the amino acids at their interface have been swapped at random.\nFly around the pair, look into the interface, then call it. After each answer you see the truth, the real structure behind it, and what the AI models said.' },
      { name: 'new', label: 'New complexes', trials: 20, group: 'new', feedback: 'reveal',
        intro: 'Part 2 of 2: complexes held back from the start.\nSame task. Use what you learned.' },
    ],
  },
};

export const DEFAULT_CONFIG: Config = {
  protocol: 'session1',
  keys: ['F', 'J'],
  phases: PRESETS.session1.phases,
  maxDurationMin: 60,
  hudWindow: 10,
  excludeSeen: true,
};

/** Interface biophysics, read off the docked structure: the cues shown to the player and to the feature model. */
export interface Features {
  bsa: number;
  n_contacts: number;
  clashes: number;
  hbonds: number;
  salt_bridges: number;
  hydrophobic: number;
  unsat_polar: number;
  charge_product: number;
  packing: number;
  gap_volume: number;
}

export interface ChainInfo { chain: string; desc: string; organism: string | null; n: number; seq: string }

export interface Complex {
  pdb: string;
  title: string;
  released: string;
  resolution: number;
  group: Group;
  n_interface: number;
  chains: ChainInfo[];
}

export interface Item {
  id: number;
  /** Structure file name (public/data/structures/{key}.pdb). */
  key: string;
  /** The PDB entry this came from; both halves of a pair share it. */
  pdb: string;
  complex: Complex;
  kind: 'real' | 'fake';
  label: Label;
  n_mut: number;
  /** Mutations as "A:K34E", empty for a real complex. Only ever shown after an answer. */
  muts: string[];
  iface: { chain: string; i: number }[];
  f: Features;
  calls: Record<string, Label>;
  scores: Record<string, number | null>;
}

export interface ModelInfo {
  name: string;
  label: string;
  /** folding = predicts the complex from sequence; structure = scores the given structure; plm = sequence only. */
  kind: 'simple' | 'structure' | 'plm' | 'folding';
  threshold: number;
  accuracy: number;
}

export interface Dataset {
  version: string;
  source: string;
  mut_fraction: number;
  models: ModelInfo[];
  complexes: Complex[];
  items: Item[];
}

export interface TrialRecord {
  trial: number;
  timestamp: string;
  elapsed_ms: number;
  phase: string;
  feedback: FeedbackMode;
  block: number;
  item_id: number;
  pdb: string;
  group: Group;
  kind: 'real' | 'fake';
  label: Label;
  response: Label;
  pressed_key: string;
  correct: boolean;
  rt_ms: number;
  rolling_accuracy: number | null;
  /** Seconds the player spent moving the camera before answering, and how many view actions they took. */
  look_ms: number;
  view_actions: number;
  onset_perf_ms: number;
  response_perf_ms: number;
}

export interface PriorExperience { sessions: number; trials: number; session_ids: string[]; excluded_complexes: number }

export interface SessionMeta {
  app: string;
  app_version: string;
  session_id: string;
  seed: number;
  simulated: boolean;
  config: Config;
  dataset_version: string;
  phase_starts?: Record<string, number>;
  prior?: PriorExperience;
  start_time: string;
  end_time: string | null;
  end_reason: string | null;
  total_trials: number;
  active_duration_ms: number;
  paused_ms: number;
  environment: { user_agent: string; estimated_frame_ms: number | null; screen: string };
  timing_notes: string;
}

export interface Session { meta: SessionMeta; trials: TrialRecord[] }

export const CHAIN_COLOR: Record<string, string> = { A: '#3987e5', B: '#f2c230' };

export const AA_INFO: Record<string, { name: string; three: string; cls: 'hydrophobic' | 'aromatic' | 'polar' | 'positive' | 'negative' | 'special' }> = {
  A: { name: 'Alanine', three: 'Ala', cls: 'hydrophobic' },
  R: { name: 'Arginine', three: 'Arg', cls: 'positive' },
  N: { name: 'Asparagine', three: 'Asn', cls: 'polar' },
  D: { name: 'Aspartate', three: 'Asp', cls: 'negative' },
  C: { name: 'Cysteine', three: 'Cys', cls: 'special' },
  Q: { name: 'Glutamine', three: 'Gln', cls: 'polar' },
  E: { name: 'Glutamate', three: 'Glu', cls: 'negative' },
  G: { name: 'Glycine', three: 'Gly', cls: 'special' },
  H: { name: 'Histidine', three: 'His', cls: 'positive' },
  I: { name: 'Isoleucine', three: 'Ile', cls: 'hydrophobic' },
  L: { name: 'Leucine', three: 'Leu', cls: 'hydrophobic' },
  K: { name: 'Lysine', three: 'Lys', cls: 'positive' },
  M: { name: 'Methionine', three: 'Met', cls: 'hydrophobic' },
  F: { name: 'Phenylalanine', three: 'Phe', cls: 'aromatic' },
  P: { name: 'Proline', three: 'Pro', cls: 'special' },
  S: { name: 'Serine', three: 'Ser', cls: 'polar' },
  T: { name: 'Threonine', three: 'Thr', cls: 'polar' },
  W: { name: 'Tryptophan', three: 'Trp', cls: 'aromatic' },
  Y: { name: 'Tyrosine', three: 'Tyr', cls: 'aromatic' },
  V: { name: 'Valine', three: 'Val', cls: 'hydrophobic' },
};

export const CLASS_COLOR: Record<string, string> = {
  hydrophobic: '#c98500', aromatic: '#e87ba4', polar: '#199e70', positive: '#3987e5', negative: '#ef5350', special: '#9a9a90',
};
