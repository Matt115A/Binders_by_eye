import { useState } from 'react';
import { loadLocal } from '../lib/export';
import { LevelToggle, useLevel } from '../lib/level';
import { clearAllAttempts, type HistoryEntry, latestSession, loadArchived, removeFromHistory } from '../lib/history';
import { type Config, type Dataset, type Session } from '../lib/types';

const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const KIND_LABEL: Record<string, string> = { folding: 'folds the complex from sequence', structure: 'scores the structure you see', plm: 'sequence only', simple: 'simple rule' };

export function Setup({ data, initial, history, debug, onStart, onSimulate, onOpenSession, onHistoryChange }: {
  data: Dataset; initial: Config; history: HistoryEntry[]; debug: boolean; onStart: (c: Config) => void; onSimulate: (c: Config) => void; onOpenSession: (s: Session) => void; onHistoryChange: (h: HistoryEntry[]) => void;
}) {
  const [c] = useState<Config>(initial);
  const [level, setLevel] = useLevel();
  const [keysText, setKeysText] = useState(initial.keys.join(''));
  const [last] = useState(() => loadLocal());
  const mine = latestSession(history, last);
  const keys = keysText.toUpperCase().replace(/\s+/g, '').split('');
  const cfg: Config = { ...c, keys: [keys[0] ?? 'F', keys[1] ?? 'J'] };
  const valid = keys.length === 2 && keys[0] !== keys[1];
  const seenPdbs = new Set(history.flatMap((h) => h.pdbs));
  const left = data.complexes.filter((x) => !seenPdbs.has(x.pdb)).length;
  return (
    <div className="screen">
      <div className="setup" style={{ width: 'min(980px, 100%)' }}>
        <div className="setup-top"><a className="bioai-link" href="https://matt115a.github.io/BioAI_by_eye/">PART OF BIOAI BY EYE →</a><LevelToggle level={level} onChange={setLevel} /></div>
        <h1 className="title">Binders by eye</h1>
        <p className="subtitle">{level === 'learner'
          ? 'You will see two proteins, touching. Do they really bind, or has someone scrambled the amino acids of the joint? Look around and decide, then see whether the AI did better.'
          : `Two-chain complexes from the PDB released after Boltz-2's training cutoff, against decoys with ${Math.round(data.mut_fraction * 100)}% of interface positions randomised using static replacement. Scored against Boltz-2, ProteinMPNN and sequence-only baselines.`}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '2px 0 22px' }}><button className="btn btn-primary" disabled={!valid || left === 0} onClick={() => onStart(cfg)} style={{ padding: '12px 34px', fontSize: 16 }}>Start</button><button className="btn" disabled={!mine} title={mine ? 'Your results so far, as at the end of a game' : 'Play a game first to see your stats'} onClick={() => mine && onOpenSession(mine)} style={{ padding: '12px 22px', fontSize: 16 }}>Your stats</button><a className="btn" href="https://substack.com/@mattpenner/note/p-224368016?r=4nmn57&utm_source=notes-share-action&utm_medium=web" target="_blank" rel="noreferrer" style={{ padding: '12px 22px', fontSize: 16, color: 'var(--text)', textDecoration: 'none' }}>Read the blog</a></div>

        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="card-title">What is this?</h3>
          {level === 'learner' ? (
            <p className="card-sub" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
              Proteins do their jobs by sticking to each other, and they are fussy about it: the two surfaces have to fit like a
              handshake, oily patch against oily patch, positive against negative, with no gaps and nothing jammed where it does not
              belong. Every round of the game shows you two proteins in the exact position they were caught in by X-ray crystallography.
              Half the time that pair is real. The other half, <b>{Math.round(data.mut_fraction * 100)}% of the amino acids in the join
              have been swapped for random ones</b>, so the handshake no longer works, even though the overall pose still looks plausible.
              Have a look around, get your eye into the interface, and make the call. Predicting this is one of the headline jobs of modern
              protein AI, and as you play you are scored against those models building the future of drug discovery.
            </p>
          ) : (
            <p className="card-sub" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
              You are shown X-ray heterodimers (≤2.5 Å resolution, two protein chains, 40–450 residues each, no immunoglobulin folds) released on or
              after 2023-06-01, screened so that no pre-cutoff entry contains homologues of both chains at 30% identity, and
              deduplicated by 5-mer containment. Each complex yields a real item and a decoy in which {Math.round(data.mut_fraction * 100)}% of
              interface positions (any residue with a heavy atom within 5 Å of the partner) are mutated to a random non-cysteine
              residue. Both items are repacked from the crystal backbone with FASPR, so side-chain provenance is identical and only
              interface sequence differs. Ten interface descriptors (heuristics) shown are computed from the structure on screen and are the
              feature model's only input. You can use them too, if you like, and I promise some of them are useful!
            </p>
          )}
        </div>

        <Attempts history={history} last={last} total={data.complexes.length} onOpen={onOpenSession} onChange={onHistoryChange} />

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><div><h3 className="card-title">Who you are up against</h3>
            <p className="card-sub">Each model's accuracy over all {data.items.length} questions.</p></div></div>
          <div className="table-scroll"><table className="data">
            <thead><tr><th>Model</th><th>What it sees</th><th className="num">Accuracy</th></tr></thead>
            <tbody>{data.models.map((m) => <tr key={m.name}><td>{m.label}</td><td className="muted">{KIND_LABEL[m.kind]}</td><td className="num"><b>{pct(m.accuracy)}</b></td></tr>)}</tbody>
          </table></div>
          <p className="note">Chance is 50%: items are balanced, and every model's score is cut at its own median so it calls half of them real.</p>
        </div>

        <div className="setup-grid keys-field" style={{ gridTemplateColumns: 'minmax(220px, 280px)', justifyContent: 'center' }}>
          <div className="field"><label>Keys: fake · real</label><input type="text" value={keysText} maxLength={2} onChange={(e) => setKeysText(e.target.value.toUpperCase())} /></div>
        </div>
        {debug && <div className="debug-panel"><h4>DEBUG</h4><button className="btn btn-sm" onClick={() => onSimulate(cfg)}>Simulate full session</button></div>}
        <p className="save-note" style={{ margin: '14px auto 0' }}>
          <b>You don't have to finish in one sitting.</b> Pause at any point (<kbd>Esc</kbd>, or the Pause button on a phone) and choose <b>Stop &amp; save</b>, or just close the tab;
          your answers are saved in this browser every few complexes. When you come back they're listed under <b>Your attempts</b>, and your next run carries on with complexes you haven't seen yet.
        </p>
        {last && !history.some((h) => h.session_id === last.meta.session_id) && <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn btn-sm" onClick={() => onOpenSession(last)}>Open last session ({last.trials.length} trials)</button></div>}
        {left === 0 && <p className="note bad" style={{ textAlign: 'center' }}>You have seen every complex. Clear your attempts above to start again.</p>}
        <button className="btn btn-primary" disabled={!valid || left === 0} onClick={() => onStart(cfg)} style={{ display: 'block', width: '100%', padding: '14px 26px', fontSize: 17, marginTop: 22 }}>Start</button>
        <p className="note" style={{ marginTop: 22 }}>
          Structures from the <a href="https://www.rcsb.org" target="_blank" rel="noreferrer">RCSB PDB</a>; side chains rebuilt with
          <a href="https://github.com/tommyhuangthu/FASPR" target="_blank" rel="noreferrer"> FASPR</a>. Benchmarks:
          <a href="https://github.com/jwohlwend/boltz" target="_blank" rel="noreferrer"> Boltz-2</a>,
          <a href="https://github.com/dauparas/ProteinMPNN" target="_blank" rel="noreferrer"> ProteinMPNN</a>.
          Source, credits and method: <a href="https://github.com/Matt115A/Binders_by_eye" target="_blank" rel="noreferrer">github.com/Matt115A/Binders_by_eye</a>.
        </p>
      </div>
    </div>
  );
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Past attempts on this device: re-open, remove one, or clear everything and start fresh. Confirmations are inline (no browser dialogs). */
function Attempts({ history, last, total, onOpen, onChange }: { history: HistoryEntry[]; last: Session | null; total: number; onOpen: (s: Session) => void; onChange: (h: HistoryEntry[]) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);   // session id, or 'all'
  const [cleared, setCleared] = useState(false);
  const seen = new Set(history.flatMap((h) => h.pdbs)).size;
  if (!history.length) return cleared ? <p className="note attempts-cleared">✓ Cleared. Every complex is available again. Press Start for a fresh run.</p> : null;
  const sessionFor = (id: string) => loadArchived(id) ?? (last?.meta.session_id === id ? last : null);
  return (
    <div className="card attempts" style={{ marginBottom: 18 }}>
      <div className="card-head"><div>
        <h3 className="card-title">Your attempts</h3>
        <p className="card-sub">{history.length} on this device · {seen} of {total} complexes used. A complex is never shown twice, in either version, because the two share a backbone. Clear your attempts to start from scratch.</p>
      </div></div>
      <div className="table-scroll"><table className="data">
        <thead><tr><th>#</th><th>When</th><th className="num">Complexes</th><th className="num">Accuracy</th><th /></tr></thead>
        <tbody>{history.slice().reverse().map((h, i) => {
          const s = sessionFor(h.session_id);
          return (
            <tr key={h.session_id}>
              <td className="muted">{history.length - i}</td><td>{fmtWhen(h.start_time)}</td><td className="num">{h.n_trials}</td><td className="num"><b>{pct(h.final.acc)}</b></td>
              <td className="attempt-actions">{confirm === h.session_id ? (
                <><span className="muted">Remove this attempt?</span><button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-sm btn-danger" onClick={() => { setConfirm(null); onChange(removeFromHistory(h.session_id)); }}>Remove</button></>
              ) : (
                <>{s && <button className="btn btn-sm" onClick={() => onOpen(s)}>Open</button>}<button className="btn btn-sm btn-ghost" onClick={() => setConfirm(h.session_id)}>Remove</button></>
              )}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="attempts-foot">
        {confirm === 'all' ? (
          <div className="confirm-all">
            <span>Delete {history.length === 1 ? 'your attempt' : `all ${history.length} attempts`} from this browser? Download any session you want to keep first (Open → Session JSON). This can't be undone.</span>
            <div className="row"><button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-sm btn-danger" onClick={() => { setConfirm(null); setCleared(true); onChange(clearAllAttempts()); }}>Clear all</button></div>
          </div>
        ) : <button className="btn btn-sm btn-ghost" onClick={() => setConfirm('all')}>Clear all &amp; start fresh</button>}
      </div>
    </div>
  );
}
