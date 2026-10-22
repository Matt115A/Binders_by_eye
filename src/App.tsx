import { useEffect, useState } from 'react';
import { loadDataset } from './lib/dataset';
import { loadLocal, saveLocal } from './lib/export';
import { addToHistory, type HistoryEntry, loadHistory } from './lib/history';
import { SessionCore } from './lib/session';
import { simulateSession } from './lib/simulate';
import { DEFAULT_CONFIG, type Config, type Dataset, type PriorExperience, type Session } from './lib/types';
import { Experiment } from './screens/Experiment';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';

type Screen = 'setup' | 'experiment' | 'results';

function initialHistory(): HistoryEntry[] {
  let h = loadHistory();
  const last = loadLocal();
  if (last && !last.meta.simulated && !h.some((e) => e.session_id === last.meta.session_id)) h = addToHistory(last);
  return h;
}
/** Complexes already used on this device (both halves are then off limits) and how much experience the player has. */
export function priorFrom(h: HistoryEntry[]): { exclude: Set<string>; prior: PriorExperience } {
  const exclude = new Set(h.flatMap((e) => e.pdbs));
  return { exclude, prior: { sessions: h.length, trials: h.reduce((a, e) => a + e.n_trials, 0), session_ids: h.map((e) => e.session_id), excluded_complexes: exclude.size } };
}

/** Parts can't ask for more complexes than are left after exclusions, or the run would end mid-part. */
function fit(config: Config, data: Dataset, exclude: Set<string>): Config {
  const left = (g: string) => data.complexes.filter((c) => c.group === g && !exclude.has(c.pdb)).length;
  return { ...config, phases: config.phases.map((p) => ({ ...p, trials: Math.min(p.trials, left(p.group)) })).filter((p) => p.trials > 0) };
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [core, setCore] = useState<SessionCore | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const debug = !import.meta.env.VITE_PUBLIC && new URLSearchParams(location.search).has('debug');
  useEffect(() => { loadDataset().then(setData).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="screen"><h2>Couldn't load the dataset</h2><p className="muted">{err}</p></div>;
  if (!data) return <div className="screen"><p className="muted pulse">Loading complexes…</p></div>;
  return (
    <>
      {screen === 'setup' && <Setup data={data} initial={config} history={history} debug={debug}
        onStart={(c) => { const p = priorFrom(history); setConfig(c); setCore(new SessionCore(fit(c, data, p.exclude), data, p)); setScreen('experiment'); }}
        onSimulate={(c) => { const p = priorFrom(history); const s = simulateSession(fit(c, data, p.exclude), data, undefined, p); saveLocal(s); setSession(s); setScreen('results'); }}
        onOpenSession={(s) => { setSession(s); setScreen('results'); }} onHistoryChange={setHistory} />}
      {screen === 'experiment' && core && <Experiment core={core} models={data.models} onEnd={(s) => { setHistory(addToHistory(s)); setSession(s); setCore(null); setScreen('results'); }} />}
      {screen === 'results' && session && <Results session={session} data={data} history={history} onNew={() => setScreen('setup')} />}
    </>
  );
}
