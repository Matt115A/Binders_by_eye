"""AlphaFold2-multimer on Modal, via ColabFold: the same zero-shot call as Boltz-2, from an older generation.

AF2-multimer v3's training set stops at 2021-09-30 and every complex here was released after 2023-06-01,
so, like Boltz-2, it is predicting a complex it has never seen, from sequence alone. The score the game uses
is ipTM, AF2's own confidence in the relative placement of the two chains, which is what binder-design
pipelines filter on in practice.

    modal run pipeline/modal_af2.py --jobs data/work/model_jobs.json --out data/work/af2.json

MSAs come from the public MMseqs2 server that ColabFold uses; weights and MSAs are cached in a Modal volume.
"""
import json
import os
import pathlib

import modal

CACHE = '/vol'          # the ColabFold image already uses /cache for its own config
PARAMS = '/colabfold'
# ColabFold's own image (conda env with a matched jax/jaxlib and CUDA): pip-assembled jax stacks either lacked
# ptxas or compiled every op for minutes. Weights baked in once rather than per container.
# ColabFold runs from its conda env (Python 3.9); Modal needs >= 3.10, so the container's own Python is the conda
# base at /usr/local (add_python can't be used: it installs into /usr/local too and collides with conda's)
CF = '/usr/local/envs/colabfold/bin'
image = (
    modal.Image.from_registry('ghcr.io/sokrypton/colabfold:1.5.5-cuda12.2.2')
    .env({'PATH': '/usr/local/bin:/usr/local/cuda/bin:/usr/bin:/bin'})   # cuda/bin holds ptxas: without it XLA compiles at a crawl
    .run_commands("python -c 'import sys; print(sys.version); assert sys.version_info >= (3, 10)'")
    .run_commands(f"{CF}/python -c 'from pathlib import Path; from colabfold.download import download_alphafold_params; "
                  f"download_alphafold_params(\"alphafold2_multimer_v3\", Path(\"{PARAMS}\"))'")
    .env({'XLA_PYTHON_CLIENT_PREALLOCATE': 'false', 'TF_FORCE_UNIFIED_MEMORY': '1'})
)
app = modal.App('binders-af2')
vol = modal.Volume.from_name('binders-af2-cache', create_if_missing=True)


@app.function(image=image, gpu='A100-40GB', volumes={CACHE: vol}, timeout=60 * 60 * 6, retries=1, max_containers=5)
def predict(batch: list[dict], recycles: int = 3, models: int = 1) -> dict:
    import subprocess
    import tempfile

    done_path = pathlib.Path(f'{CACHE}/af2_results.json')
    done = json.loads(done_path.read_text()) if done_path.exists() else {}
    for job in batch:
        if 'error' not in done.get(job['id'], {'error': ''}):   # finished; failures are retried
            continue
        with tempfile.TemporaryDirectory() as tmp:
            fa = pathlib.Path(tmp) / 'in.fasta'
            fa.write_text(f'>{job["id"]}\n{job["seq_a"]}:{job["seq_b"]}\n')
            out = pathlib.Path(tmp) / 'out'
            cmd = [f'{CF}/colabfold_batch', str(fa), str(out), '--model-type', 'alphafold2_multimer_v3',
                   '--num-recycle', str(recycles), '--num-models', str(models), '--num-seeds', '1',
                   '--data', PARAMS, '--host-url', 'https://api.colabfold.com']
            try:   # a hang is recorded as a failure rather than holding a GPU for hours
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=30 * 60,
                                   env={**os.environ, 'PATH': f"{CF}:{os.environ['PATH']}"})
            except subprocess.TimeoutExpired as e:
                r = subprocess.CompletedProcess(cmd, -1, str(e.stdout or '')[-800:], 'timed out after 30 min')
            scores = sorted(out.glob('*scores_rank_001*.json'))
            if not scores:
                done[job['id']] = {'error': (r.stdout[-800:] + r.stderr[-800:]).strip()}
                print(f'{job["id"]}: FAILED', flush=True)
            else:
                s = json.loads(scores[0].read_text())
                done[job['id']] = {'iptm': s.get('iptm'), 'ptm': s.get('ptm'),
                                   'plddt': float(sum(s['plddt']) / len(s['plddt'])) if s.get('plddt') else None,
                                   'ranking_confidence': 0.8 * (s.get('iptm') or 0) + 0.2 * (s.get('ptm') or 0)}
                print(f'{job["id"]}: iptm={done[job["id"]]["iptm"]}', flush=True)
        done_path.write_text(json.dumps(done))
        vol.commit()
    return done


@app.local_entrypoint()
def main(jobs: str = 'data/work/model_jobs.json', out: str = 'data/work/af2.json', batch: int = 20):
    todo = json.load(open(jobs))
    results: dict = json.load(open(out)) if os.path.exists(out) else {}
    todo = [j for j in todo if 'error' in results.get(j['id'], {'error': ''})]   # not yet run, or failed
    print(f'{len(todo)} items to predict')
    chunks = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    for got in predict.map(chunks):
        results.update(got)
        json.dump(results, open(out, 'w'), indent=1)
    ok = [v for v in results.values() if v.get('iptm') is not None]
    print(f'{len(ok)} predictions, {len(results) - len(ok)} failures -> {out}')
