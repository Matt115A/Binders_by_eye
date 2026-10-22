"""Step 2: download biological assembly 1 of each kept complex and write a clean two-chain PDB.

Keeps only the two protein chains (renamed A and B, A = the larger "target", B = the smaller "binder"),
standard residues with complete backbones, no waters, ligands, hydrogens or alternate locations.
Residues are renumbered 1..n per chain so the mutation and viewer code can use plain indices, and the
author numbering is kept in data/work/real/{pdb}.json alongside the sequence actually present in the model.
"""
import json, os, sys
import gemmi
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
RAW = f'{ROOT}/data/raw/assemblies'
OUT = f'{WORK}/real'
BACKBONE = ('N', 'CA', 'C', 'O')
for d in (RAW, OUT):
    os.makedirs(d, exist_ok=True)


def download(pdb: str) -> str:
    path = f'{RAW}/{pdb}-assembly1.cif'
    if not os.path.exists(path):
        r = requests.get(f'https://files.rcsb.org/download/{pdb}-assembly1.cif', timeout=120)
        r.raise_for_status()
        open(path, 'wb').write(r.content)
    return path


def clean(pdb: str):
    """Return (structure with chains A/B, meta) or (None, reason)."""
    st = gemmi.read_structure(download(pdb))
    st.setup_entities()
    st.remove_alternative_conformations()
    st.remove_hydrogens()
    st.remove_ligands_and_waters()
    model = st[0]
    # keep polymer chains with standard residues and full backbones
    chains = []
    for ch in model:
        res = []
        for r in ch:
            info = gemmi.find_tabulated_residue(r.name)
            if not (info and info.is_amino_acid() and info.one_letter_code.upper() in 'ACDEFGHIKLMNPQRSTVWY'):
                continue
            if any(r.find_atom(a, '*') is None for a in BACKBONE):
                continue
            res.append(r)
        if len(res) >= 40:
            chains.append((ch.name, res))
    if len(chains) != 2:
        return None, f'{len(chains)} usable protein chains in assembly 1'
    # A = larger (target), B = smaller (binder)
    chains.sort(key=lambda c: -len(c[1]))
    new = gemmi.Structure()
    new.name = pdb
    new.spacegroup_hm = 'P 1'
    nm = gemmi.Model('1')
    meta = {'pdb': pdb, 'chains': []}
    for name, (orig, res) in zip('AB', chains):
        nch = gemmi.Chain(name)
        seq, auth = [], []
        for i, r in enumerate(res, start=1):
            nr = gemmi.Residue()
            nr.name = r.name
            nr.seqid = gemmi.SeqId(i, ' ')
            nr.het_flag = 'A'
            for a in r:
                if a.element == gemmi.Element('H') or a.altloc not in (' ', '\0', 'A'):
                    continue
                na = gemmi.Atom()
                na.name, na.element, na.pos, na.occ, na.b_iso = a.name, a.element, a.pos, 1.0, a.b_iso
                na.altloc = '\0'
                nr.add_atom(na)
            nch.add_residue(nr)
            seq.append(gemmi.find_tabulated_residue(r.name).one_letter_code.upper())
            auth.append(f'{orig}{r.seqid.num}{r.seqid.icode.strip()}')
        nm.add_chain(nch)
        meta['chains'].append({'chain': name, 'source_chain': orig, 'n': len(res), 'seq': ''.join(seq), 'auth': auth})
    new.add_model(nm)
    return new, meta


def main():
    complexes = json.load(open(f'{WORK}/complexes.json'))
    kept, dropped = [], []
    for c in complexes:
        try:
            st, meta = clean(c['pdb'])
        except Exception as e:                                  # noqa: BLE001 - any parse/download problem just drops the entry
            st, meta = None, f'{type(e).__name__}: {e}'
        if st is None:
            dropped.append({'pdb': c['pdb'], 'dropped': meta})
            print(f'  drop {c["pdb"]}: {meta}', file=sys.stderr)
            continue
        st.write_pdb(f'{OUT}/{c["pdb"]}.pdb')
        # carry the RCSB description of each chain across, matched by sequence
        for mc in meta['chains']:
            src = min(c['chains'], key=lambda e: 0 if e['seq'] == mc['seq'] else (1 if mc['seq'] in e['seq'] or e['seq'] in mc['seq'] else 2))
            mc['desc'] = src['desc']
            mc['organism'] = src['organism']
        meta.update(title=c['title'], released=c['released'], resolution=c['resolution'])
        json.dump(meta, open(f'{OUT}/{c["pdb"]}.json', 'w'), indent=1)
        kept.append(meta)
        print(f'  ok {c["pdb"]}  A={meta["chains"][0]["n"]}  B={meta["chains"][1]["n"]}', file=sys.stderr)
    json.dump(kept, open(f'{WORK}/structures.json', 'w'), indent=1)
    json.dump(dropped, open(f'{WORK}/structures_dropped.json', 'w'), indent=1)
    print(f'{len(kept)} structures written, {len(dropped)} dropped', file=sys.stderr)


if __name__ == '__main__':
    main()
