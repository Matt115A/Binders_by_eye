import { useEffect, useLayoutEffect, useState } from 'react';
import { HELP, type HelpKey } from '../lib/help';

/** The tour walks through these on-screen areas (marked with data-tour="…") in order. Areas that aren't on screen are skipped. */
const STEPS: { target: string; help: HelpKey; extra?: string }[] = [
  { target: 'chains', help: 'task', extra: 'Half the complexes are real and half are faked, so guessing gets you 50%. You are told the two chain lengths and nothing else until you answer.' },
  { target: 'viewer', help: 'viewer', extra: 'Take your time: fly round the back, look along the interface, get in close. Both kinds of complex are built exactly the same way, so only the fit of the two surfaces can tell you.' },
  { target: 'controls', help: 'controls' },
  { target: 'numbers', help: 'interface', extra: 'These ten numbers are measured off the structure you are looking at. One of the benchmark models is trained on exactly these, so you can see later whether you used them better than it did.' },
  { target: 'answer', help: 'answer' },
  { target: 'board', help: 'board' },
  { target: 'tour-button', help: 'answer' },
];
const LAST = { title: 'That is everything', text: 'Hover over any heading with a small ? to see its explanation again, or press Tour to replay this walkthrough. Good luck!' };

export function Tour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i], last = i === steps.length - 1;

  useLayoutEffect(() => {
    const el = step && document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let id = 0;
    const track = () => { setRect(el.getBoundingClientRect()); id = requestAnimationFrame(track); };
    track();
    return () => cancelAnimationFrame(id);
  }, [step]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); if (last) onClose(); else setI((n) => n + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [last, onClose]);

  if (!step || !rect) return null;
  const h = last ? LAST : HELP[step.help];
  const pad = 6, cardW = Math.min(340, window.innerWidth - 24);
  const spaceBelow = window.innerHeight - rect.bottom, top = spaceBelow > 230 ? rect.bottom + 12 : Math.max(12, rect.top - 12);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - cardW - 12));
  return (
    <div className="tour" role="dialog" aria-label="Tour of the screen">
      <div className="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }} />
      <div className="tour-card" style={{ left, top, width: cardW, transform: spaceBelow > 230 ? undefined : 'translateY(-100%)' }}>
        <div className="tour-step muted">{i + 1} of {steps.length}</div>
        <h3>{h.title}</h3>
        <p>{h.text}</p>
        {!last && step.extra && <p>{step.extra}</p>}
        <div className="tour-actions">
          <button className="btn btn-sm btn-ghost" tabIndex={-1} onClick={onClose}>Skip tour</button>
          <div className="row" style={{ gap: 6 }}>
            {i > 0 && <button className="btn btn-sm" tabIndex={-1} onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn btn-sm btn-primary" tabIndex={-1} onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Start playing' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
