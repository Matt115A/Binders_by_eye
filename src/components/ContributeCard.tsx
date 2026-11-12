import { useEffect, useMemo, useState } from 'react';
import { Standing } from './Standing';
import { BIOAI_HUB, BIOAI_READY, type Contribution, contribute, flushSuperseded, MIN_ANSWERS, offerFor, withdraw } from '../lib/bioai';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Results-page card: opt-in anonymous contribution to BioAI by eye, with withdrawal.
 *  One datapoint per game, cumulative: every session played is appended, and contributing again replaces the row. */
export function ContributeCard({ sessionId, simulated, contribution, startedAt, score }: { sessionId: string; simulated: boolean; contribution: Contribution | null; startedAt?: number;
  /** the game's own marking for one answer (1 = right; partial credit allowed), null for an item it does not know */
  score: (item: number, response: string) => number | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [tick, setTick] = useState(0);
  // simulated sessions are never remembered, so they can never reach a datapoint
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offer = useMemo(() => (simulated ? null : offerFor(sessionId, contribution, startedAt)), [sessionId, simulated, startedAt, contribution?.n, contribution?.dataset_version, tick]);
  // a replaced row whose withdrawal failed earlier is retired now, so a lost connection cannot leave two of them
  useEffect(() => { if (BIOAI_READY && !simulated) void flushSuperseded().catch(() => {}); }, [simulated]);

  const c = offer?.contribution ?? null;
  const covered = offer?.sessionIds.length ?? 0;
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setTick((t) => t + 1); } };
  const from = covered > 1 ? ` from ${plural(covered, 'session')}` : '';

  return (
    <div className="card bioai-card">
      <div className="bioai-row">
        <div className="bioai-text">
          <div className="bioai-kicker">BioAI by eye</div>
          {simulated ? <b>Simulated sessions can't be contributed.</b>
            : offer?.upToDate ? <><b>✓ Contributed anonymously: {plural(offer.uploaded?.n ?? 0, 'answer')}{from}.</b> Thank you: your answers now help map how people reason compared with AI. Play again and this contribution grows — you stay one datapoint.{BIOAI_READY && ' See where you stand below.'}</>
            : !c ? <><b>Answer at least {MIN_ANSWERS} items to contribute.</b>{offer && offer.answers > 0 && <> You have {plural(offer.answers, 'answer')}{from} so far; {MIN_ANSWERS - offer.answers} more and they can be contributed together.</>}</>
            : offer!.isUpdate ? <><b>Add this session to your contribution.</b> You have already contributed {plural(offer!.uploaded!.n, 'answer')}; this replaces that datapoint with all {plural(offer!.answers, 'answer')}{from}, so you stay one person in the data rather than becoming two. Updating also refreshes where you stand against other players.{' '}
                <button className="link-btn" onClick={() => setDetails((d) => !d)}>{details ? 'Hide' : 'What exactly is sent?'}</button></>
            : <><b>Contribute to see where you stand.</b> Share {plural(offer!.answers, 'answer')}{from} as one anonymous datapoint (no name, account, IP or device details) and you unlock a chart of your score and questions answered against every other player, with your percentile on both.{' '}
                <button className="link-btn" onClick={() => setDetails((d) => !d)}>{details ? 'Hide' : 'What exactly is sent?'}</button></>}
          {details && c && (
            <div className="bioai-details">
              {c.n} answers{covered > 1 ? ` from ${covered} sessions, as one datapoint` : ''}: which items you saw (by id), what you answered, which part of the session each was in, and how long each took,
              plus the game ({c.game}), app and dataset versions. The date is stored to the month. Your browser keeps a private token so you can withdraw it later, which removes every session in it at once.
              {offer!.isUpdate && ' Updating uploads the new datapoint first and only then withdraws the old one, so your contribution is never missing.'}
              {offer!.full && ` This datapoint is full at ${c.n} answers, so later sessions will not be added.`}
            </div>
          )}
          {err && <div className="bioai-err">{err}</div>}
        </div>
        <div className="bioai-actions">
          {!BIOAI_READY ? <span className="muted">Contributions open soon</span>
            : simulated ? null
            : offer?.upToDate ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => withdraw(contribution!.game, contribution!.dataset_version))}>{busy ? 'Withdrawing…' : 'Withdraw'}</button>
            : !c ? null
            : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => contribute(offer!))}>{busy ? 'Sending…' : offer!.isUpdate ? `Update (+${offer!.newAnswers})` : 'Contribute anonymously & see where you stand'}</button>}
          <a className="btn btn-sm" href={BIOAI_HUB} target="_blank" rel="noreferrer">Compare with others →</a>
        </div>
      </div>
      {BIOAI_READY && offer?.upToDate && c && <Standing mine={c} score={score} />}
    </div>
  );
}
