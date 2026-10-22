import { OnlineLogReg, standardiser } from './features';
import { makeRng, type Rng } from './rng';
import { SessionCore } from './session';
import type { Config, Dataset, Item, Label, PriorExperience, Session } from './types';

/** Toy player for debug runs and tests: noisy online logistic regression on the interface numbers. */
export class SimPlayer {
  private rng: Rng; private m: OnlineLogReg; private x: (v: Item) => number[];
  constructor(seed: number, all: Item[]) { this.rng = makeRng(seed); this.x = standardiser(all); this.m = new OnlineLogReg(this.x(all[0]).length, 0.04); }
  respond(it: Item): { label: Label; rt: number; look: number; actions: number } {
    const noisy = this.x(it).map((xi) => xi + (this.rng() - 0.5) * 1.1);
    const p = this.m.p(noisy);
    const label: Label = this.rng() < 0.07 ? (this.rng() < 0.5 ? 0 : 1) : this.rng() < p ? 1 : 0;
    const rt = 8000 + 30000 * this.rng() * (1 - Math.abs(p - 0.5));
    return { label, rt, look: rt * 0.7, actions: 1 + Math.floor(this.rng() * 12) };
  }
  learn(it: Item) { this.m.update(this.x(it), it.label); }
}

export function simulateSession(config: Config, data: Dataset, seed?: number, opts: { exclude?: Set<string>; prior?: PriorExperience } = {}): Session {
  const start = new Date();
  const core = new SessionCore(config, data, { seed, simulated: true, startTime: start, ...opts });
  const player = new SimPlayer(core.meta.seed ^ 0x9e37, data.items);
  let t = 0, perf = 1000, reason: string | null = null;
  while (!(reason = core.endReason(t))) {
    const ph = core.phase!;
    const s = core.nextStimulus();
    if (!s) { reason = 'pool_exhausted'; break; }
    const { label, rt, look, actions } = player.respond(s.it);
    core.record({ it: s.it, block: s.block, pressedKey: config.keys[label], rtMs: rt, lookMs: look, viewActions: actions, onsetPerf: perf, responsePerf: perf + rt, wallOnset: new Date(start.getTime() + t), elapsedMs: t });
    if (ph.feedback !== 'none') player.learn(s.it);
    const step = rt + 4000;
    t += step; perf += step;
  }
  return core.finish(reason, t, 0, new Date(start.getTime() + t));
}
