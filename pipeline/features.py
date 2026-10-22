"""Step 5: interface biophysics for every item — the cues a player can actually see in the 3D view.

All of these are read off the docked structure the player is looking at, so a model built on them is the
"sees what you see" baseline. Nothing here uses the label, the mutation list or which chain came from where.

  bsa            buried solvent-accessible area (A^2): SASA(A) + SASA(B) - SASA(AB), Shrake-Rupley
  n_contacts     heavy-atom pairs across the interface within 4.5 A
  clashes        heavy-atom pairs within 2.2 A (atoms pushed into each other)
  hbonds         N/O donor-acceptor pairs across the interface within 3.5 A
  salt_bridges   oppositely charged side-chain N/O pairs within 4.0 A
  hydrophobic    share of buried interface area contributed by carbon/sulfur atoms
  unsat_polar    buried interface N/O atoms with no partner N/O within 3.5 A
  charge_product net charge of the interface residues of A times that of B (negative = complementary)
  packing        mean number of partner heavy atoms within 6 A of each interface heavy atom
  gap_volume     bsa per contact, a crude measure of how loosely the two faces meet

Run with the structure interpreter: .venv/bin/python pipeline/features.py
"""
import json, os
import numpy as np
from Bio.PDB import PDBParser
from Bio.PDB.SASA import ShrakeRupley

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
GAME = f'{WORK}/pdb_game'
POSITIVE, NEGATIVE = {'ARG', 'LYS'}, {'ASP', 'GLU'}
DONOR_ACCEPTOR = ('N', 'O')
FEATURES = ['bsa', 'n_contacts', 'clashes', 'hbonds', 'salt_bridges', 'hydrophobic', 'unsat_polar',
            'charge_product', 'packing', 'gap_volume']


def chain_atoms(chain):
    return [a for r in chain for a in r if a.element != 'H']


def sasa_of(entity, level='A'):
    ShrakeRupley().compute(entity, level=level)


def compute(path: str) -> dict:
    s = PDBParser(QUIET=True).get_structure('x', path)
    model = s[0]
    a, b = model['A'], model['B']
    # SASA of the complex, then of each chain alone (on copies, since compute() writes onto the atoms)
    sasa_of(model)
    sasa_complex = {(ch.id, r.id[1], at.get_id()): at.sasa for ch in model for r in ch for at in r}
    alone = {}
    for ch_id in 'AB':
        one = PDBParser(QUIET=True).get_structure('x', path)[0][ch_id]
        sasa_of(one)
        for r in one:
            for at in r:
                alone[(ch_id, r.id[1], at.get_id())] = at.sasa
    bsa = sum(alone[k] - sasa_complex[k] for k in sasa_complex)

    pa, pb = chain_atoms(a), chain_atoms(b)
    xa = np.array([at.coord for at in pa])
    xb = np.array([at.coord for at in pb])
    d = np.linalg.norm(xa[:, None, :] - xb[None, :, :], axis=-1)
    n_contacts = int((d <= 4.5).sum())
    clashes = int((d <= 2.2).sum())

    pol_a = [i for i, at in enumerate(pa) if at.element in DONOR_ACCEPTOR]
    pol_b = [j for j, at in enumerate(pb) if at.element in DONOR_ACCEPTOR]
    hb = d[np.ix_(pol_a, pol_b)] if pol_a and pol_b else np.zeros((0, 0))
    hbonds = int((hb <= 3.5).sum())

    def charged(atoms, kinds):
        return [i for i, at in enumerate(atoms)
                if at.get_parent().get_resname() in kinds and at.element in DONOR_ACCEPTOR and at.get_id() not in ('N', 'O')]
    salt = 0
    for ka, kb in ((POSITIVE, NEGATIVE), (NEGATIVE, POSITIVE)):
        ia, ib = charged(pa, ka), charged(pb, kb)
        if ia and ib:
            salt += int((d[np.ix_(ia, ib)] <= 4.0).sum())

    # per-atom burial, used for the hydrophobic share and unsatisfied polars
    buried_c, buried_all, unsat = 0.0, 0.0, 0
    for ch_id, atoms, others, dmat in (('A', pa, pb, d), ('B', pb, pa, d.T)):
        for i, at in enumerate(atoms):
            k = (ch_id, at.get_parent().id[1], at.get_id())
            db = alone[k] - sasa_complex[k]
            if db <= 0.1:
                continue
            buried_all += db
            if at.element in ('C', 'S'):
                buried_c += db
            elif at.element in DONOR_ACCEPTOR:
                near = [j for j, o in enumerate(others) if o.element in DONOR_ACCEPTOR]
                if not near or dmat[i, near].min() > 3.5:
                    unsat += 1

    def iface_charge(chain, atoms, others_xyz):
        xyz = np.array([at.coord for at in atoms])
        dd = np.linalg.norm(xyz[:, None, :] - others_xyz[None, :, :], axis=-1).min(axis=1)
        res = {at.get_parent().id[1]: at.get_parent().get_resname() for at, close in zip(atoms, dd <= 5.0) if close}
        return sum((1 if n in POSITIVE else -1 if n in NEGATIVE else 0) for n in res.values())

    qa, qb = iface_charge(a, pa, xb), iface_charge(b, pb, xa)
    near_counts = (d <= 6.0).sum(axis=1)
    iface_a = near_counts[(d <= 5.0).any(axis=1)]
    return {
        'bsa': round(float(bsa) / 2, 1),                     # buried area is shared between the two faces
        'n_contacts': n_contacts,
        'clashes': clashes,
        'hbonds': hbonds,
        'salt_bridges': salt,
        'hydrophobic': round(float(buried_c / buried_all), 4) if buried_all else 0.0,
        'unsat_polar': unsat,
        'charge_product': int(qa * qb),
        'packing': round(float(iface_a.mean()), 2) if iface_a.size else 0.0,
        'gap_volume': round(float(bsa) / 2 / max(1, n_contacts), 3),
    }


def main():
    items = json.load(open(f'{WORK}/items.json'))
    out_path = f'{WORK}/features.json'
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    for k, it in enumerate(items):
        if it['id'] in out:
            continue
        out[it['id']] = compute(f'{GAME}/{it["id"]}.pdb')
        json.dump(out, open(out_path, 'w'), indent=1)
        print(f'[{k + 1}/{len(items)}] {it["id"]} ' + ' '.join(f'{f}={out[it["id"]][f]}' for f in ('bsa', 'clashes', 'hbonds', 'hydrophobic')), flush=True)
    for f in FEATURES:
        r = [v[f] for i, v in out.items() if i.endswith('_real')]
        k = [v[f] for i, v in out.items() if i.endswith('_fake')]
        if r and k:
            print(f'{f:15s} real {np.mean(r):9.2f}   fake {np.mean(k):9.2f}')


if __name__ == '__main__':
    main()
