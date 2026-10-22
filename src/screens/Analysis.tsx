import { useMemo, useRef } from 'react';
import { Bars, C, Card, Legend, LineChart } from '../components/charts';
import { ModelProfile } from '../components/ModelProfile';
import { acc, byCue, byLookTime, cueWeights, modelAccuracy, phaseStats, rolling, streamLearners, subsets } from '../lib/analysis';
import type { Dataset, Item, Session } from '../lib/types';

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const KIND_COLOR: Record<string, string> = { simple: '#9cc3e6', structure: '#199e70', plm: '#c98500', folding: '#e87ba4' };
const KIND_LABEL: Record<string, string> = { simple: 'simple rule', structure: 'scores this structure', plm: 'sequence only', folding: 'folds it from sequence' };
const short = (l: string) => l.replace(' (sees what you see)', '').replace(/ \((ipTM|interface pLDDT|interface fit|sequence given backbone|sequence only)\)/, '');
const W = 20;

export function Analysis({ session, data, byId, priorIds }: { session: Session; data: Dataset; byId: Map<number, Item>; priorIds: number[] }) {
  const headline = data.models.find((m) => m.name === 'boltz2') ?? data.models[0];
  const r = useMemo(() => ({
    phases: phaseStats(session),
    subs: subsets(session),
    stream: streamLearners(session, data, byId, priorIds),
    cues: cueWeights(session, data, byId),
    split: byCue(session, byId, ['feature_model', 'mpnn_delta', headline.name]),
    look: byLookTime(session),
  }), [session, data, byId, priorIds, headline.name]);
  const refs = { curve: useRef<SVGSVGElement>(null), bench: useRef<SVGSVGElement>(null), look: useRef<SVGSVGElement>(null) };
  const n = session.trials.length;
  const markers = r.phases.slice(1).map((p) => ({ x: p.start - 0.5, label: p.label.split(' (')[0] }));
  const you = rolling(session.trials, session.trials.map((t) => +t.correct), W);
  const models = data.models;
  const byKind = (k: string) => models.filter((m) => m.kind === k);
  return (
    <div>
      <div className="kpis">
        {r.phases.map((p) => <div key={p.name} className="kpi"><div className="kpi-label">{p.label}</div><div className="kpi-value">{pct(p.acc)}</div><div className="kpi-sub">n={p.n} · chance 50%</div></div>)}
        <div className="kpi"><div className="kpi-label">{short(headline.label)} on the same complexes</div><div className="kpi-value">{pct(modelAccuracy(session.trials, byId, headline.name))}</div><div className="kpi-sub">folds each pair from sequence</div></div>
      </div>

      <h2 className="section-title">Performance</h2>
      <Card title="By part" sub="Accuracy (95% interval). Trials are balanced, half real and half faked, so 50% is chance. 'Caught fakes' = share of faked interfaces you called fake.">
        <table className="data">
          <thead><tr><th>Part</th><th className="num">n</th><th className="num">Accuracy</th><th className="num">95% CI</th><th className="num">Caught fakes</th><th className="num">Caught real</th><th className="num">You said real</th><th className="num">Median time</th></tr></thead>
          <tbody>{r.phases.map((p) => <tr key={p.name}><td><b>{p.label}</b></td><td className="num">{p.n}</td><td className="num"><b>{pct(p.acc)}</b></td><td className="num muted">{pct(p.ci[0])}–{pct(p.ci[1])}</td><td className="num">{pct(p.hitFake)}</td><td className="num">{pct(p.hitReal)}</td><td className="num">{pct(p.saidReal)}</td><td className="num">{p.rt ? `${(p.rt / 1000).toFixed(0)} s` : '–'}</td></tr>)}</tbody>
        </table>
      </Card>

      <Card title="Benchmark on identical complexes" svgRef={refs.bench} exportName="benchmark"
        sub="Every model's call on exactly the complexes you saw. Each model's score is turned into a real/fake call at its median over the whole dataset, so every model calls half of them real and 50% is chance for everyone.">
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead><tr><th>Who</th><th>Sees</th>{r.subs.map((s) => <th key={s.key} className="num">{s.label} <span className="muted">({s.trials.length})</span></th>)}</tr></thead>
            <tbody>
              <tr><td><b style={{ color: C.yellow }}>You</b></td><td className="muted">the docked structure</td>{r.subs.map((s) => <td key={s.key} className="num"><b>{pct(acc(s.trials))}</b></td>)}</tr>
              {(['folding', 'structure', 'plm', 'simple'] as const).flatMap((kind) => byKind(kind).map((m) => (
                <tr key={m.name}><td><span style={{ color: KIND_COLOR[m.kind] }}>●</span> {m.label}</td><td className="muted">{KIND_LABEL[m.kind]}</td>
                  {r.subs.map((s) => <td key={s.key} className="num">{pct(modelAccuracy(s.trials, byId, m.name))}</td>)}</tr>
              )))}
            </tbody>
          </table>
        </div>
        <Bars svgRef={refs.bench} label={`All ${n} complexes`} domain={[0, 1]} format={pct} height={260}
          bars={[{ label: 'You', value: acc(session.trials), color: C.yellow },
            ...models.map((m) => ({ label: short(m.label), value: modelAccuracy(session.trials, byId, m.name), color: KIND_COLOR[m.kind] }))]} />
        <p className="note">
          The two kinds of model are asked different questions. Boltz-2 gets only the two sequences and has to
          predict whether they form a complex at all, which is the hard, useful version of the task. ProteinMPNN and the
          feature model are given the docked structure you were given, so they only have to judge whether that interface
          looks right. You are in the second group.
        </p>
        <p className="note">
          Do not read the language models' scores as skill at predicting binding. A fake's interface is uniformly random
          residues, which leaves a sequence no real protein family would produce — ESM2 sees one chain at a time, with no
          structure and no partner, and still gets most of them right. It is detecting unnatural protein, not a bad fit.
        </p>
      </Card>

      <Card title="Learning curve: you vs learners that saw the same complexes" svgRef={refs.curve} exportName="same_experience"
        sub={`Rolling accuracy over ${W} trials. The learners see the ten interface numbers you see, in your order, with your feedback${priorIds.length ? `, after first learning from your ${priorIds.length} earlier trials` : ''}.`}>
        <Legend items={[{ name: 'You', color: C.yellow }, ...r.stream.map((s, i) => ({ name: s.label, color: ['#9cc3e6', '#199e70', '#3987e5'][i] }))]} />
        <LineChart svgRef={refs.curve} height={320} xDomain={[1, Math.max(2, n)]} yDomain={[0, 1]} yTicks={[0, 0.25, 0.5, 0.75, 1]} yFormat={pct} xLabel="Complex" yLabel="Accuracy" markers={markers}
          series={[...r.stream.map((s, i) => ({ name: s.label, color: ['#9cc3e6', '#199e70', '#3987e5'][i], points: rolling(session.trials, s.correct, W), width: 1.8 })), { name: 'You', color: C.yellow, points: you, width: 3.2 }]}
          refLines={[{ y: 0.5, label: 'chance' }]} />
      </Card>

      <div className="grid2">
        <Card title="What drives your answers?" sub="How strongly each interface number pushes you towards calling a complex real (standardised logistic weights). Compare what you leaned on with what actually predicted the truth, and with ProteinMPNN.">
          {!r.cues ? <div className="empty">Needs at least 24 trials.</div> : (
            <table className="data">
              <thead><tr><th>Cue</th><th className="num">You</th><th className="num">Truth</th><th className="num">ProteinMPNN</th></tr></thead>
              <tbody>{r.cues.names.map((nm, i) => {
                const cell = (x: number | null) => <td className="num" style={{ color: x == null ? 'var(--muted)' : x > 0.15 ? '#3ccf7e' : x < -0.15 ? '#ef5350' : 'var(--muted)' }}>{x == null ? '–' : `${x > 0 ? '+' : ''}${x.toFixed(2)}`}</td>;
                return <tr key={nm}><td>{nm}</td>{cell(r.cues!.you[i])}{cell(r.cues!.truth[i])}{cell(r.cues!.model ? r.cues!.model![i] : null)}</tr>;
              })}</tbody>
            </table>
          )}
        </Card>
        <Card title="Does looking longer help?" svgRef={refs.look} exportName="look_time"
          sub="Your trials split into quarters by how long you spent on them, with the median number of view changes in each.">
          {!r.look.length ? <div className="empty">Needs at least 16 trials.</div> : (
            <>
              <table className="data">
                <thead><tr><th>Quarter</th><th className="num">n</th><th className="num">Median time</th><th className="num">View changes</th><th className="num">Accuracy</th></tr></thead>
                <tbody>{r.look.map((q) => <tr key={q.name}><td>{q.name}</td><td className="num muted">{q.n}</td><td className="num">{q.rt ? `${(q.rt / 1000).toFixed(0)} s` : '–'}</td><td className="num">{q.views ?? '–'}</td><td className="num"><b>{pct(q.acc)}</b></td></tr>)}</tbody>
              </table>
              <Bars svgRef={refs.look} label="Accuracy by time spent" domain={[0, 1]} format={pct} height={210}
                bars={r.look.map((q) => ({ label: q.name.replace(' quarter', ''), value: q.acc, color: C.s1 }))} />
            </>
          )}
        </Card>
      </div>

      <Card title="Where you do well" sub="Accuracy split by a property of the complex: you, the feature model that sees the same ten numbers, ProteinMPNN and the sequence-to-structure model.">
        {r.split.map((sp) => (
          <table key={sp.label} className="data" style={{ marginBottom: 14 }}>
            <thead><tr><th>{sp.label}</th><th className="num">n</th><th className="num">You</th><th className="num">Feature model</th><th className="num">ProteinMPNN</th><th className="num">{short(headline.label)}</th></tr></thead>
            <tbody>{sp.rows.map((row) => <tr key={row.name}><td>{row.name}</td><td className="num muted">{row.n}</td><td className="num"><b>{pct(row.you)}</b></td><td className="num">{pct(row.models.feature_model)}</td><td className="num">{pct(row.models.mpnn_delta)}</td><td className="num">{pct(row.models[headline.name])}</td></tr>)}</tbody>
          </table>
        ))}
      </Card>

      <h2 className="section-title">Your model profile</h2>
      <ModelProfile session={session} data={data} byId={byId} />
    </div>
  );
}
