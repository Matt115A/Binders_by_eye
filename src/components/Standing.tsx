import { useEffect, useMemo, useState } from 'react';
import { type Contribution, fetchPeers, type Peer, standing } from '../lib/bioai';

/** Shared by every game (keep the copies identical). Your contributed datapoint against every other player's:
 *  score on x, questions answered on y, both log scales, with your percentile on each. */
export function Standing({ mine, score }: { mine: Contribution; score: (item: number, response: string) => number | null }) {
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchPeers(mine.game, mine.dataset_version).then((p) => live && setPeers(p)).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [mine.game, mine.dataset_version, mine.n]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const st = useMemo(() => (peers ? standing(peers, mine, score) : null), [peers, mine.n]);
  const [hover, setHover] = useState<number | null>(null);

  if (err) return <div className="standing"><p className="note">Couldn't load other players just now ({err}).</p></div>;
  if (!st) return <div className="standing"><p className="note">Loading where you stand…</p></div>;

  // log-log axes; scores of 0 are drawn at the floor of the axis
  const all = [st.me, ...st.others];
  const sMin = Math.max(0.01, Math.min(...all.map((p) => p.score)) * 0.85), sMax = Math.min(1, Math.max(sMin * 1.5, ...all.map((p) => p.score)) * 1.15);
  const nMin = Math.max(1, Math.min(...all.map((p) => p.n)) * 0.8), nMax = Math.max(...all.map((p) => p.n)) * 1.25;
  const W = 560, H = 300, L = 52, R = 16, T = 14, B = 40;
  const lx = (v: number) => L + ((Math.log(Math.max(v, sMin)) - Math.log(sMin)) / (Math.log(sMax) - Math.log(sMin))) * (W - L - R);
  const ly = (v: number) => H - B - ((Math.log(v) - Math.log(nMin)) / (Math.log(nMax) - Math.log(nMin))) * (H - T - B);
  /** keep ticks at least `gap` px apart, so log-compressed labels never collide */
  const thin = (vs: number[], at: (v: number) => number, gap: number) => vs.reduce<number[]>((k, v) => (!k.length || Math.abs(at(v) - at(k[k.length - 1])) >= gap ? [...k, v] : k), []);
  const xt = thin([0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((v) => v >= sMin && v <= sMax), lx, 42);
  const yt = thin([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter((v) => v >= nMin && v <= nMax), ly, 22);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const ord = (v: number) => { const r = Math.round(v), t = r % 100; return `${r}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] ?? 'th'}`; };
  const tip = hover == null ? null : hover < 0 ? st.me : st.others[hover];

  return (
    <div className="standing">
      <div className="standing-head">
        <b>Where you stand</b>
        <span className="muted">{st.others.length ? `against ${st.others.length} other player${st.others.length === 1 ? '' : 's'}` : 'you are the first to contribute'}</span>
      </div>
      <div className="standing-kpis">
        <div><span className="muted">Score</span><b>{pct(st.me.score)}</b><span>{st.scorePct == null ? '–' : `${ord(st.scorePct)} percentile`}</span></div>
        <div><span className="muted">Questions answered</span><b>{st.me.n}</b><span>{st.nPct == null ? '–' : `${ord(st.nPct)} percentile`}</span></div>
      </div>
      <svg className="standing-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Your score ${pct(st.me.score)} and ${st.me.n} questions answered, against ${st.others.length} other players`} onMouseLeave={() => setHover(null)}>
        {xt.map((v) => <g key={`x${v}`}><line x1={lx(v)} x2={lx(v)} y1={T} y2={H - B} className="grid" /><text x={lx(v)} y={H - B + 16} textAnchor="middle">{pct(v)}</text></g>)}
        {yt.map((v) => <g key={`y${v}`}><line x1={L} x2={W - R} y1={ly(v)} y2={ly(v)} className="grid" /><text x={L - 8} y={ly(v) + 4} textAnchor="end">{v}</text></g>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="axis-title">Score (log scale)</text>
        <text transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">Questions answered (log scale)</text>
        {st.others.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <circle cx={lx(p.score)} cy={ly(p.n)} r={11} fill="transparent" />
            <circle cx={lx(p.score)} cy={ly(p.n)} r={hover === i ? 5.5 : 4.5} className="dot-other" />
          </g>
        ))}
        <g onMouseEnter={() => setHover(-1)}>
          <circle cx={lx(st.me.score)} cy={ly(st.me.n)} r={13} fill="transparent" />
          <circle cx={lx(st.me.score)} cy={ly(st.me.n)} r={7} className="dot-me" />
          <text x={lx(st.me.score) + (lx(st.me.score) > W - 90 ? -12 : 12)} y={ly(st.me.n) + 4} textAnchor={lx(st.me.score) > W - 90 ? 'end' : 'start'} className="me-label">You</text>
        </g>
        {tip && (() => {
          const x = lx(tip.score), y = ly(tip.n), w = 150, left = x + w + 14 > W ? x - w - 10 : x + 10, top = Math.max(T, Math.min(y - 40, H - B - 44));
          return <g pointerEvents="none"><rect x={left} y={top} width={w} height={40} rx={8} className="tip" />
            <text x={left + 10} y={top + 17} className="tip-text">{hover! < 0 ? 'You' : 'Another player'}</text>
            <text x={left + 10} y={top + 32} className="tip-sub">{pct(tip.score)} · {tip.n} answered</text></g>;
        })()}
      </svg>
      <p className="note">Each grey dot is another player's anonymous datapoint for this game. Percentiles give the share of other players you are ahead of.</p>
    </div>
  );
}
