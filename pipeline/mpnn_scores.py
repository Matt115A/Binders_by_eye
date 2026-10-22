"""Step 4: ProteinMPNN scores for every item — does this sequence fit this interface geometry?

For each item (real or fake) ProteinMPNN sees the crystal backbone, which is identical for the pair, and the
sequence, which differs at the mutated interface positions. Three numbers per item, all mean log p of the
residue that is actually there:

  mpnn_complex : over interface residues, given the whole two-chain backbone and every other residue
  mpnn_single  : the same residues, with only their own chain present (no partner)
  mpnn_delta   : complex - single, i.e. how much the partner chain improves the fit of the interface sequence.
                 This is the interface-complementarity term; it cancels out how foldable the chain is on its own.

Also mpnn_all (every residue, complex context), as a whole-structure sanity baseline.

This is the closest model to what the player sees: same docked backbone, same side chains, no extra information.
Run with an interpreter that has torch (the repo uses the system python3 that also runs ESM):
    python3 pipeline/mpnn_scores.py
"""
import json, os, sys, time
import numpy as np, torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, f'{ROOT}/tools/ProteinMPNN')
from protein_mpnn_utils import ProteinMPNN, StructureDatasetPDB, parse_PDB, tied_featurize   # noqa: E402

WORK = f'{ROOT}/data/work'
GAME = f'{WORK}/pdb_game'
MPNN_ALPHA = 'ACDEFGHIKLMNPQRSTVWYX'
dev = torch.device('cpu')
ck = torch.load(f'{ROOT}/tools/ProteinMPNN/vanilla_model_weights/v_48_020.pt', map_location=dev, weights_only=False)
model = ProteinMPNN(ca_only=False, num_letters=21, node_features=128, edge_features=128, hidden_dim=128,
                    num_encoder_layers=3, num_decoder_layers=3, augment_eps=0.0, k_neighbors=ck['num_edges'])
model.load_state_dict(ck['model_state_dict'])
model.eval()


def logp(pdb_path: str, chains: list[str], positions: list[tuple[str, int]]):
    """Mean log p of the present residue at `positions` [(chain, 0-based index)], decoded last, given the rest."""
    prot = StructureDatasetPDB(parse_PDB(pdb_path, input_chain_list=chains), truncate=None, max_length=100000)[0]
    X, S, mask, _lengths, chain_M, chain_enc, *rest = tied_featurize(
        [prot], dev, {prot['name']: (chains, [])}, None, None, None, None, None)
    residue_idx = rest[-8]
    # tied_featurize concatenates the chains in `chains` order; find each chain's offset
    offset, off = {}, 0
    for c in chains:
        offset[c] = off
        off += len(prot[f'seq_chain_{c}'])
    flat = [offset[c] + i for c, i in positions if c in offset]
    cm = torch.zeros_like(chain_M)
    cm[0, flat] = 1.0
    torch.manual_seed(1)
    randn = torch.randn(chain_M.shape)
    with torch.no_grad():
        lp = model.conditional_probs(X, S, mask, cm, residue_idx, chain_enc, randn, False)[0]
    lsm = torch.log_softmax(lp[:, :20], -1)
    got = [float(lsm[p, S[0, p].item()]) for p in flat if S[0, p].item() < 20]
    return float(np.mean(got)) if got else None


def main():
    items = json.load(open(f'{WORK}/items.json'))
    out_path = f'{WORK}/mpnn.json'
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    t0 = time.time()
    for k, it in enumerate(items):
        if it['id'] in out:
            continue
        path = f'{GAME}/{it["id"]}.pdb'
        iface = [(r['chain'], r['i'] - 1) for r in it['interface']]
        allpos = [(c, i) for c, n in (('A', it['chains'][0]['n']), ('B', it['chains'][1]['n'])) for i in range(n)]
        single = [logp(path, [c], [p for p in iface if p[0] == c]) for c in 'AB']
        n_per = [sum(1 for p in iface if p[0] == c) for c in 'AB']
        complex_ = logp(path, ['A', 'B'], iface)
        single_mean = float(np.average([s for s in single if s is not None],
                                       weights=[n for s, n in zip(single, n_per) if s is not None]))
        out[it['id']] = {'mpnn_complex': complex_, 'mpnn_single': single_mean,
                         'mpnn_delta': complex_ - single_mean, 'mpnn_all': logp(path, ['A', 'B'], allpos)}
        json.dump(out, open(out_path, 'w'), indent=1)
        print(f'[{k + 1}/{len(items)}] {it["id"]} delta={out[it["id"]]["mpnn_delta"]:+.3f} '
              f'complex={complex_:.3f} ({time.time() - t0:.0f}s)', flush=True)
    reals = [v['mpnn_delta'] for i, v in out.items() if i.endswith('_real')]
    fakes = [v['mpnn_delta'] for i, v in out.items() if i.endswith('_fake')]
    if reals and fakes:
        print(f'mean mpnn_delta: real {np.mean(reals):+.3f}  fake {np.mean(fakes):+.3f}')


if __name__ == '__main__':
    main()
