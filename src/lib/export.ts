import type { Session, TrialRecord } from './types';

export const CSV_COLUMNS: (keyof TrialRecord)[] = [
  'trial', 'timestamp', 'elapsed_ms', 'phase', 'feedback', 'block', 'item_id', 'pdb', 'group', 'kind',
  'label', 'response', 'pressed_key', 'correct', 'rt_ms', 'look_ms', 'view_actions', 'rolling_accuracy',
  'onset_perf_ms', 'response_perf_ms',
];

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function trialsToCsv(session: Session): string {
  const header = ['session_id', ...CSV_COLUMNS].join(',');
  const rows = session.trials.map((t) => [session.meta.session_id, ...CSV_COLUMNS.map((c) => t[c])].map(cell).join(','));
  return [header, ...rows].join('\n') + '\n';
}

export function metadataJson(session: Session): string {
  return JSON.stringify(session.meta, null, 2);
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(session: Session) {
  downloadBlob(trialsToCsv(session), `${session.meta.session_id}_trials.csv`, 'text/csv');
}

export function downloadMetadata(session: Session) {
  downloadBlob(metadataJson(session), `${session.meta.session_id}_metadata.json`, 'application/json');
}

/** Full session (meta + trials) in one file — can be re-loaded into the app. */
export function downloadSessionJson(session: Session) {
  downloadBlob(JSON.stringify(session), `${session.meta.session_id}_session.json`, 'application/json');
}

function serializeSvg(svg: SVGSVGElement): { text: string; w: number; h: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(box.width));
  clone.setAttribute('height', String(box.height));
  clone.querySelectorAll('[data-export-hide]').forEach((n) => n.remove());
  return { text: new XMLSerializer().serializeToString(clone), w: box.width, h: box.height };
}

export function exportSvg(svg: SVGSVGElement, name: string) {
  downloadBlob(serializeSvg(svg).text, `${name}.svg`, 'image/svg+xml');
}

export function exportPng(svg: SVGSVGElement, name: string, scale = 3, background = '#0e0e0d') {
  const { text, w, h } = serializeSvg(svg);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob((b) => b && downloadBlob(b, `${name}.png`, 'image/png'), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
}

// ── local persistence (browser only, never leaves the machine) ──
const LS_KEY = 'bind.lastSession';

export function saveLocal(session: Session) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable or full — the in-memory copy is still intact */
  }
}

export function loadLocal(): Session | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as Session) : null;
  } catch {
    return null;
  }
}
