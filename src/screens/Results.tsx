import { useMemo, useState } from 'react';
import { downloadCsv, downloadMetadata, downloadSessionJson } from '../lib/export';
import { type HistoryEntry, priorTo } from '../lib/history';
import type { Dataset, Session } from '../lib/types';
import { Analysis } from './Analysis';
import { ContributeCard } from '../components/ContributeCard';
import { buildContribution } from '../lib/bioai';
import { Replay } from './Replay';

export function Results({ session, data, history, onNew }: { session: Session; data: Dataset; history: HistoryEntry[]; onNew: () => void }) {
  const [tab, setTab] = useState<'analysis' | 'replay'>('analysis');
  const byId = useMemo(() => new Map(data.items.map((v) => [v.id, v])), [data]);
  const prior = useMemo(() => priorTo(history, session), [history, session]);
  const missing = session.trials.some((t) => !byId.has(t.item_id));
  const m = session.meta;
  return (
    <div className="results">
      <div className="results-head">
        <div><h1>Results</h1><div className="muted" style={{ marginTop: 6, fontSize: 14 }}>{new Date(m.start_time).toLocaleString()} · {session.trials.length} complexes{m.simulated && <span className="tag" style={{ marginLeft: 8 }}>simulated</span>}{!m.end_time && <span className="tag" style={{ marginLeft: 8 }}>incomplete</span>}</div></div>
        <div className="tabs">{(['analysis', 'replay'] as const).map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'analysis' ? 'Analysis' : 'Replay'}</button>)}</div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => downloadCsv(session)}>↓ Trials CSV</button>
          <button className="btn btn-sm" onClick={() => downloadMetadata(session)}>↓ Metadata JSON</button>
          <button className="btn btn-sm" onClick={() => downloadSessionJson(session)}>↓ Session JSON</button>
          <button className="btn btn-sm btn-primary" onClick={onNew}>Back to start</button>
        </div>
      </div>
      <ContributeCard sessionId={m.session_id} simulated={!!m.simulated} contribution={buildContribution('binders', String(m.app_version ?? ''), String(m.dataset_version ?? ''), ['learn', 'new'], session.trials.map((t) => ({ item: t.item_id, response: String(t.response), phase: t.phase, rt: t.rt_ms })))} />
      {missing ? <div className="card empty">This session used a different dataset version ({m.dataset_version}).</div>
        : tab === 'analysis' ? <Analysis session={session} data={data} byId={byId} priorIds={prior.flatMap((e) => e.item_ids)} /> : <Replay session={session} data={data} byId={byId} />}
    </div>
  );
}
