import { useCallback, useEffect, useRef, useState } from 'react';
import * as $3Dmol from '3dmol';
import { loadStructure } from '../lib/dataset';
import { CHAIN_COLOR, CLASS_COLOR, type Item } from '../lib/types';

/**
 * The two chains in their docked pose, free to fly around: drag to orbit, scroll to zoom, right-drag (or
 * two fingers) to pan. The controls let you dress the interface the way you want to judge it, and the
 * "Into the interface" slider walks the near clipping plane through the complex so you can get your eye
 * between the two chains.
 *
 * Nothing drawn here depends on whether the item is real or fake: both are the same crystal backbone with
 * all side chains rebuilt the same way. `highlight` is the one exception and is only ever passed after the
 * player has answered, to show which residues were replaced.
 */
export type Style = 'cartoon' | 'surface' | 'sticks';
export type Paint = 'chain' | 'chemistry' | 'plain';

export interface ViewOpts { style: Style; paint: Paint; sideChains: boolean; onlyInterface: boolean; clip: number; spin: boolean }
export const DEFAULT_VIEW: ViewOpts = { style: 'cartoon', paint: 'chain', sideChains: true, onlyInterface: false, clip: 0, spin: false };

/** "Atoms" already draws every side chain, so the side-chain switch has nothing left to add. */
export const sideChainsApply = (v: ViewOpts) => v.style !== 'sticks';

/**
 * "Plain" colours each chain's carbon and leaves every other element its usual colour, so nitrogen, oxygen
 * and sulfur still read as themselves. The two carbon colours are deliberately none of the element colours
 * (grey carbon, blue nitrogen, red oxygen, yellow sulfur), so a chain is never mistaken for an element.
 */
const PLAIN_COLOR: Record<string, string> = { A: '#4fb3a5', B: '#c9a46b' };
const PLAIN_CARBON: Record<string, number> = { A: 0x4fb3a5, B: 0xc9a46b };
const plainScheme = (chain: string) => ({
  prop: 'elem',
  map: { ...$3Dmol.elementColors.defaultColors, C: PLAIN_CARBON[chain] },
});
const HIGHLIGHT = '#ff4d6d';

const CLASS_OF: Record<string, string> = {
  ALA: 'hydrophobic', VAL: 'hydrophobic', LEU: 'hydrophobic', ILE: 'hydrophobic', MET: 'hydrophobic',
  PHE: 'aromatic', TYR: 'aromatic', TRP: 'aromatic', SER: 'polar', THR: 'polar', ASN: 'polar', GLN: 'polar',
  ARG: 'positive', LYS: 'positive', HIS: 'positive', ASP: 'negative', GLU: 'negative',
  GLY: 'special', PRO: 'special', CYS: 'special',
};
const CHEM_SCHEME = { prop: 'resn', map: Object.fromEntries(Object.entries(CLASS_OF).map(([r, c]) => [r, CLASS_COLOR[c]])) };

/** The colour each chain is drawn in, for the on-screen legend. */
export const chainPaint = (chain: string, paint: Paint) => (paint === 'plain' ? PLAIN_COLOR[chain] : CHAIN_COLOR[chain]);

export function ComplexViewer({ item, view, highlight, height = 460, onReady, onInteract }: {
  item: Item; view: ViewOpts; highlight?: { chain: string; i: number }[]; height?: number; onReady?: () => void; onInteract?: () => void;
}) {
  const div = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof $3Dmol.createViewer> | null>(null);
  const loaded = useRef<string | null>(null);
  const home = useRef<unknown>(null);
  /** The slab zoomTo chose for this complex; the clip slider is measured from it. */
  const baseSlab = useRef<{ near: number; far: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ready = useRef(onReady); ready.current = onReady;
  const interact = useRef(onInteract); interact.current = onInteract;

  // ── create the viewer once ──
  useEffect(() => {
    if (!div.current || viewer.current) return;
    // WebGL can be unavailable (disabled, blocklisted GPU, too many contexts). Never let that take the app down.
    try {
      const probe = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      if (!probe) throw new Error('WebGL unavailable');
      viewer.current = $3Dmol.createViewer(div.current, { backgroundColor: '#0f0f0e', antialias: true } as never);
      if (!viewer.current) throw new Error('could not create the 3D viewer');
    } catch (e) {
      viewer.current = null;
      setErr(`3D view unavailable in this browser (${e instanceof Error ? e.message : e}). The interface measurements below still describe the structure, so the game is playable.`);
      setLoading(false);
    }
    return () => { try { viewer.current?.clear(); } catch { /* ignore */ } viewer.current = null; loaded.current = null; };
  }, []);

  const byChain = useCallback((rs: { chain: string; i: number }[] | undefined) => {
    const sel: Record<string, number[]> = { A: [], B: [] };
    for (const r of rs ?? []) sel[r.chain]?.push(r.i);
    return sel;
  }, []);

  /**
   * Walk the near clipping plane in from its default position. slabNear is measured from the centre of
   * rotation, so going past 0 cuts away the whole front half of the complex.
   */
  const applyClip = useCallback(() => {
    const v = viewer.current, base = baseSlab.current;
    if (!v || !base) return;
    v.setSlab(base.near * (1 - 1.4 * (view.clip / 100)), base.far);
  }, [view.clip]);

  /** Re-draw with the current options. The camera is untouched, so dressing the scene never loses your place. */
  const draw = useCallback(() => {
    const v = viewer.current;
    if (!v) return;
    const iface = byChain(item.iface);
    const hl = byChain(highlight);
    v.setStyle({}, {});
    v.removeAllSurfaces();
    v.removeAllLabels();

    for (const chain of ['A', 'B'] as const) {
      const flat = { color: chainPaint(chain, view.paint) };
      // atoms: chemistry by residue family, plain by element with this chain's carbon, otherwise one flat colour
      const paint = view.paint === 'chemistry' ? { colorscheme: CHEM_SCHEME as never }
        : view.paint === 'plain' ? { colorscheme: plainScheme(chain) as never } : flat;
      // ribbons have no heteroatoms to colour, so they take the chain's own colour
      const ribbon = view.paint === 'chemistry' ? { colorscheme: CHEM_SCHEME as never } : flat;
      const focused = view.onlyInterface ? { chain, resi: iface[chain] } : { chain };
      if (view.style === 'sticks') {
        v.addStyle(focused, { stick: { ...paint, radius: 0.14 } as never, sphere: { ...paint, scale: 0.18 } as never });
        if (view.onlyInterface) v.addStyle({ chain }, { cartoon: { ...flat, opacity: 0.25, thickness: 0.3 } as never });
      } else {
        v.addStyle({ chain }, { cartoon: { ...ribbon, opacity: view.onlyInterface ? 0.3 : 0.95, thickness: 0.4 } as never });
        if (view.onlyInterface) v.addStyle(focused, { cartoon: { ...ribbon, opacity: 1 } as never });
        if (sideChainsApply(view) && view.sideChains) {
          // interface side chains as sticks: the thing you actually judge
          v.addStyle({ chain, resi: iface[chain], not: { atom: ['N', 'C', 'O'] } } as never,
            { stick: { ...paint, radius: 0.17 } as never });
        }
      }
      if (view.style === 'surface') {
        v.addSurface($3Dmol.SurfaceType.MS, {
          opacity: 0.72, ...(view.paint === 'chemistry' ? { colorscheme: CHEM_SCHEME as never } : flat),
        } as never, focused);
      }
      // replaced residues, shown only once the answer is in
      if (hl[chain].length) {
        v.addStyle({ chain, resi: hl[chain] }, {
          stick: { color: HIGHLIGHT, radius: 0.28 } as never,
          sphere: { color: HIGHLIGHT, scale: 0.26 } as never,
          cartoon: { color: HIGHLIGHT, opacity: 1 } as never,
        });
      }
    }
    v.render();
  }, [byChain, item.iface, highlight, view]);

  // ── load the structure, frame it, then draw ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = viewer.current;
        if (!v) { ready.current?.(); return; }
        if (loaded.current !== item.key) {
          v.removeAllModels(); v.removeAllSurfaces(); v.removeAllLabels(); v.render(); setLoading(true);
          const pdb = await loadStructure(item.key);
          if (cancelled) return;
          v.removeAllModels();
          v.addModel(pdb, 'pdb');
          loaded.current = item.key;
        }
        v.resize();
        v.zoomTo();            // resets the slab to fit the complex, so the base slab is read after it
        v.zoom(0.9);
        baseSlab.current = v.getSlab() as { near: number; far: number };
        home.current = v.getView();
        draw();
        applyClip();
        v.render();
        setLoading(false);
        ready.current?.();
      } catch (e) {
        if (!cancelled) {
          setErr(`Couldn't load this structure (${e instanceof Error ? e.message : e}). Check your connection; the interface measurements below still describe it.`);
          setLoading(false); ready.current?.();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [item.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!loading && !err) { draw(); applyClip(); viewer.current?.render(); } }, [draw, applyClip, loading, err]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || loading || err) return;
    try { v.spin(view.spin ? 'y' : false); } catch { /* ignore */ }
    return () => { try { v.spin(false); } catch { /* ignore */ } };
  }, [view.spin, loading, err]);

  /** Back to the starting camera. setView does not carry the slab, so the clip setting survives. */
  const reset = () => { const v = viewer.current; if (v && home.current) { v.setView(home.current as never); v.render(); } };

  return (
    <div className="viewer-wrap">
      <div ref={div} className="viewer-canvas" style={{ width: '100%', height, position: 'relative' }}
        onPointerDown={() => interact.current?.()} onWheel={() => interact.current?.()} />
      {loading && !err && <div className="structure-loading"><span className="spinner" />Loading the complex…</div>}
      {err && <div className="structure-error">{err}</div>}
      {!loading && !err && (
        <>
          <button className="btn btn-sm viewer-reset" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} title="Back to the starting view" onClick={reset}>↺ Reset view</button>
          <div className="viewer-hint">drag to orbit · scroll to zoom · right-drag to pan</div>
          <div className="viewer-chains">
            {item.complex.chains.map((c) => (
              <span key={c.chain}><i style={{ background: chainPaint(c.chain, view.paint) }} />Chain {c.chain} <span className="muted">{c.n} aa</span></span>
            ))}
            {!!highlight?.length && <span><i style={{ background: HIGHLIGHT }} />replaced residues</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** The dressing-room controls. Kept out of the tab order so Space and the answer keys always work. */
export function ViewControls({ view, onChange }: { view: ViewOpts; onChange: (v: ViewOpts) => void }) {
  const set = <K extends keyof ViewOpts>(k: K, v: ViewOpts[K]) => onChange({ ...view, [k]: v });
  const noFocus = { tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  const seg = <K extends keyof ViewOpts>(k: K, opts: { v: ViewOpts[K]; label: string; title: string }[]) => (
    <div className="seg">
      {opts.map((o) => (
        <button key={String(o.v)} className={view[k] === o.v ? 'on' : ''} title={o.title} {...noFocus} onClick={() => set(k, o.v)}>{o.label}</button>
      ))}
    </div>
  );
  const sideChainsOff = !sideChainsApply(view);
  return (
    <div className="view-controls" data-tour="controls">
      <label>Shape {seg('style', [
        { v: 'cartoon', label: 'Cartoon', title: 'The fold as ribbons' },
        { v: 'surface', label: 'Surface', title: 'The molecular surface: see how the two faces fit together' },
        { v: 'sticks', label: 'Atoms', title: 'Every atom of both chains as sticks' },
      ])}</label>
      <label>Colour {seg('paint', [
        { v: 'chain', label: 'By chain', title: 'One colour per chain' },
        { v: 'chemistry', label: 'Chemistry', title: 'Colour each residue by its chemical family' },
        { v: 'plain', label: 'Plain', title: 'Carbon coloured per chain, with nitrogen, oxygen and sulfur in their usual element colours' },
      ])}</label>
      <label className={`check ${sideChainsOff ? 'is-off' : ''}`}
        title={sideChainsOff ? 'Atoms already draws every side chain' : 'Draw the side chains of every interface residue'}>
        <input type="checkbox" disabled={sideChainsOff} checked={view.sideChains && !sideChainsOff} {...noFocus} onChange={(e) => set('sideChains', e.target.checked)} /> Interface side chains
      </label>
      <label className="check" title="Fade everything that is not in the interface">
        <input type="checkbox" checked={view.onlyInterface} {...noFocus} onChange={(e) => set('onlyInterface', e.target.checked)} /> Focus the interface
      </label>
      <label className="slider" title="Walk the near clipping plane into the complex to look inside the interface">
        Into the interface
        <input type="range" min={0} max={100} value={view.clip} {...noFocus} onChange={(e) => set('clip', Number(e.target.value))} />
        {view.clip > 0 && <button className="btn btn-sm btn-ghost" {...noFocus} onClick={() => set('clip', 0)} title="Show the whole complex again">clear</button>}
      </label>
      <label className="check" title="Rotate the complex slowly">
        <input type="checkbox" checked={view.spin} {...noFocus} onChange={(e) => set('spin', e.target.checked)} /> Spin
      </label>
    </div>
  );
}
