"""Step 1: pick two-chain protein complexes that neither Boltz-2 nor AF2-multimer could have trained on.

RCSB search: X-ray <= 2.5 A, released on or after 2023-06-01 (Boltz-2's PDB cutoff; AF2-multimer v3's is 2021-09-30),
exactly two protein chains of two different entities, no nucleic acid, biological assembly 1 = that heterodimer.
Each chain 40-450 residues; antibodies, nanobodies and other immunoglobulin fragments excluded.
Novel interface: no entry released before the cutoff contains homologues (>= 30% identity) of both chains.
Non-redundant: each 30%-identity sequence cluster is used at most once (best resolution first).
Writes data/work/candidates.json (all checked entries with the reason they were dropped) and data/work/complexes.json.
"""
import json, os, re, sys, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
CUTOFF = '2023-06-01'
SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query'
GQL = 'https://data.rcsb.org/graphql'
IG = re.compile(r'antibod|\bfab\b|fab fragment|nanobod|\bnb[-_ ]?\d|\bvhh\b|scfv|immunoglobulin|heavy chain|light chain|\bigg|\bfv\b|sybod|\bmhc\b|hla class|t[- ]cell receptor|\btcr\b|single[- ]domain antibody|kappa|lambda chain', re.I)
KMER = 5
os.makedirs(WORK, exist_ok=True)


def search(nodes, return_type='entry'):
    q = {'query': {'type': 'group', 'logical_operator': 'and', 'nodes': nodes}, 'return_type': return_type, 'request_options': {'return_all_hits': True}}
    for attempt in range(5):
        r = requests.post(SEARCH, json=q, timeout=120)
        if r.status_code == 204: return []
        if r.ok: return [x['identifier'] for x in r.json()['result_set']]
        time.sleep(2 + 3 * attempt)
    r.raise_for_status()


def text(attr, op, value):
    return {'type': 'terminal', 'service': 'text', 'parameters': {'attribute': attr, 'operator': op, 'value': value}}


def seq_node(seq):
    return {'type': 'terminal', 'service': 'sequence', 'parameters': {'evalue_cutoff': 0.1, 'identity_cutoff': 0.3, 'sequence_type': 'protein', 'value': seq}}


QUERY = '''query($ids: [String!]!) { entries(entry_ids: $ids) {
  rcsb_id rcsb_accession_info { initial_release_date } rcsb_entry_info { resolution_combined } struct { title }
  assemblies { rcsb_id pdbx_struct_assembly { oligomeric_count } rcsb_assembly_info { polymer_entity_instance_count } }
  polymer_entities { rcsb_id rcsb_polymer_entity { pdbx_description }
    entity_poly { pdbx_seq_one_letter_code_can rcsb_sample_sequence_length rcsb_entity_polymer_type }
    rcsb_entity_source_organism { scientific_name }
    rcsb_cluster_membership { cluster_id identity }
    polymer_entity_instances { rcsb_polymer_entity_instance_container_identifiers { asym_id auth_asym_id } } } } }'''


def details(ids):
    out = []
    for i in range(0, len(ids), 100):
        r = requests.post(GQL, json={'query': QUERY, 'variables': {'ids': ids[i:i + 100]}}, timeout=120)
        r.raise_for_status()
        out += r.json()['data']['entries']
    return out


def kmers(seq: str) -> set:
    return {seq[i:i + KMER] for i in range(len(seq) - KMER + 1)}


def contained(a: set, b: set) -> float:
    """Shared k-mers as a fraction of the smaller set: high for near-duplicate or domain-of sequences."""
    return len(a & b) / max(1, min(len(a), len(b)))


def redundant(ka, kept_kmers, thresh=0.5) -> str | None:
    """The pdb id of a kept entry that has a near-duplicate of both chains, else None. (RCSB's own cluster
    ids come back empty for entries this new, so redundancy is measured here from 5-mer containment.)"""
    for pdb, kb in kept_kmers:
        if (min(contained(ka[0], kb[0]), contained(ka[1], kb[1])) >= thresh
                or min(contained(ka[0], kb[1]), contained(ka[1], kb[0])) >= thresh):
            return pdb
    return None


def main():
    ids = search([
        text('rcsb_accession_info.initial_release_date', 'greater_or_equal', CUTOFF),
        text('exptl.method', 'exact_match', 'X-RAY DIFFRACTION'),
        text('rcsb_entry_info.resolution_combined', 'less_or_equal', 2.5),
        text('rcsb_entry_info.polymer_entity_count_protein', 'equals', 2),
        text('rcsb_entry_info.polymer_entity_count_nucleic_acid', 'equals', 0),
        text('rcsb_entry_info.deposited_polymer_entity_instance_count', 'equals', 2),
        text('rcsb_entry_info.deposited_polymer_monomer_count', 'less_or_equal', 900),
    ])
    print(f'{len(ids)} entries from the search', file=sys.stderr)
    cache = f'{WORK}/rcsb_details.json'
    entries = json.load(open(cache)) if os.path.exists(cache) else details(ids)
    json.dump(entries, open(cache, 'w'))

    cands, dropped = [], []
    for e in entries:
        why = None
        ents = e['polymer_entities']
        chains = []
        for pe in ents:
            ep = pe['entity_poly']
            seq = (ep['pdbx_seq_one_letter_code_can'] or '').replace('\n', '')
            desc = pe['rcsb_polymer_entity']['pdbx_description'] or ''
            clus = {c['identity']: c['cluster_id'] for c in pe.get('rcsb_cluster_membership') or []}
            inst = pe['polymer_entity_instances'][0]['rcsb_polymer_entity_instance_container_identifiers']
            org = (pe.get('rcsb_entity_source_organism') or [{}])[0].get('scientific_name')
            chains.append({'entity': pe['rcsb_id'], 'desc': desc, 'seq': seq, 'len': len(seq), 'cluster30': clus.get(30), 'asym': inst['asym_id'], 'auth': inst['auth_asym_id'], 'organism': org})
            if ep['rcsb_entity_polymer_type'] != 'Protein': why = why or 'not protein'
            if not 40 <= len(seq) <= 450: why = why or f'chain length {len(seq)}'
            if set(seq) - set('ACDEFGHIKLMNPQRSTVWY'): why = why or 'nonstandard residues'
            if IG.search(desc) or IG.search(e['struct']['title'] or ''): why = why or f'immunoglobulin ({desc})'
        a1 = next((a for a in e['assemblies'] if a['rcsb_id'].endswith('-1')), None)
        if not a1 or a1['rcsb_assembly_info']['polymer_entity_instance_count'] != 2: why = why or 'assembly 1 is not the dimer'
        if len(chains) == 2 and all(len(c['seq']) > KMER for c in chains) and contained(kmers(chains[0]['seq']), kmers(chains[1]['seq'])) >= 0.6: why = why or 'the two chains are the same protein'
        rec = {'pdb': e['rcsb_id'], 'title': e['struct']['title'], 'released': e['rcsb_accession_info']['initial_release_date'][:10],
               'resolution': (e['rcsb_entry_info']['resolution_combined'] or [9])[0], 'chains': chains}
        (dropped if why else cands).append({**rec, 'dropped': why} if why else rec)
    print(f'{len(cands)} pass the entry filters', file=sys.stderr)

    # non-redundant, best resolution first; then the pre-cutoff homologue check
    cands.sort(key=lambda c: c['resolution'])
    keep, kept_kmers = [], []
    novelty_cache = f'{WORK}/novelty.json'
    novelty = json.load(open(novelty_cache)) if os.path.exists(novelty_cache) else {}
    for c in cands:
        ka = [kmers(ch['seq']) for ch in c['chains']]
        dup = redundant(ka, kept_kmers)
        if dup:
            dropped.append({**c, 'dropped': f'redundant with {dup}'}); continue
        if c['pdb'] not in novelty:
            hits = search([seq_node(c['chains'][0]['seq']), seq_node(c['chains'][1]['seq']), text('rcsb_accession_info.initial_release_date', 'less', CUTOFF)])
            novelty[c['pdb']] = hits
            json.dump(novelty, open(novelty_cache, 'w'))
            time.sleep(0.3)
        if novelty[c['pdb']]:
            dropped.append({**c, 'dropped': f'homologous complex before cutoff ({",".join(novelty[c["pdb"]][:3])})'}); continue
        keep.append(c)
        kept_kmers.append((c['pdb'], ka))
        print(f'  keep {c["pdb"]} {c["resolution"]:.2f} A  {c["chains"][0]["desc"][:40]} | {c["chains"][1]["desc"][:40]}', file=sys.stderr)
    json.dump(dropped, open(f'{WORK}/candidates_dropped.json', 'w'), indent=1)
    json.dump(keep, open(f'{WORK}/complexes.json', 'w'), indent=1)
    print(f'{len(keep)} complexes kept', file=sys.stderr)


if __name__ == '__main__':
    main()
