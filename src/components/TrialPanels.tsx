import type { HelpKey } from '../lib/help';
import { AA_INFO, CHAIN_COLOR, CLASS_COLOR, type Item, type ModelInfo } from '../lib/types';
import { Help } from './Help';

const int = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** During a trial the player is told only the sizes of the two chains: the identity would be searchable. */
export function TrialHeader({ item, trial }: { item: Item; trial: number }) {
  return (
    <div className="trial-header" data-tour="chains">
      <Help k="chains" block className="chain-pills">
        {item.complex.chains.map((c) => (
          <span key={c.chain} className="chain-pill" style={{ borderColor: CHAIN_COLOR[c.chain] }}>
            <i style={{ background: CHAIN_COLOR[c.chain] }} />Chain {c.chain}<b>{c.n} aa</b>
          </span>
        ))}
      </Help>
      <Help k="task" block className="trial-q">
        <span className="muted">Complex {trial}</span>
        <b>Do these two chains really bind?</b>
      </Help>
      <Help k="interface" block className="iface-pill">
        <span className="muted">Interface</span><b>{item.complex.n_interface} residues</b>
      </Help>
    </div>
  );
}

interface Row { label: string; help: HelpKey; value: string; hint?: string; good?: boolean | null }

/** The interface measurements, the same numbers the "sees what you see" feature model is given. */
export function InterfacePanel({ item }: { item: Item }) {
  const f = item.f;
  const rows: Row[] = [
    { label: 'Buried area', help: 'bsa', value: `${int(f.bsa)} Å²`, hint: f.bsa < 500 ? 'small contact' : f.bsa > 1400 ? 'large contact' : 'typical' },
    { label: 'Atom contacts', help: 'contacts', value: int(f.n_contacts) },
    { label: 'Clashing atoms', help: 'clashes', value: int(f.clashes), hint: f.clashes === 0 ? 'nothing overlapping' : 'atoms overlap', good: f.clashes === 0 },
    { label: 'Hydrogen bonds', help: 'hbonds', value: int(f.hbonds) },
    { label: 'Salt bridges', help: 'salt', value: int(f.salt_bridges), good: f.salt_bridges > 0 ? true : null },
    { label: 'Oily share of buried face', help: 'hydrophobic', value: pct(f.hydrophobic) },
    { label: 'Unpaired buried polars', help: 'unsat', value: int(f.unsat_polar) },
    { label: 'Charge complementarity', help: 'charge', value: f.charge_product === 0 ? 'neutral' : f.charge_product < 0 ? `+${int(-f.charge_product)} complementary` : `−${int(f.charge_product)} repelling`, good: f.charge_product < 0 ? true : f.charge_product > 0 ? false : null },
    { label: 'Packing density', help: 'packing', value: f.packing.toFixed(1) },
    { label: 'Looseness of the fit', help: 'gap', value: f.gap_volume.toFixed(1) },
  ];
  return (
    <section className="panel" data-tour="numbers">
      <h4><Help k="interface">The interface, measured</Help></h4>
      <div className="iface-grid">
        {rows.map((r) => (
          <div key={r.label} className="iface-row">
            <span className="iface-label"><Help k={r.help}>{r.label}</Help></span>
            <span className={`iface-val ${r.good === true ? 'good' : r.good === false ? 'bad' : ''}`}>{r.value}</span>
            {r.hint && <span className="iface-hint muted">{r.hint}</span>}
          </div>
        ))}
      </div>
      <p className="note">Measured off the structure in front of you. A model trained on exactly these ten numbers is one of the benchmarks.</p>
    </section>
  );
}

/** Shown only after an answer: the real entry, what was done to it, and every model's call. */
export function Reveal({ item, models, response }: { item: Item; models: ModelInfo[]; response: 0 | 1 }) {
  const c = item.complex;
  const kinds: Record<string, string> = { folding: 'folds it from sequence', structure: 'scores this structure', plm: 'sequence only', simple: 'simple rule' };
  return (
    <div className="reveal">
      <div className="reveal-head">
        <div>
          <div className="reveal-kind">{item.label === 1 ? <b className="good">Real complex</b> : <b className="bad">Faked interface</b>}
            {item.label === 0 && <span className="muted"> · {item.n_mut} of {c.n_interface} interface residues replaced at random</span>}</div>
          <div className="reveal-title">{c.title}</div>
          <div className="reveal-sub muted">
            {c.chains.map((ch) => `${ch.desc}${ch.organism ? ` (${ch.organism})` : ''}`).join('  +  ')}
          </div>
          <div className="reveal-sub muted">
            PDB <a href={`https://www.rcsb.org/structure/${c.pdb}`} target="_blank" rel="noreferrer">{c.pdb}</a>
            {' · '}{c.resolution.toFixed(2)} Å · released {c.released}
          </div>
        </div>
        <div className={`reveal-verdict ${response === item.label ? 'ok' : 'no'}`}>
          {response === item.label ? '✓ Correct' : '✗ Wrong'}
          <span className="muted">you said {response === 1 ? 'real' : 'fake'}</span>
        </div>
      </div>
      {item.muts.length > 0 && (
        <div className="muts">
          <span className="muted">Replaced:</span>
          {item.muts.map((m) => {
            const [chain, rest] = m.split(':');
            const wt = rest[0], mt = rest[rest.length - 1], pos = rest.slice(1, -1);
            return (
              <span key={m} className="mut" title={`chain ${chain}, position ${pos}: ${AA_INFO[wt]?.name} to ${AA_INFO[mt]?.name}`}>
                <span className="muted">{chain}</span>
                <b style={{ color: CLASS_COLOR[AA_INFO[wt]?.cls] }}>{wt}</b>{pos}<b style={{ color: CLASS_COLOR[AA_INFO[mt]?.cls] }}>{mt}</b>
              </span>
            );
          })}
        </div>
      )}
      <div className="model-calls" data-tour="models">
        <span className="muted model-calls-lab"><Help k="models">What the models said</Help></span>
        {models.map((m) => {
          const call = item.calls[m.name];
          const ok = call === item.label;
          return (
            <span key={m.name} className={`badge ${ok ? 'badge-good' : 'badge-bad'}`} title={`${m.label} — ${kinds[m.kind]}${item.scores[m.name] != null ? `; score ${item.scores[m.name]}` : ''}`}>
              {m.label.replace(/ \(.*\)$/, '')}: {call === 1 ? 'real' : 'fake'} {ok ? '✓' : '✗'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
