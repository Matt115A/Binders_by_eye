import { freshSeed, makeRng, type Rng, shuffle } from './rng';
import type { Config, Dataset, Item, Label, PhaseSpec, PriorExperience, Session, SessionMeta, TrialRecord } from './types';

export const APP_VERSION = '1.0.0';

export interface ResponseInput {
  it: Item; block: number; pressedKey: string; /** set for taps/clicks; otherwise derived from the key */ label?: Label;
  rtMs: number; lookMs: number; viewActions: number; onsetPerf: number; responsePerf: number; wallOnset: Date; elapsedMs: number;
}

/**
 * Experiment rules, no DOM. Parts run in order and draw from their group of complexes in blocks of 8
 * (4 real + 4 fake), without replacement.
 *
 * One item per complex, ever: the real and the fake share a backbone, so a player who saw one would
 * recognise the fold in the other and answer from memory instead of from the interface. Complexes used in
 * earlier sessions on this device are excluded too, which is why history stores PDB ids rather than item ids.
 */
export class SessionCore {
  readonly config: Config;
  readonly meta: SessionMeta;
  readonly trials: TrialRecord[] = [];
  phaseIdx = 0;
  private inPhase = 0;
  private rng: Rng;
  private block = 0;
  private queue: Label[] = [];
  /** Complexes still available, per group, shuffled. */
  private pools = new Map<string, string[]>();
  private byPdb = new Map<string, Item[]>();
  private used = new Set<string>();

  constructor(config: Config, data: Dataset, opts: { seed?: number; simulated?: boolean; startTime?: Date; exclude?: Set<string>; prior?: PriorExperience } = {}) {
    this.config = structuredClone(config);
    const seed = opts.seed ?? freshSeed();
    this.rng = makeRng(seed);
    const ex = config.excludeSeen ? opts.exclude ?? new Set<string>() : new Set<string>();
    for (const it of data.items) {
      if (!this.byPdb.has(it.pdb)) this.byPdb.set(it.pdb, []);
      this.byPdb.get(it.pdb)!.push(it);
    }
    for (const c of shuffle(data.complexes.filter((c) => !ex.has(c.pdb)), this.rng)) {
      if (!this.pools.has(c.group)) this.pools.set(c.group, []);
      this.pools.get(c.group)!.push(c.pdb);
    }
    const start = opts.startTime ?? new Date();
    this.meta = {
      app: 'binders', app_version: APP_VERSION, session_id: `${start.toISOString().replace(/[:.]/g, '-')}_${seed.toString(16)}`,
      seed, simulated: !!opts.simulated, config: this.config, dataset_version: data.version,
      phase_starts: { [config.phases[0].name]: 1 }, prior: opts.prior ?? { sessions: 0, trials: 0, session_ids: [], excluded_complexes: 0 },
      start_time: start.toISOString(), end_time: null, end_reason: null, total_trials: 0, active_duration_ms: 0, paused_ms: 0,
      environment: { user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node', estimated_frame_ms: null, screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'n/a' },
      timing_notes: 'Onset = first animation frame after the structure finished drawing; response = keydown (or tap/click) timeStamp. look_ms is time spent with the camera moving. Trials are self-paced, so RT is a rough measure.',
    };
  }

  get phase(): PhaseSpec | null { return this.config.phases[this.phaseIdx] ?? null; }
  get done() { return this.phaseIdx >= this.config.phases.length; }

  keyToLabel(key: string): Label | null {
    const i = this.config.keys.indexOf(key.toUpperCase() as never);
    return i === 0 ? 0 : i === 1 ? 1 : null;
  }

  /** How many trials each part can still be given, after exclusions. */
  available(group: string): number { return this.pools.get(group)?.length ?? 0; }

  /** Structure keys the next few trials will need, so they can be fetched ahead of time. */
  upcoming(n: number): string[] {
    const pool = this.pools.get(this.phase?.group ?? '') ?? [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      for (const it of this.byPdb.get(pool[i]) ?? []) out.push(it.key);   // either half may come up
    }
    return out;
  }

  nextStimulus(): { it: Item; block: number } | null {
    if (!this.phase) return null;
    const pool = this.pools.get(this.phase.group) ?? [];
    if (!pool.length) return null;
    if (!this.queue.length) { this.queue = shuffle([0, 0, 0, 0, 1, 1, 1, 1] as Label[], this.rng); this.block++; }
    const want = this.queue.shift()!;
    const pdb = pool.shift()!;
    this.used.add(pdb);
    const items = this.byPdb.get(pdb) ?? [];
    const it = items.find((x) => x.label === want) ?? items[0];
    return it ? { it, block: this.block } : null;
  }

  liveAccuracy(window: number): number | null {
    if (!this.phase || this.phase.feedback === 'none' || !this.inPhase) return null;
    const w = Math.min(window, this.inPhase);
    let c = 0;
    for (let i = this.trials.length - w; i < this.trials.length; i++) if (this.trials[i].correct) c++;
    return c / w;
  }

  record(r: ResponseInput): { trial: TrialRecord; next: PhaseSpec | null; finished: boolean } {
    const ph = this.phase!;
    const response = r.label ?? this.keyToLabel(r.pressedKey)!;
    const trial: TrialRecord = {
      trial: this.trials.length + 1, timestamp: r.wallOnset.toISOString(), elapsed_ms: Math.round(r.elapsedMs), phase: ph.name, feedback: ph.feedback,
      block: r.block, item_id: r.it.id, pdb: r.it.pdb, group: r.it.complex.group, kind: r.it.kind, label: r.it.label, response,
      pressed_key: r.pressedKey.toUpperCase(), correct: response === r.it.label, rt_ms: Math.round(r.rtMs), rolling_accuracy: null,
      look_ms: Math.round(r.lookMs), view_actions: r.viewActions,
      onset_perf_ms: Math.round(r.onsetPerf * 100) / 100, response_perf_ms: Math.round(r.responsePerf * 100) / 100,
    };
    this.trials.push(trial);
    this.inPhase++;
    const w = Math.min(20, this.inPhase);
    trial.rolling_accuracy = this.trials.slice(-w).filter((t) => t.correct).length / w;
    this.meta.total_trials = this.trials.length;
    if (this.inPhase >= ph.trials) {
      this.phaseIdx++; this.inPhase = 0; this.queue = [];
      const next = this.phase;
      if (next) this.meta.phase_starts![next.name] = trial.trial + 1;
      return { trial, next, finished: !next };
    }
    return { trial, next: null, finished: false };
  }

  endReason(activeMs: number): string | null {
    if (this.done) return 'protocol_complete';
    if (activeMs >= this.config.maxDurationMin * 60_000) return 'max_duration';
    return null;
  }

  finish(reason: string, activeMs: number, pausedMs: number, endTime = new Date()): Session {
    Object.assign(this.meta, { end_time: endTime.toISOString(), end_reason: reason, active_duration_ms: Math.round(activeMs), paused_ms: Math.round(pausedMs) });
    return this.snapshot();
  }
  snapshot(): Session { return { meta: structuredClone(this.meta), trials: this.trials.map((t) => ({ ...t })) }; }
}
