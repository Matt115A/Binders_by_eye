"""Step 3: turn each real complex into one real and one fake game item.

Interface = every residue with a heavy atom within 5.0 A of a heavy atom of the other chain.
A fake mutates MUT_FRACTION (0.5) of the interface positions, drawn at random across both chains,
each to a different random amino acid (cysteine excluded, so no spurious disulfides appear).

Both items are then repacked from scratch with FASPR on the crystal backbone, the real one included.
That matters: if only the fakes were repacked, their side chains would carry a tell-tale signature
(ideal rotamers, no crystal-strained conformers) and the game could be won without looking at the interface.
After repacking, the two chains are identical in provenance and differ only in interface sequence.

Writes data/work/items.json and data/work/pdb_game/{item_id}.pdb.
"""
import json, os, random, shutil, subprocess, sys, tempfile
import gemmi
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
REAL = f'{WORK}/real'
OUT = f'{WORK}/pdb_game'
FASPR = f'{ROOT}/tools/FASPR/FASPR'
CUT = 5.0
MUT_FRACTION = 0.5
CHOICES = 'ADEFGHIKLMNPQRSTVWY'   # the 20 standard amino acids minus cysteine
SEED = 20261021
os.makedirs(OUT, exist_ok=True)


def atom_array(chain):
    """(positions, residue index per atom) for every heavy atom of a chain."""
    pos, who = [], []
    for ri, res in enumerate(chain):
        for a in res:
            pos.append([a.pos.x, a.pos.y, a.pos.z])
            who.append(ri)
    return np.array(pos), np.array(who)


def interface(st: gemmi.Structure, cut=CUT):
    """Residue indices (0-based, per chain) with any heavy atom within `cut` of the other chain."""
    a, b = st[0]
    pa, wa = atom_array(a)
    pb, wb = atom_array(b)
    close = np.linalg.norm(pa[:, None, :] - pb[None, :, :], axis=-1) <= cut
    return {a.name: set(wa[close.any(axis=1)].tolist()), b.name: set(wb[close.any(axis=0)].tolist())}


def faspr(in_pdb: str, out_pdb: str, seqs: list[str]):
    """Repack (and optionally mutate) with FASPR. `seqs` is one sequence per chain, in chain order."""
    with tempfile.TemporaryDirectory() as tmp:
        seq_file = f'{tmp}/seq.txt'
        open(seq_file, 'w').write(''.join(seqs) + '\n')
        # FASPR looks for its rotamer library in its own directory, so it runs from there with absolute paths
        r = subprocess.run([FASPR, '-i', os.path.abspath(in_pdb), '-o', os.path.abspath(out_pdb), '-s', seq_file],
                           cwd=os.path.dirname(FASPR), capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out_pdb):
        raise RuntimeError(f'FASPR failed: {r.stdout[-300:]} {r.stderr[-300:]}')


def main():
    metas = json.load(open(f'{WORK}/structures.json'))
    rng = random.Random(SEED)
    items, dropped = [], []
    for meta in metas:
        pdb = meta['pdb']
        src = f'{REAL}/{pdb}.pdb'
        st = gemmi.read_structure(src)
        st.setup_entities()
        iface = interface(st)
        seqs = [c['seq'] for c in meta['chains']]
        sites = [(ci, ri) for ci, ch in enumerate('AB') for ri in sorted(iface[ch])]
        n_mut = round(len(sites) * MUT_FRACTION)
        if len(sites) < 10 or n_mut < 5:
            dropped.append({'pdb': pdb, 'dropped': f'only {len(sites)} interface residues'})
            print(f'  drop {pdb}: {len(sites)} interface residues', file=sys.stderr)
            continue
        chosen = sorted(rng.sample(sites, n_mut))
        mut_seqs = [list(s) for s in seqs]
        muts = []
        for ci, ri in chosen:
            wt = seqs[ci][ri]
            mt = rng.choice([a for a in CHOICES if a != wt])
            mut_seqs[ci][ri] = mt
            muts.append({'chain': 'AB'[ci], 'i': ri + 1, 'wt': wt, 'mt': mt, 'auth': meta['chains'][ci]['auth'][ri]})
        iface_list = [{'chain': 'AB'[ci], 'i': ri + 1} for ci, ri in sites]
        try:
            for kind, use in (('real', seqs), ('fake', [''.join(s) for s in mut_seqs])):
                faspr(src, f'{OUT}/{pdb}_{kind}.pdb', use)
        except RuntimeError as e:
            dropped.append({'pdb': pdb, 'dropped': str(e)})
            print(f'  drop {pdb}: {e}', file=sys.stderr)
            continue
        for kind in ('real', 'fake'):
            items.append({
                'id': f'{pdb}_{kind}', 'pdb': pdb, 'label': 1 if kind == 'real' else 0, 'kind': kind,
                'title': meta['title'], 'released': meta['released'], 'resolution': meta['resolution'],
                'chains': [{k: c[k] for k in ('chain', 'source_chain', 'n', 'desc', 'organism')} for c in meta['chains']],
                'seqs': seqs if kind == 'real' else [''.join(s) for s in mut_seqs],
                'interface': iface_list, 'n_interface': len(sites),
                'mutations': [] if kind == 'real' else muts,
            })
        print(f'  ok {pdb}  interface {len(sites)} residues, {n_mut} mutated', file=sys.stderr)
    json.dump(items, open(f'{WORK}/items.json', 'w'), indent=1)
    json.dump(dropped, open(f'{WORK}/items_dropped.json', 'w'), indent=1)
    print(f'{len(items)} items ({len(items) // 2} complexes), {len(dropped)} dropped', file=sys.stderr)


if __name__ == '__main__':
    main()
