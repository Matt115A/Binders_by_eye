"""Step 7: assemble app/public/data/dataset.json and the structures the browser loads.

Scores from every model are turned into real/fake calls by thresholding at the median score over all items.
Items are balanced 50/50 by construction, so the median makes each model call exactly half of them real:
no model gets an advantage from a lucky threshold, and 50% is chance for everyone, player included.

The feature model ("sees what you see") is a gradient-boosted tree on the interface biophysics, scored with
leave-one-complex-out cross-validation, so it never trains on the complex it is judging.

Complexes are split into a learning group and a held-out group. Both items of a complex share a backbone,
so a session shows only one item per complex (the app enforces this); the split is by complex too.

Run with the structure interpreter: .venv/bin/python pipeline/build_dataset.py
"""
import json, os, shutil, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f'{ROOT}/data/work'
APP = f'{ROOT}/app/public/data'
VERSION = '1.0.0'
HELD_OUT = 0.3
SEED = 7

FEATURE_NAMES = ['bsa', 'n_contacts', 'clashes', 'hbonds', 'salt_bridges', 'hydrophobic', 'unsat_polar',
                 'charge_product', 'packing', 'gap_volume']

# name -> (label, kind, where the score lives, higher score means "real")
MODELS = [
    ('boltz2', 'Boltz-2 (ipTM)', 'folding', ('boltz2', 'iptm'), True),
    ('af2', 'AlphaFold2-multimer (ipTM)', 'folding', ('af2', 'iptm'), True),
    ('boltz2_plddt', 'Boltz-2 (interface pLDDT)', 'folding', ('boltz2', 'complex_iplddt'), True),
    ('mpnn_delta', 'ProteinMPNN (interface fit)', 'structure', ('mpnn', 'mpnn_delta'), True),
    ('mpnn_complex', 'ProteinMPNN (sequence given backbone)', 'structure', ('mpnn', 'mpnn_complex'), True),
    ('esm2_650M', 'ESM2 650M (sequence only)', 'plm', ('esm', 'esm2_650M'), True),
    ('feature_model', 'Feature model (sees what you see)', 'simple', None, True),
    ('no_clashes', 'Fewest clashing atoms', 'simple', ('features', 'clashes'), False),
    ('most_hbonds', 'Most hydrogen bonds', 'simple', ('features', 'hbonds'), True),
    ('biggest_interface', 'Largest buried area', 'simple', ('features', 'bsa'), True),
]


def load(name):
    path = f'{WORK}/{name}.json'
    if not os.path.exists(path):
        print(f'  (no {name}.json - that model is left out)', file=sys.stderr)
        return {}
    return json.load(open(path))


def feature_model(items, X, y, groups):
    """Leave-one-complex-out gradient boosting on the interface features."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    scores = np.zeros(len(items))
    for g in sorted(set(groups)):
        test = groups == g
        m = HistGradientBoostingClassifier(max_depth=3, max_iter=200, learning_rate=0.08, random_state=0)
        m.fit(X[~test], y[~test])
        scores[test] = m.predict_proba(X[test])[:, 1]
    return scores


def main():
    items = json.load(open(f'{WORK}/items.json'))
    src = {'mpnn': load('mpnn'), 'esm': load('esm'), 'features': load('features'),
           'boltz2': load('boltz2'), 'af2': load('af2')}
    feats = src['features']
    missing = [it['id'] for it in items if it['id'] not in feats]
    if missing:
        sys.exit(f'features.json is missing {len(missing)} items, e.g. {missing[:3]}')

    # ---- learning / held-out split, by complex ----
    pdbs = sorted({it['pdb'] for it in items})
    rng = np.random.default_rng(SEED)
    order = rng.permutation(len(pdbs))
    n_new = round(len(pdbs) * HELD_OUT)
    group_of = {pdbs[i]: ('new' if k < n_new else 'learn') for k, i in enumerate(order)}

    X = np.array([[feats[it['id']][f] for f in FEATURE_NAMES] for it in items], dtype=float)
    y = np.array([it['label'] for it in items])
    groups = np.array([it['pdb'] for it in items])
    fm = feature_model(items, X, y, groups)

    # ---- every model's score per item, then a median threshold ----
    raw: dict[str, list] = {}
    for name, _label, _kind, where, _hi in MODELS:
        if name == 'feature_model':
            raw[name] = list(fm)
            continue
        table, key = where
        raw[name] = [src[table].get(it['id'], {}).get(key) for it in items]
    models, calls = [], {}
    tie_break = np.random.default_rng(SEED).permutation(len(items))    # fixed, label-blind order for equal scores
    for name, label, kind, _where, higher in MODELS:
        vals = raw[name]
        have = [v for v in vals if v is not None]
        if len(have) < len(items):
            print(f'  {name}: only {len(have)}/{len(items)} scored - left out', file=sys.stderr)
            continue
        # call the better-scoring half real. Ranking rather than a median cut so that a score with many ties
        # (clash counts are mostly zero) still splits the items in half instead of landing on one side of them.
        sign = 1 if higher else -1
        order = sorted(range(len(items)), key=lambda i: (-sign * vals[i], tie_break[i]))
        thr = float(np.median(have))
        calls[name] = [0] * len(items)
        for rank, i in enumerate(order):
            calls[name][i] = int(rank < len(items) // 2)
        acc = float(np.mean([c == yy for c, yy in zip(calls[name], y)]))
        models.append({'name': name, 'label': label, 'kind': kind, 'threshold': round(thr, 5), 'accuracy': round(acc, 4)})
        print(f'  {label:42s} {acc * 100:5.1f}%')

    # ---- write the structures the browser loads ----
    os.makedirs(f'{APP}/structures', exist_ok=True)
    for it in items:
        shutil.copyfile(f'{WORK}/pdb_game/{it["id"]}.pdb', f'{APP}/structures/{it["id"]}.pdb')

    complexes = {}
    for it in items:
        if it['pdb'] in complexes:
            continue
        real = next(x for x in items if x['pdb'] == it['pdb'] and x['kind'] == 'real')
        complexes[it['pdb']] = {
            'pdb': it['pdb'], 'title': it['title'], 'released': it['released'], 'resolution': it['resolution'],
            'group': group_of[it['pdb']], 'n_interface': it['n_interface'],
            'chains': [{'chain': c['chain'], 'desc': c['desc'], 'organism': c['organism'], 'n': c['n'],
                        'seq': s} for c, s in zip(it['chains'], real['seqs'])],
        }
    out_items = []
    for k, it in enumerate(items):
        out_items.append({
            'id': k, 'key': it['id'], 'pdb': it['pdb'], 'kind': it['kind'], 'y': it['label'],
            'n_mut': len(it['mutations']), 'muts': [f'{m["chain"]}:{m["wt"]}{m["i"]}{m["mt"]}' for m in it['mutations']],
            'iface': it['interface'],
            'f': {f: feats[it['id']][f] for f in FEATURE_NAMES},
            'c': ''.join(str(calls[m['name']][k]) for m in models),
            'scores': {m['name']: (None if raw[m['name']][k] is None else round(float(raw[m['name']][k]), 5)) for m in models},
        })
    data = {
        'version': VERSION, 'source': 'RCSB PDB, released 2023-06-01 or later',
        'mut_fraction': 0.5, 'models': models, 'model_order': [m['name'] for m in models],
        'complexes': list(complexes.values()), 'items': out_items,
    }
    os.makedirs(APP, exist_ok=True)
    json.dump(data, open(f'{APP}/dataset.json', 'w'))
    size = os.path.getsize(f'{APP}/dataset.json') / 1e6
    print(f'{len(out_items)} items from {len(complexes)} complexes '
          f'({sum(1 for c in complexes.values() if c["group"] == "learn")} learning, {n_new} held out)')
    print(f'dataset.json {size:.2f} MB; structures in {APP}/structures')


if __name__ == '__main__':
    main()
