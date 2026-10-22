import { useMemo, useRef } from 'react';
import { modelProfile, type ModelResemblance } from '../lib/analysis';
import type { Dataset, Item, Session } from '../lib/types';
import { Bars, C, Card, Legend, useWidth } from './charts';

const KIND_COLOR: Record<string, string> = { simple: '#9cc3e6', structure: '#199e70', plm: '#c98500', folding: '#e87ba4' };
const KIND_LABEL: Record<string, string> = { simple: 'Simple rules', structure: 'Scores this structure', plm: 'Sequence only', folding: 'Folds it from sequence' };
const KIND_PHRASE: Record<string, string> = { simple: 'simple rules', structure: 'models that score the structure you saw', plm: 'sequence-only models', folding: 'models that fold the complex from sequence' };
const FONT = "Inter, -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
const short = (l: string) => l.replace(' (sees what you see)', '').replace(/ \((ipTM|interface pLDDT|interface fit|sequence given backbone|sequence only)\)/, '');
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);

export function ModelProfile({ session, data, byId }: { session: Session; data: Dataset; byId: Map<number, Item> }) {
  const models = data.models;
  const prof = useMemo(() => modelProfile(session, byId, models), [session, byId, models]);
  const refs = { map: useRef<SVGSVGElement>(null), rank: useRef<SVGSVGElement>(null), fam: useRef<SVGSVGElement>(null) };
  if (!prof.length) return <Card title="Your model profile"><div className="empty">Needs at least 16 answered complexes.</div></Card>;
  const twin = prof[0], far = prof[prof.length - 1];
  const fams = Object.keys(KIND_LABEL).map((k) => { const xs = prof.filter((p) => p.kind === k); return { k, kappa: xs.reduce((a, p) => a + p.kappa, 0) / (xs.length || 1) }; });
  const topFam = fams.slice().sort((a, b) => b.kappa - a.kappa)[0];
  return (
    <>
      <div className="twin-banner">
        <div className="twin-label">Your closest model</div>
        <div className="twin-name" style={{ color: KIND_COLOR[twin.kind] }}>{short(twin.label)}</div>
        <div className="twin-sub">
          You gave the same answer on <b>{pct(twin.agree)}</b> of complexes (κ = {twin.kappa.toFixed(2)}){twin.sharedErrors != null && <>, and it made <b>{pct(twin.sharedErrors)}</b> of your mistakes too</>}.
          Your style is closest to <b style={{ color: KIND_COLOR[topFam.k] }}>{KIND_PHRASE[topFam.k]}</b>; least like <b>{short(far.label)}</b>.
        </div>
      </div>
      <div className="grid2">
        <Card title="Your orbit: who thinks like you" svgRef={refs.map} exportName="model_orbit"
          sub="You are the star. Each model sits on its own spoke: the closer to you, the more its answers match yours on exactly the complexes you saw (Cohen's κ, agreement beyond chance). Dashed rings mark κ steps.">
          <Legend items={[{ name: 'You', color: C.yellow, square: true }, ...Object.entries(KIND_LABEL).map(([k, l]) => ({ name: l, color: KIND_COLOR[k], square: true }))]} />
          <OrbitPlot prof={prof} svgRef={refs.map} />
        </Card>
        <Card title="How much each model thinks like you" svgRef={refs.rank} exportName="model_resemblance"
          sub="Agreement beyond chance (Cohen's κ) between your answers and each model's, on the same complexes. 0 = no more alike than chance; 1 = identical answers.">
          <RankPlot prof={prof} svgRef={refs.rank} />
        </Card>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Card title="Family resemblance" svgRef={refs.fam} exportName="family_resemblance" sub="Your average resemblance (κ) to each family of models.">
          <Bars svgRef={refs.fam} label="Average κ with your answers" domain={[Math.min(0, ...fams.map((f) => f.kappa)), Math.max(0.3, ...fams.map((f) => f.kappa)) * 1.15]} format={(v) => v.toFixed(2)} height={250}
            bars={fams.map((f) => ({ label: KIND_LABEL[f.k], value: Math.max(0, f.kappa), color: KIND_COLOR[f.k] }))} />
        </Card>
        <Card title="Resemblance in numbers" sub="Shared mistakes = of the complexes you got wrong, the share where this model made the same wrong call, the strongest sign of thinking alike.">
          <table className="data" style={{ fontSize: 13 }}>
            <thead><tr><th>Model</th><th className="num">Same answer</th><th className="num">κ</th><th className="num">Shared mistakes</th><th className="num">Its accuracy</th></tr></thead>
            <tbody>{prof.map((p) => <tr key={p.name}><td><span style={{ color: KIND_COLOR[p.kind] }}>●</span> {short(p.label)}</td><td className="num">{pct(p.agree)}</td><td className="num"><b>{p.kappa.toFixed(2)}</b></td><td className="num">{pct(p.sharedErrors)}</td><td className="num muted">{pct(p.accuracy)}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

const COMPACT: Record<string, string> = { 'AlphaFold2-multimer': 'AF2', 'Feature model': 'Features', 'ProteinMPNN': 'MPNN', 'ESM2 650M': 'ESM2', 'Fewest clashing atoms': 'Clashes', 'Most hydrogen bonds': 'H-bonds', 'Largest buried area': 'Buried area' };
const FAMILY_ORDER = ['simple', 'plm', 'structure', 'folding'];

/** You at the centre; each model on its own spoke, closer in = answers more like you (higher κ). Spokes grouped by family. */
function OrbitPlot({ prof, svgRef }: { prof: ModelResemblance[]; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const compact = width < 520;   // phones: abbreviated labels, tighter label margin
  const R = Math.max(60, Math.min(175, width / 2 - (compact ? 78 : 130))), H = 2 * R + 80, cx = width / 2, cy = H / 2 + 4;
  const name = (l: string) => (compact ? COMPACT[short(l)] ?? short(l) : short(l));
  const top = Math.max(0.3, Math.ceil(Math.max(...prof.map((p) => p.kappa)) * 10 + 1) / 10), bot = Math.min(0, Math.floor(Math.min(...prof.map((p) => p.kappa)) * 10) / 10);
  const rOf = (k: number) => 14 + ((top - k) / (top - bot)) * (R - 14);
  const items = FAMILY_ORDER.flatMap((f) => prof.filter((p) => p.kind === f).sort((a, b) => b.kappa - a.kappa));
  const gap = 0.6, topGap = 2.2, slots = items.length + gap * (FAMILY_ORDER.length - 1) + topGap;   // wide gap at 12 o'clock holds the ring labels
  let cursor = topGap / 2, lastKind = items[0]?.kind;
  const placed = items.map((p) => {
    if (p.kind !== lastKind) { cursor += gap; lastKind = p.kind; }
    const a = -Math.PI / 2 + ((cursor + 0.5) / slots) * 2 * Math.PI; cursor += 1;
    return { ...p, a };
  });
  const ticks: number[] = []; for (let k = bot; k <= top + 1e-9; k += 0.1) ticks.push(Math.round(k * 10) / 10);
  const best = prof[0].name;
  return (
    <div className="chart-wrap" ref={wrap}>
      <svg ref={svgRef} width={width} height={H} fontFamily={FONT}>
        {ticks.map((k) => <circle key={k} cx={cx} cy={cy} r={rOf(k)} fill="none" stroke={k === 0 ? C.axis : C.grid} strokeDasharray={k === 0 ? undefined : '2 4'} />)}
        {ticks.map((k) => <text key={`t${k}`} x={cx} y={cy - rOf(k) - 3} textAnchor="middle" fill={C.muted} fontSize={10}>{k === 0 ? 'κ 0 = chance' : `κ ${k.toFixed(1)}`}</text>)}
        {placed.map((p) => {
          const r = rOf(p.kappa), x = cx + r * Math.cos(p.a), y = cy + r * Math.sin(p.a);
          const lx = cx + (R + 10) * Math.cos(p.a), ly = cy + (R + 10) * Math.sin(p.a);
          const c = Math.cos(p.a), anchor = c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle';
          const isBest = p.name === best;
          return (
            <g key={p.name}>
              <line x1={cx + 10 * Math.cos(p.a)} y1={cy + 10 * Math.sin(p.a)} x2={cx + R * Math.cos(p.a)} y2={cy + R * Math.sin(p.a)} stroke={C.grid} />
              {isBest && <line x1={cx} y1={cy} x2={x} y2={y} stroke={C.yellow} strokeWidth={1.5} strokeDasharray="4 3" />}
              <circle cx={x} cy={y} r={isBest ? 9 : 7} fill={KIND_COLOR[p.kind]} stroke={isBest ? C.yellow : C.surface} strokeWidth={isBest ? 2.5 : 2}><title>{`${short(p.label)}: κ ${p.kappa.toFixed(2)}, same answer ${pct(p.agree)}`}</title></circle>
              <text x={lx} y={ly + (Math.sin(p.a) > 0.6 ? 8 : Math.sin(p.a) < -0.6 ? -4 : 0)} dy="0.35em" textAnchor={anchor} fill={isBest ? C.text : C.text2} fontWeight={isBest ? 700 : 400} fontSize={compact ? 10.5 : 12}>{name(p.label)}</text>
            </g>
          );
        })}
        <path d={star(cx, cy, 13, 5.5)} fill={C.yellow} stroke={C.surface} strokeWidth={2} />
      </svg>
    </div>
  );
}

function star(cx: number, cy: number, r: number, r2: number) {
  return Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r2 : r; return `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`; }).join('') + 'Z';
}

function RankPlot({ prof, svgRef }: { prof: { name: string; label: string; kind: string; kappa: number }[]; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const rowH = 24, labelW = 150, top = 8, H = top + prof.length * rowH + 26;
  const lo = Math.min(0, ...prof.map((p) => p.kappa)), hi = Math.max(0.4, ...prof.map((p) => p.kappa));
  const X = (k: number) => labelW + ((k - lo) / (hi - lo)) * (width - labelW - 50);
  return (
    <div className="chart-wrap" ref={wrap}>
      <svg ref={svgRef} width={width} height={H} fontFamily={FONT}>
        <line x1={X(0)} x2={X(0)} y1={top - 2} y2={H - 22} stroke={C.axis} />
        {prof.map((p, i) => {
          const y = top + i * rowH;
          return (
            <g key={p.name}>
              <text x={labelW - 8} y={y + rowH / 2} dy="0.35em" textAnchor="end" fill={i === 0 ? C.text : C.text2} fontSize={12.5} fontWeight={i === 0 ? 700 : 400}>{short(p.label)}</text>
              <rect x={Math.min(X(0), X(p.kappa))} y={y + 5} width={Math.abs(X(p.kappa) - X(0))} height={rowH - 10} rx={3} fill={KIND_COLOR[p.kind]} opacity={i === 0 ? 1 : 0.8} />
              <text x={Math.max(X(0), X(p.kappa)) + 6} y={y + rowH / 2} dy="0.35em" fill={C.text} fontSize={12}>{p.kappa.toFixed(2)}</text>
            </g>
          );
        })}
        <text x={X(0)} y={H - 6} textAnchor="middle" fill={C.muted} fontSize={11}>κ = 0 (chance)</text>
      </svg>
    </div>
  );
}
