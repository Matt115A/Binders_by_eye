import { useState } from 'react';

/** Who the text is written for: high-school biology ("learner") or protein scientists ("expert"). Shared with the BioAI by eye hub (same origin). */
export type Level = 'learner' | 'expert';

const KEY = 'bioai.level';
function initialLevel(): Level {
  try {
    const q = new URLSearchParams(window.location.search).get('level');
    if (q === 'learner' || q === 'expert') return q;
    const s = window.localStorage.getItem(KEY);
    if (s === 'learner' || s === 'expert') return s;
  } catch { /* storage blocked: fall through */ }
  return 'learner';
}

export function useLevel(): [Level, (l: Level) => void] {
  const [level, setLevel] = useState<Level>(initialLevel);
  return [level, (l) => { setLevel(l); try { window.localStorage.setItem(KEY, l); } catch { /* not essential */ } }];
}

export function LevelToggle({ level, onChange }: { level: Level; onChange: (l: Level) => void }) {
  return (
    <div className="level-toggle" role="radiogroup" aria-label="Explanation level">
      {(['learner', 'expert'] as const).map((l) => (
        <button key={l} role="radio" aria-checked={level === l} className={level === l ? 'on' : ''} onClick={() => onChange(l)}>{l === 'learner' ? 'Learner' : 'Expert'}</button>
      ))}
    </div>
  );
}
