import { useState } from 'react';
import { BIOAI_HUB, BIOAI_READY, type Contribution, contribute, contributionFor, withdraw } from '../lib/bioai';

/** Results-page card: opt-in anonymous contribution to BioAI by eye, with withdrawal. */
export function ContributeCard({ sessionId, simulated, contribution }: { sessionId: string; simulated: boolean; contribution: Contribution | null }) {
  const [done, setDone] = useState(() => !!contributionFor(sessionId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const run = async (f: () => Promise<void>, after: boolean) => { setBusy(true); setErr(null); try { await f(); setDone(after); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return (
    <div className="card bioai-card">
      <div className="bioai-row">
        <div className="bioai-text">
          <div className="bioai-kicker">BioAI by eye</div>
          {simulated ? <b>Simulated sessions can't be contributed.</b>
            : !contribution ? <b>Answer at least 20 items to contribute.</b>
            : done ? <><b>✓ Contributed anonymously.</b> Thank you: your answers now help map how people reason compared with AI.</>
            : <><b>Help map how people reason vs AI.</b> Share this session as an anonymous datapoint: no name, account, IP or device details.{' '}
                <button className="link-btn" onClick={() => setDetails((d) => !d)}>{details ? 'Hide' : 'What exactly is sent?'}</button></>}
          {details && contribution && !done && (
            <div className="bioai-details">
              {contribution.n} answers: which items you saw (by id), what you answered, which part of the session each was in, and how long each took,
              plus the game ({contribution.game}), app and dataset versions. The date is stored to the month. Your browser keeps a private token so you can withdraw it later.
            </div>
          )}
          {err && <div className="bioai-err">{err}</div>}
        </div>
        <div className="bioai-actions">
          {!BIOAI_READY ? <span className="muted">Contributions open soon</span>
            : simulated || !contribution ? null
            : done ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => withdraw(sessionId), false)}>{busy ? 'Withdrawing…' : 'Withdraw'}</button>
            : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => contribute(sessionId, contribution), true)}>{busy ? 'Sending…' : 'Contribute anonymously'}</button>}
          <a className="btn btn-sm" href={BIOAI_HUB} target="_blank" rel="noreferrer">Compare with others →</a>
        </div>
      </div>
    </div>
  );
}
