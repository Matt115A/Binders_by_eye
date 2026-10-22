import { useEffect, useState } from 'react';
import { ComplexViewer, DEFAULT_VIEW, ViewControls, type ViewOpts } from '../components/ComplexViewer';
import { InterfacePanel, Reveal, TrialHeader } from '../components/TrialPanels';
import { mutatedResidues } from '../lib/dataset';
import type { Dataset, Item, Session } from '../lib/types';

/** Walk back through the complexes you judged, with the answer and every model's call shown. */
export function Replay({ session, data, byId }: { session: Session; data: Dataset; byId: Map<number, Item> }) {
  const [idx, setIdx] = useState(0);
  const [view, setView] = useState<ViewOpts>({ ...DEFAULT_VIEW, sideChains: true });
  const n = session.trials.length, t = session.trials[idx], it = t ? byId.get(t.item_id) : undefined;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') setIdx((i) => Math.min(n - 1, i + 1)); else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1)); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [n]);
  if (!t || !it) return <div className="empty">No trials.</div>;
  return (
    <div>
      <div className="card" style={{ padding: '12px 16px' }}>
        <div className="scrub"><button className="btn btn-sm btn-ghost" onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
          <input type="range" min={0} max={n - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} />
          <button className="btn btn-sm btn-ghost" onClick={() => setIdx((i) => Math.min(n - 1, i + 1))}>›</button>
          <span className="muted">{t.trial} / {n} · ← → · {t.correct ? 'you were right' : 'you were wrong'}</span></div>
      </div>
      <TrialHeader item={it} trial={t.trial} />
      <div className="stage">
        <div className="stage-main">
          <ComplexViewer item={it} view={view} height={420} highlight={mutatedResidues(it)} />
          <ViewControls view={view} onChange={setView} />
        </div>
        <InterfacePanel item={it} />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <Reveal item={it} models={data.models} response={t.response} />
      </div>
    </div>
  );
}
