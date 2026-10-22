import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP, type HelpKey } from '../lib/help';

/**
 * Hover (or tap) a header to see what it means. `block` wraps a whole area (e.g. the alignment) and follows the pointer;
 * otherwise it is an inline label with a small "?" marker. Never takes focus, so Space and the answer keys keep working.
 */
export function Help({ k, children, block, className }: { k: HelpKey; children: ReactNode; block?: boolean; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setAt(null); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); };
  }, [at]);
  const h = HELP[k];
  const props = {
    ref: ref as never,
    className: `${block ? 'help-block' : 'help'} ${className ?? ''}`,
    onMouseEnter: (e: React.MouseEvent) => setAt({ x: e.clientX, y: e.clientY }),
    onMouseMove: block ? (e: React.MouseEvent) => setAt({ x: e.clientX, y: e.clientY }) : undefined,
    onMouseLeave: () => setAt(null),
    onClick: (e: React.MouseEvent) => { if (!block) setAt((a) => (a ? null : { x: e.clientX, y: e.clientY })); },
  };
  const below = at && at.y < window.innerHeight * 0.6;
  const pop = at && createPortal(
    <div className="help-pop" role="tooltip" style={{ left: Math.max(8, Math.min(at.x + 14, window.innerWidth - 308)), top: below ? at.y + 18 : at.y - 14, transform: below ? undefined : 'translateY(-100%)' }}>
      <b>{h.title}</b>{h.text}
    </div>, document.body);
  return block
    ? <div {...props}>{children}{pop}</div>
    : <span {...props}>{children}<span className="help-i" aria-hidden>?</span>{pop}</span>;
}
