import { useCallback, useEffect, useRef, useState } from 'react';
import { ComplexViewer, DEFAULT_VIEW, ViewControls, type ViewOpts } from '../components/ComplexViewer';
import { LiveBoard } from '../components/LiveBoard';
import { Tour } from '../components/Tour';
import { InterfacePanel, Reveal, TrialHeader } from '../components/TrialPanels';
import { loadStructure, mutatedResidues } from '../lib/dataset';
import { saveLocal } from '../lib/export';
import type { SessionCore } from '../lib/session';
import type { Item, Label, ModelInfo, PhaseSpec, Session, TrialRecord } from '../lib/types';

type State = 'intro' | 'trial' | 'feedback' | 'paused' | 'tour';
/** The clock stops while paused or touring the screen. */
const stopped = (s: State) => s === 'paused' || s === 'tour';
const TOUR_KEY = 'bind.tourSeen';
const VIEW_KEY = 'bind.view';
const tourSeen = () => { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; } };
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const isNarrow = () => typeof innerWidth !== 'undefined' && innerWidth <= 900;
/** Buttons must never keep focus: Space would then re-click them on the next trial. */
const noFocus = { tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
const fmtClock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function loadView(): ViewOpts {
  try { const s = localStorage.getItem(VIEW_KEY); if (s) return { ...DEFAULT_VIEW, ...JSON.parse(s) as Partial<ViewOpts>, spin: false }; } catch { /* storage blocked */ }
  return DEFAULT_VIEW;
}

export function Experiment({ core, models, onEnd }: { core: SessionCore; models: ModelInfo[]; onEnd: (s: Session) => void }) {
  const [state, setState] = useState<State>(core.phase?.intro ? 'intro' : 'trial');
  const [stim, setStim] = useState<{ it: Item; block: number } | null>(() => core.nextStimulus());
  const [last, setLast] = useState<TrialRecord | null>(null);
  const [phase, setPhase] = useState<PhaseSpec | null>(core.phase);
  const [clock, setClock] = useState(0);
  const [view, setView] = useState<ViewOpts>(loadView);
  const onset = useRef<{ perf: number; wall: Date; elapsed: number } | null>(null);
  const look = useRef<{ first: number | null; actions: number }>({ first: null, actions: 0 });
  const active = useRef({ accum: 0, since: performance.now(), pausedAccum: 0, pauseSince: 0 });
  const prevState = useRef<State>('trial');
  const ended = useRef(false);
  const seen = useRef<Item[]>([]);   // items answered so far, parallel to core.trials (for the live scoreboard)
  /** The item whose structure has finished drawing. The response clock waits for it. */
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const waiting = !!stim && readyFor !== stim.it.key;
  const [touch] = useState(isTouch);
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => { const h = () => setNarrow(isNarrow()); addEventListener('resize', h); return () => removeEventListener('resize', h); }, []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* not essential */ } }, [view]);

  const stateRef = useRef(state); stateRef.current = state;
  const activeMs = () => active.current.accum + (stopped(stateRef.current) ? 0 : performance.now() - active.current.since);

  const end = useCallback((reason: string) => {
    if (ended.current) return;
    ended.current = true;
    const a = active.current;
    const s = core.finish(reason, a.accum + (stopped(state) ? 0 : performance.now() - a.since), a.pausedAccum + (stopped(state) ? performance.now() - a.pauseSince : 0));
    saveLocal(s); onEnd(s);
  }, [core, onEnd, state]);

  // stimulus onset = first frame after the complex has been drawn
  useEffect(() => {
    if (state !== 'trial' || !stim) return;
    onset.current = null;
    look.current = { first: null, actions: 0 };
    if (waiting) return;   // the clock starts when the structure is on screen
    const id = requestAnimationFrame(() => (onset.current = { perf: performance.now(), wall: new Date(), elapsed: activeMs() }));
    return () => cancelAnimationFrame(id);
  }, [state, stim, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  // once this complex is up, fetch the next few in the background so later trials appear at once
  useEffect(() => {
    if (waiting) return;
    for (const key of core.upcoming(2)) loadStructure(key).catch(() => { /* retried when needed */ });
  }, [waiting, core, stim]);

  useEffect(() => { const id = setInterval(() => setClock(activeMs()), 500); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const noteLook = useCallback(() => {
    if (stateRef.current !== 'trial') return;
    look.current.actions++;
    if (look.current.first === null) look.current.first = performance.now();
  }, []);

  const advance = useCallback(() => {
    const reason = core.endReason(activeMs());
    if (reason) return end(reason);
    const s = core.nextStimulus();
    if (!s) return end('pool_exhausted');
    setStim(s);
    if (narrow) scrollTo({ top: 0 });
    const ph = core.phase;
    if (ph && ph !== phase) { setPhase(ph); setState(ph.intro ? 'intro' : 'trial'); }
    else setState('trial');
  }, [core, phase, end, narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopClock = (into: State, resumeTo: State) => { active.current.accum += performance.now() - active.current.since; active.current.pauseSince = performance.now(); prevState.current = resumeTo; setState(into); };
  const startClock = () => { active.current.pausedAccum += performance.now() - active.current.pauseSince; active.current.since = performance.now(); setState(prevState.current); };
  const togglePause = useCallback(() => {
    if (state === 'paused') startClock();
    else if (state !== 'tour') stopClock('paused', state);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The tour stops the clock; afterwards the trial restarts its response timer, so touring never counts against you. */
  const openTour = () => { if (!stopped(state)) stopClock('tour', state === 'intro' ? 'trial' : state); };
  const closeTour = useCallback(() => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* not essential */ } startClock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [firstTime] = useState(() => !tourSeen());

  /** One answer, from a key press or a tap/click. `stamp` is the event's timeStamp (same clock as performance.now()). */
  const respond = useCallback((label: Label, pressedKey: string, stamp: number) => {
    if (state !== 'trial' || !stim || !onset.current) return;
    const now = performance.now(), on = onset.current;
    const resp = stamp > on.perf && stamp <= now + 1 ? stamp : now;
    const lookMs = look.current.first === null ? 0 : Math.max(0, resp - look.current.first);
    const { trial, next, finished } = core.record({
      it: stim.it, block: stim.block, pressedKey, label, rtMs: resp - on.perf, lookMs, viewActions: look.current.actions,
      onsetPerf: on.perf, responsePerf: resp, wallOnset: on.wall, elapsedMs: on.elapsed,
    });
    seen.current.push(stim.it);
    setLast(trial);
    if (next || trial.trial % 4 === 0) saveLocal(core.snapshot());
    if (finished) { setState('feedback'); if (phase?.feedback === 'none') end('protocol_complete'); return; }
    if (phase?.feedback === 'none') advance();
    else setState('feedback');
  }, [state, stim, core, phase, advance, end]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (state === 'tour') return;   // the tour handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
      if (state === 'intro' && e.code === 'Space') { e.preventDefault(); setState('trial'); return; }
      if (state === 'feedback' && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); advance(); return; }
      if (state !== 'trial' || !stim || e.repeat || e.metaKey || e.ctrlKey) return;
      const label = core.keyToLabel(e.key);
      if (label === null || !onset.current) return;
      e.preventDefault();
      respond(label, e.key, e.timeStamp);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state, stim, core, advance, togglePause, respond]);

  const keys = core.config.keys;
  const it = stim?.it;
  return (
    <div className="exp">
      <div className="hud">
        <span><span className="muted">Part</span> <b>{phase?.label ?? '–'}</b></span>
        <span><span className="muted">Complex</span> <b>{core.trials.length + (state === 'feedback' ? 0 : 1)}</b></span>
        <span><span className="muted">Time</span> <b>{fmtClock(clock)}</b></span>
        {touch ? <button className="btn btn-sm hud-pause" {...noFocus} onClick={togglePause}>Pause</button> : <span className="muted hud-esc">Esc to pause or stop · progress is saved</span>}
        <button className="btn btn-sm hud-tour" data-tour="tour-button" {...noFocus} onClick={openTour} title="A guided tour of everything on this screen">Tour</button>
        <span data-tour="board" className="hud-board"><LiveBoard seen={seen.current} correct={core.trials.map((t) => t.correct)} models={models} window={core.config.hudWindow} /></span>
      </div>
      {it && (
        <>
          <TrialHeader item={it} trial={core.trials.length + (state === 'feedback' ? 0 : 1)} />
          <div className="stage">
            <div className="stage-main" data-tour="viewer">
              <ComplexViewer item={it} view={view} height={narrow ? 340 : 480} onReady={() => setReadyFor(it.key)} onInteract={noteLook}
                highlight={state === 'feedback' ? mutatedResidues(it) : undefined} />
              <ViewControls view={view} onChange={(v) => { noteLook(); setView(v); }} />
            </div>
            <InterfacePanel item={it} />
          </div>
          <div className="answer-bar" data-tour="answer">
            {state === 'feedback' && last ? (
              <div className={`feedback ${last.correct ? 'ok' : 'no'}`}>
                <Reveal item={it} models={models} response={last.response} />
                <div className="fb-foot">
                  <span className="muted">{touch ? 'Keep looking, then tap Next' : <>Press <kbd>Space</kbd> for the next complex · keep flying around to see why</>}</span>
                  <button className="btn btn-primary fb-btn" {...noFocus} onClick={advance}>Next →</button>
                </div>
              </div>
            ) : (
              <div className="answer-keys">
                <button className="answer-key fake" {...noFocus} onClick={(e) => respond(0, 'TAP', e.timeStamp)}>{!touch && <kbd>{keys[0]}</kbd>} Faked interface</button>
                <div className="answer-q muted">{waiting ? <><span className="spinner" /> Loading the complex… the clock starts when it appears</> : 'Real binders, or a fake?'}</div>
                <button className="answer-key real" {...noFocus} onClick={(e) => respond(1, 'TAP', e.timeStamp)}>{!touch && <kbd>{keys[1]}</kbd>} Real binders</button>
              </div>
            )}
          </div>
        </>
      )}
      {state === 'intro' && phase && (
        <div className="overlay"><div className="intro">{phase.intro.split('\n').map((l, i) => (i ? <p key={i}>{l}</p> : <h2 key={i}>{l}</h2>))}{core.trials.length === 0 && (
          <div className="tour-offer"><b>{firstTime ? 'New here?' : 'Need a reminder?'}</b> Take a one-minute tour of what each part of the screen shows. You can skip it at any point, and bring it back any time with the <b>Tour</b> button at the top.
            <div><button className={`btn ${firstTime ? 'btn-primary' : ''}`} {...noFocus} onClick={openTour}>Take the tour</button></div></div>
        )}<p className="hint">{touch ? null : <span className="pulse">Press <kbd>Space</kbd> or </span>}<button className={`btn ${core.trials.length === 0 && firstTime ? '' : 'btn-primary'}`} {...noFocus} onClick={() => setState('trial')}>{core.trials.length === 0 && firstTime ? 'Skip the tour and begin' : 'Begin'}</button></p></div></div>
      )}
      {state === 'tour' && <Tour onClose={closeTour} />}
      {state === 'paused' && (
        <div className="overlay"><div className="intro"><h2>Paused</h2><p>The timer is stopped.</p>
          <p className="save-note"><b>Need to go?</b> Stop &amp; save keeps your {core.trials.length} answer{core.trials.length === 1 ? '' : 's'} in this browser and shows your results so far. They stay under <b>Your attempts</b>, and next time you start a new run with complexes you haven't seen.</p>
          <div className="row" style={{ justifyContent: 'center' }}><button className="btn btn-primary" {...noFocus} onClick={togglePause}>Resume{touch ? '' : ' (Esc)'}</button><button className="btn" onClick={() => end('ended_by_user')}>Stop &amp; save · see results</button></div></div></div>
      )}
    </div>
  );
}
