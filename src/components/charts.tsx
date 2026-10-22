import { type ReactNode, type Ref, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Pt } from '../lib/analysis';
import { exportPng, exportSvg } from '../lib/export';

/** Literal colours (not CSS vars) so exported SVG/PNG files are self-contained. */
export const C = {
  text: '#f4f4f0',
  text2: '#c3c2b7',
  muted: '#8a8980',
  grid: '#262624',
  axis: '#3a3a36',
  surface: '#171716',
  s1: '#3987e5',
  s2: '#d95926',
  s3: '#199e70',
  s4: '#c98500',
  yellow: '#f2c230',
  good: '#3ccf7e',
  bad: '#ef5350',
};
export const CATEGORICAL = [C.s1, C.s2, C.s3, C.s4];
const FONT = "Inter, -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setW(ref.current.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// ───────────────────────── Line chart ─────────────────────────

export interface Series {
  name: string;
  color: string;
  points: Pt[];
  dash?: string;
  width?: number;
  dots?: boolean;
}

export interface LineChartProps {
  series: Series[];
  height?: number;
  xDomain?: [number, number];
  yDomain?: [number, number];
  yTicks?: number[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  markers?: { x: number; label: string }[];
  refLines?: { y: number; label: string; at?: 'start' | 'end' }[];
  cursorX?: number | null;
  compact?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  hover?: boolean;
}

function bisect(points: Pt[], x: number): Pt | null {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? points[lo] : points[hi];
}

export function LineChart(p: LineChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const height = p.height ?? 300;
  const compact = !!p.compact;
  const m = compact ? { t: 8, r: 8, b: 20, l: 34 } : { t: 16, r: 18, b: 44, l: 58 };
  const iw = Math.max(10, width - m.l - m.r);
  const ih = Math.max(10, height - m.t - m.b);
  const allPts = p.series.flatMap((s) => s.points);
  const xd: [number, number] = p.xDomain ?? [Math.min(...allPts.map((q) => q.x), 0), Math.max(...allPts.map((q) => q.x), 1)];
  const yd: [number, number] = p.yDomain ?? [0, Math.max(...allPts.map((q) => q.y), 1) * 1.08];
  const sx = (v: number) => m.l + ((v - xd[0]) / (xd[1] - xd[0] || 1)) * iw;
  const sy = (v: number) => m.t + ih - ((v - yd[0]) / (yd[1] - yd[0] || 1)) * ih;
  const xt = niceTicks(xd[0], xd[1], compact ? 3 : Math.max(3, Math.floor(iw / 110)));
  const yt = p.yTicks ?? niceTicks(yd[0], yd[1], compact ? 2 : 5);
  const yf = p.yFormat ?? ((v: number) => String(v));
  const xf = p.xFormat ?? ((v: number) => String(v));
  const [hx, setHx] = useState<number | null>(null);
  const fs = compact ? 10 : 12.5;

  const paths = useMemo(
    () =>
      p.series.map((s) => {
        let d = '';
        let prevX: number | null = null;
        for (const q of s.points) {
          // break the line across gaps (e.g. the phase boundary)
          const gap = prevX !== null && q.x - prevX > Math.max(25, (xd[1] - xd[0]) / 30);
          d += `${d && !gap ? 'L' : 'M'}${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`;
          prevX = q.x;
        }
        return d;
      }),
    [p.series, width, height, xd[0], xd[1], yd[0], yd[1]],
  );

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const x = xd[0] + ((e.clientX - r.left) / r.width) * (xd[1] - xd[0]);
    setHx(x);
  };
  const hoverPts = hx === null ? [] : p.series.map((s) => ({ s, pt: bisect(s.points, hx) })).filter((h) => h.pt);
  const hxSnap = hoverPts[0]?.pt?.x ?? hx;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg ref={p.svgRef} width={width} height={height} fontFamily={FONT} style={{ background: 'transparent' }}>
        {/* grid + axes */}
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} stroke={C.grid} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v)} dy="0.35em" textAnchor="end" fill={C.muted} fontSize={fs}>
              {yf(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={m.t + ih + (compact ? 14 : 20)} textAnchor="middle" fill={C.muted} fontSize={fs}>
            {xf(v)}
          </text>
        ))}
        <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke={C.axis} />
        {p.xLabel && !compact && (
          <text x={m.l + iw / 2} y={height - 6} textAnchor="middle" fill={C.text2} fontSize={13}>
            {p.xLabel}
          </text>
        )}
        {p.yLabel && !compact && (
          <text transform={`translate(14 ${m.t + ih / 2}) rotate(-90)`} textAnchor="middle" fill={C.text2} fontSize={13}>
            {p.yLabel}
          </text>
        )}
        {/* reference lines */}
        {(p.refLines ?? []).map((r) => (
          <g key={`r${r.y}${r.label}`}>
            <line x1={m.l} x2={m.l + iw} y1={sy(r.y)} y2={sy(r.y)} stroke={C.muted} strokeDasharray="2 5" strokeWidth={1.2} />
            {!compact && (
              <text x={r.at === 'start' ? m.l + 6 : m.l + iw - 4} y={sy(r.y) - 6} textAnchor={r.at === 'start' ? 'start' : 'end'} fill={C.muted} fontSize={11.5}>
                {r.label}
              </text>
            )}
          </g>
        ))}
        {/* remap markers */}
        {(p.markers ?? []).map((mk) => (
          <g key={`m${mk.x}`}>
            <line x1={sx(mk.x)} x2={sx(mk.x)} y1={m.t} y2={m.t + ih} stroke={C.text} strokeOpacity={0.55} strokeDasharray="5 4" strokeWidth={1.4} />
            {!compact && (
              <text x={sx(mk.x) + 6} y={m.t + 12} fill={C.text} fontSize={12} fontWeight={600}>
                {mk.label}
              </text>
            )}
          </g>
        ))}
        {/* series */}
        {p.series.map((s, i) => (
          <g key={s.name}>
            <path d={paths[i]} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
            {s.dots &&
              s.points.map((q, j) => <circle key={j} cx={sx(q.x)} cy={sy(q.y)} r={compact ? 2.5 : 4} fill={s.color} stroke={C.surface} strokeWidth={2} />)}
          </g>
        ))}
        {p.cursorX != null && (
          <line x1={sx(p.cursorX)} x2={sx(p.cursorX)} y1={m.t} y2={m.t + ih} stroke={C.text} strokeWidth={1.5} data-export-hide />
        )}
        {/* hover layer */}
        {p.hover !== false && (
          <g data-export-hide>
            {hxSnap !== null && hoverPts.length > 0 && (
              <>
                <line x1={sx(hxSnap)} x2={sx(hxSnap)} y1={m.t} y2={m.t + ih} stroke={C.muted} strokeWidth={1} />
                {hoverPts.map(({ s, pt }) => (
                  <circle key={s.name} cx={sx(pt!.x)} cy={sy(pt!.y)} r={4.5} fill={s.color} stroke={C.surface} strokeWidth={2} />
                ))}
              </>
            )}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHx(null)} />
          </g>
        )}
      </svg>
      {hxSnap !== null && hoverPts.length > 0 && !compact && (
        <div className="tooltip" style={{ left: Math.min(sx(hxSnap) + 14, width - 170), top: m.t + 4 }}>
          <div className="tt-title">
            {p.xLabel ?? 'x'} {xf(Math.round(hxSnap * 10) / 10)}
          </div>
          {hoverPts.map(({ s, pt }) => (
            <div className="tt-row" key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}: <b>{yf(pt!.y)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; dash?: boolean; square?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name}>
          <i
            className={it.square ? 'sq' : ''}
            style={it.dash ? { background: `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)` } : { background: it.color }}
          />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// ───────────────────────── Bars ─────────────────────────

export function Bars({
  bars,
  height = 220,
  format,
  domain,
  label,
  svgRef,
}: {
  bars: { label: string; value: number | null; color: string; sub?: string }[];
  height?: number;
  format: (v: number) => string;
  domain?: [number, number];
  label: string;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const m = { t: 34, r: 10, b: 46, l: 10 };
  const ih = height - m.t - m.b;
  const max = domain?.[1] ?? Math.max(...bars.map((b) => b.value ?? 0), 1) * 1.1;
  const bw = Math.max(6, Math.min(90, (width - m.l - m.r) / bars.length - 28));
  const slot = Math.max(0, (width - m.l - m.r) / bars.length);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg ref={svgRef} width={width} height={height} fontFamily={FONT}>
        <text x={width / 2} y={14} textAnchor="middle" fill={C.text2} fontSize={13}>
          {label}
        </text>
        <line x1={m.l} x2={width - m.r} y1={m.t + ih} y2={m.t + ih} stroke={C.axis} />
        {bars.map((b, i) => {
          const h = b.value === null ? 0 : (b.value / max) * ih;
          const x = m.l + slot * i + (slot - bw) / 2;
          const y = m.t + ih - h;
          const r = Math.min(4, h);
          return (
            <g key={b.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={m.l + slot * i} y={m.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x} ${m.t + ih} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + bw - r} Q${x + bw} ${y} ${x + bw} ${y + r} V${m.t + ih} Z`}
                  fill={b.color}
                  opacity={hover === null || hover === i ? 1 : 0.6}
                />
              )}
              <text x={x + bw / 2} y={y - 8} textAnchor="middle" fill={C.text} fontSize={15} fontWeight={600}>
                {b.value === null ? '–' : format(b.value)}
              </text>
              <text x={x + bw / 2} y={m.t + ih + 18} textAnchor="middle" fill={C.text2} fontSize={12.5}>
                {b.label}
              </text>
              {b.sub && (
                <text x={x + bw / 2} y={m.t + ih + 34} textAnchor="middle" fill={C.muted} fontSize={11}>
                  {b.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ───────────────────────── Heatmap ─────────────────────────

function lerpColor(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

export interface HeatRow {
  label: string;
  accent?: boolean;
  values: number[];
  texts: string[];
  /** per-column outline: 'target' (correct key) | 'old' (pre-remap key) */
  marks?: ('target' | 'old' | null)[];
  title?: string[];
}

export function Heatmap({
  rows,
  cols,
  rowHeader,
  colHeader,
  cell = 46,
  svgRef,
}: {
  rows: HeatRow[];
  cols: string[];
  rowHeader: string;
  colHeader: string;
  cell?: number;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const labelW = 70;
  const top = 46;
  const w = labelW + cols.length * cell + 6;
  const h = top + rows.length * cell + 6;
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="chart-wrap" style={{ overflowX: 'auto' }}>
      <svg ref={svgRef} width={w} height={h} fontFamily={FONT}>
        <text x={labelW + (cols.length * cell) / 2} y={13} textAnchor="middle" fill={C.text2} fontSize={12.5}>
          {colHeader}
        </text>
        <text x={4} y={top - 10} fill={C.muted} fontSize={11.5}>
          {rowHeader}
        </text>
        {cols.map((c, j) => (
          <text key={c} x={labelW + j * cell + cell / 2} y={top - 10} textAnchor="middle" fill={C.text} fontSize={14} fontWeight={600}>
            {c}
          </text>
        ))}
        {rows.map((r, i) => (
          <g key={r.label + i}>
            <text x={labelW - 12} y={top + i * cell + cell / 2} dy="0.35em" textAnchor="end" fill={r.accent ? '#f08a5d' : C.text} fontSize={14} fontWeight={600}>
              {r.label}
            </text>
            {r.values.map((v, j) => {
              const x = labelW + j * cell;
              const y = top + i * cell;
              const mark = r.marks?.[j];
              const id = `${i}-${j}`;
              return (
                <g key={j} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
                  <title>{r.title?.[j] ?? r.texts[j]}</title>
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={6}
                    fill={lerpColor('#1f2124', '#4f95ea', Math.sqrt(Math.max(0, Math.min(1, v))))}
                    stroke={hover === id ? C.text : 'none'}
                    strokeWidth={1.5}
                  />
                  {mark && (
                    <rect
                      x={x + 3.5}
                      y={y + 3.5}
                      width={cell - 7}
                      height={cell - 7}
                      rx={4.5}
                      fill="none"
                      stroke={mark === 'target' ? C.good : C.s2}
                      strokeWidth={2}
                      strokeDasharray={mark === 'old' ? '4 3' : undefined}
                    />
                  )}
                  <text x={x + cell / 2} y={y + cell / 2} dy="0.35em" textAnchor="middle" fill={v > 0.55 ? '#0b0b0b' : C.text2} fontSize={12}>
                    {r.texts[j]}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ───────────────────────── Card ─────────────────────────

export function Card({
  title,
  sub,
  children,
  exportName,
  svgRef,
  extra,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  exportName?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  extra?: ReactNode;
}) {
  const doExport = (kind: 'svg' | 'png') => {
    const svg = svgRef?.current;
    if (!svg || !exportName) return;
    if (kind === 'svg') exportSvg(svg, exportName);
    else exportPng(svg, exportName);
  };
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        <div className="card-actions">
          {extra}
          {svgRef && exportName && (
            <>
              <button className="btn btn-sm btn-ghost" onClick={() => doExport('svg')} title="Download SVG">
                SVG
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => doExport('png')} title="Download PNG (3×)">
                PNG
              </button>
            </>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
