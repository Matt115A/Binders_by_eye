"""Step 6: ESM2 sequence-only baseline — can a protein language model tell the sequence was tampered with?

ESM2 sees one chain's sequence at a time and nothing else: no partner, no structure, no idea where the
interface is. For every interface position it is given the chain with that position masked, and we keep the
log probability of the residue that is actually there, averaged over the interface. A real interface should
look like ordinary protein; a randomised one should not.

This is the control that separates "spotting an implausible sequence" from "judging an interface": any model
that beats ESM2 is using the structure, not just sequence plausibility.

Run with the model interpreter (torch + fair-esm):  python3 pipeline/esm_scores.py
"""
import json, os, time
import numpy as np, torch, esm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
NAME = 'esm2_t33_650M_UR50D'
BATCH = 8
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'


def main():
    items = json.load(open(f'{WORK}/items.json'))
    out_path = f'{WORK}/esm.json'
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    todo = [it for it in items if it['id'] not in out]
    if not todo:
        print('nothing to do')
        return
    model, alphabet = getattr(esm.pretrained, NAME)()
    model = model.eval().to(dev)
    conv = alphabet.get_batch_converter()
    t0 = time.time()
    for k, it in enumerate(todo):
        got = []
        for ci, (seq, chain) in enumerate(zip(it['seqs'], 'AB')):
            pos = [r['i'] - 1 for r in it['interface'] if r['chain'] == chain]
            for i in range(0, len(pos), BATCH):
                chunk = pos[i:i + BATCH]
                _, _, toks = conv([(str(p), seq) for p in chunk])
                toks = toks.to(dev)
                rows = torch.arange(len(chunk))
                cols = torch.tensor(chunk) + 1                      # +1 for <cls>
                true = toks[rows, cols].clone()
                toks[rows, cols] = alphabet.mask_idx
                with torch.no_grad():
                    logits = model(toks)['logits']
                lsm = torch.log_softmax(logits[rows, cols], -1)
                got += [float(lsm[j, true[j]]) for j in range(len(chunk))]
        out[it['id']] = {'esm2_650M': float(np.mean(got))}
        json.dump(out, open(out_path, 'w'), indent=1)
        print(f'[{k + 1}/{len(todo)}] {it["id"]} esm2={out[it["id"]]["esm2_650M"]:+.3f} ({time.time() - t0:.0f}s)', flush=True)
    r = [v['esm2_650M'] for i, v in out.items() if i.endswith('_real')]
    f = [v['esm2_650M'] for i, v in out.items() if i.endswith('_fake')]
    if r and f:
        print(f'mean esm2: real {np.mean(r):+.3f}  fake {np.mean(f):+.3f}')


if __name__ == '__main__':
    main()
