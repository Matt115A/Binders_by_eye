"""Boltz-2 on Modal: predict every game item's complex from sequence alone and keep its interface confidence.

Each item is two sequences (the real pair, or the pair with 50% of the interface randomised). Boltz-2 never sees
the crystal structure, and every complex was released after its training cutoff, so this is a fair zero-shot call.
What the game scores is ipTM: Boltz-2's own confidence that the two chains form the interface it just predicted.

    modal run pipeline/modal_boltz2.py --jobs data/work/model_jobs.json --out data/work/boltz2.json

MSAs come from the ColabFold MSA server (the same one the Boltz authors use), cached in a Modal volume so a
re-run of the same sequences costs nothing. Results are written incrementally: an interrupted run resumes.
"""
import json
import os
import pathlib

import modal

CACHE = '/cache'
WEIGHTS = '/boltz'
image = (
    modal.Image.debian_slim(python_version='3.11')
    .apt_install('wget', 'git')
    .pip_install('boltz==2.2.1', 'numpy<2')
    # weights and CCD baked into the image once: containers extracting them into a shared volume race and corrupt it
    .env({'BOLTZ_CACHE': WEIGHTS})
    .run_commands(f"mkdir -p {WEIGHTS}", f"python -c 'from pathlib import Path; from boltz.main import download_boltz2; download_boltz2(Path(\"{WEIGHTS}\"))'")
)
app = modal.App('binders-boltz2')
vol = modal.Volume.from_name('binders-boltz2-cache', create_if_missing=True)


def item_yaml(seq_a: str, seq_b: str) -> str:
    return (
        'version: 1\nsequences:\n'
        f'  - protein:\n      id: A\n      sequence: {seq_a}\n'
        f'  - protein:\n      id: B\n      sequence: {seq_b}\n'
    )


@app.function(image=image, gpu='A100-40GB', volumes={CACHE: vol}, timeout=60 * 60 * 6, retries=1, max_containers=5)
def predict(batch: list[dict], recycles: int = 3, samples: int = 1) -> dict:
    import subprocess
    import tempfile

    done_path = pathlib.Path(f'{CACHE}/boltz2_results.json')
    done = json.loads(done_path.read_text()) if done_path.exists() else {}
    for job in batch:
        if 'error' not in done.get(job['id'], {'error': ''}):   # finished; failures are retried
            continue
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / f'{job["id"]}.yaml'
            src.write_text(item_yaml(job['seq_a'], job['seq_b']))
            out = pathlib.Path(tmp) / 'out'
            cmd = ['boltz', 'predict', str(src), '--out_dir', str(out), '--use_msa_server',
                   '--recycling_steps', str(recycles), '--diffusion_samples', str(samples),
                   '--output_format', 'pdb', '--cache', WEIGHTS, '--no_kernels']
            try:   # a hang is recorded as a failure rather than holding a GPU for hours
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=30 * 60)
            except subprocess.TimeoutExpired as e:
                r = subprocess.CompletedProcess(cmd, -1, str(e.stdout or '')[-800:], 'timed out after 30 min')
            conf = sorted(out.rglob('confidence_*_model_0.json'))
            if not conf:
                done[job['id']] = {'error': (r.stdout[-800:] + r.stderr[-800:]).strip()}
                print(f'{job["id"]}: FAILED', flush=True)
            else:
                c = json.loads(conf[0].read_text())
                done[job['id']] = {k: c[k] for k in ('confidence_score', 'ptm', 'iptm', 'complex_plddt',
                                                     'complex_iplddt', 'complex_pde', 'complex_ipde') if k in c}
                pair = c.get('pair_chains_iptm') or {}
                done[job['id']]['pair_iptm'] = (pair.get('0') or {}).get('1')
                print(f'{job["id"]}: iptm={done[job["id"]].get("iptm"):.3f}', flush=True)
        done_path.write_text(json.dumps(done))
        vol.commit()
    return done


@app.local_entrypoint()
def main(jobs: str = 'data/work/model_jobs.json', out: str = 'data/work/boltz2.json', batch: int = 20):
    todo = json.load(open(jobs))
    results: dict = json.load(open(out)) if os.path.exists(out) else {}
    todo = [j for j in todo if 'error' in results.get(j['id'], {'error': ''})]   # not yet run, or failed
    print(f'{len(todo)} items to predict')
    chunks = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    for got in predict.map(chunks, kwargs={'recycles': 3, 'samples': 1}):
        results.update(got)
        json.dump(results, open(out, 'w'), indent=1)
    ok = [v for v in results.values() if 'iptm' in v]
    print(f'{len(ok)} predictions, {len(results) - len(ok)} failures -> {out}')
