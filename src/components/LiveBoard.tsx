import { useState } from 'react';
import type { Item, ModelInfo } from '../lib/types';

const short = (l: string) => l.replace(' (sees what you see)', '').replace(/ \((ipTM|interface pLDDT|interface fit|sequence given backbone|sequence only)\)/, '');
const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const RIVAL_KEY = 'bind.rival';

export function loadRival(models: ModelInfo[]): string {
  try { const r = localStorage.getItem(RIVAL_KEY); if (r && models.some((m) => m.name === r)) return r; } catch { /* storage blocked */ }
  return models.some((m) => m.name === 'boltz2') ? 'boltz2' : models[models.length - 1].name;
}
function saveRival(name: string) { try { localStorage.setItem(RIVAL_KEY, name); } catch { /* storage blocked */ } }

interface Row { name: string; label: string; all: number | null; recent: number | null; you?: boolean }

/** Accuracy of you and every model on exactly the mutations answered so far (overall and over the last `window`). */
export function boardRows(seen: Item[], correct: boolean[], models: ModelInfo[], window: number): Row[] {
  const n = seen.length, r0 = Math.max(0, n - window);
  const mean = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
  const rows: Row[] = [{ name: 'you', label: 'You', all: mean(correct), recent: mean(correct.slice(r0)), you: true }];
  for (const m of models) {
    const hits = seen.map((v) => v.calls[m.name] === v.label);
    rows.push({ name: m.name, label: short(m.label), all: mean(hits), recent: mean(hits.slice(r0)) });
  }
  return rows;
}

/** Live scoreboard: you vs a rival model of your choice, overall and last N, plus your rank among all models. */
export function LiveBoard({ seen, correct, models, window = 10 }: { seen: Item[]; correct: boolean[]; models: ModelInfo[]; window?: number }) {
  const [rival, setRival] = useState(() => loadRival(models));
  const [open, setOpen] = useState(false);
  const rows = boardRows(seen, correct, models, window);
  const you = rows[0], riv = rows.find((r) => r.name === rival) ?? rows[rows.length - 1];
  const ranked = rows.slice().sort((a, b) => (b.all ?? 0) - (a.all ?? 0) || (a.you ? -1 : b.you ? 1 : 0));
  const rank = seen.length ? 1 + rows.filter((r) => !r.you && (r.all ?? 0) > (you.all ?? 0)).length : null;
  const lead = you.all != null && riv.all != null ? Math.round((you.all - riv.all) * 100) : null;
  const pick = (name: string) => { setRival(name); saveRival(name); };
  const cell = (v: number | null, other: number | null) => (
    <td className={`num ${v != null && other != null && v > other ? 'ahead' : ''}`}>
      <div className="lb-cell"><span className="lb-bar"><span style={{ width: `${(v ?? 0) * 100}%` }} /></span><b>{pct(v)}</b></div>
    </td>
  );
  return (
    <div className="board" onKeyDown={(e) => e.stopPropagation()}>
      <table>
        <thead><tr><th /><th className="num">Overall</th><th className="num">Last {Math.min(window, Math.max(seen.length, 1))}</th></tr></thead>
        <tbody>
          <tr className="lb-you"><td>You</td>{cell(you.all, riv.all)}{cell(you.recent, riv.recent)}</tr>
          <tr className="lb-rival">
            <td>
              <select value={rival} onChange={(e) => { pick(e.target.value); e.target.blur(); }} title="Choose the model you're racing" tabIndex={-1}>
                {models.map((m) => <option key={m.name} value={m.name}>{short(m.label)}</option>)}
              </select>
            </td>
            {cell(riv.all, you.all)}{cell(riv.recent, you.recent)}
          </tr>
        </tbody>
      </table>
      <button className="lb-rank" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)} title="Show the full leaderboard">
        <span className="lb-rank-n">{rank == null ? '–' : `#${rank}`}</span>
        <span className="muted">of {rows.length}</span>
        {lead != null && <span className={lead > 0 ? 'good' : lead < 0 ? 'bad' : 'muted'}>{lead > 0 ? `+${lead}` : lead} pts</span>}
      </button>
      {open && (
        <div className="lb-pop" onClick={(e) => e.stopPropagation()}>
          <div className="lb-pop-head"><b>Leaderboard</b><span className="muted">on the {seen.length} complexes you've answered · tap a model to race it</span><button className="btn btn-sm" tabIndex={-1} onClick={() => setOpen(false)}>Close</button></div>
          <table className="data">
            <thead><tr><th>#</th><th>Player</th><th className="num">Overall</th><th className="num">Last {window}</th></tr></thead>
            <tbody>{ranked.map((r, i) => (
              <tr key={r.name} className={`${r.you ? 'lb-you' : ''} ${r.name === rival ? 'lb-rival' : ''}`} onClick={() => !r.you && pick(r.name)} style={{ cursor: r.you ? 'default' : 'pointer' }}>
                <td className="muted">{i + 1}</td><td>{r.you ? <b>You</b> : r.label}{r.name === rival && <span className="muted"> · rival</span>}</td>
                <td className="num"><b>{pct(r.all)}</b></td><td className="num">{pct(r.recent)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
