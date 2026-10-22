"""Write data/work/model_jobs.json: the sequence pairs Boltz-2 and AF2-multimer are asked to fold.

Sequence only, exactly as a binder-design pipeline would screen a candidate: the two chains of an item,
with no hint of the crystal pose and no marking of which positions were changed.

    .venv/bin/python pipeline/model_jobs.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'

items = json.load(open(f'{WORK}/items.json'))
jobs = [{'id': it['id'], 'seq_a': it['seqs'][0], 'seq_b': it['seqs'][1],
         'len': len(it['seqs'][0]) + len(it['seqs'][1])} for it in items]
jobs.sort(key=lambda j: j['len'])          # short complexes first: failures surface early and cheaply
json.dump(jobs, open(f'{WORK}/model_jobs.json', 'w'), indent=1)
print(f'{len(jobs)} jobs, {min(j["len"] for j in jobs)}-{max(j["len"] for j in jobs)} residues, '
      f'{sum(j["len"] for j in jobs) / len(jobs):.0f} mean')
