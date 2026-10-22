# Data, models and licences

## Where the complexes come from

All structures are from the **RCSB PDB** (https://www.rcsb.org), used under the PDB's open terms
(https://www.rcsb.org/pages/usage-policy); each entry is credited in the app by its id, title, chain names and release
date, and links to its RCSB page.

Selection (`pipeline/select_complexes.py`), all applied through the RCSB search and data APIs:

- X-ray diffraction, resolution ≤ 2.5 Å
- exactly two protein polymer entities, two deposited chains, no nucleic acid, ≤ 900 residues total
- biological assembly 1 is that heterodimer
- each chain 40–450 residues, standard amino acids only, backbone complete
- no immunoglobulin folds (antibody, Fab, nanobody, VHH, scFv, MHC, TCR and similar, matched on entry title and
  chain descriptions). Designed binders — minibinders, monobodies, affibodies — are kept: they are the closest thing
  in the PDB to the question the game asks.
- the two chains are not the same protein (5-mer containment < 0.6)
- **released on or after 2023-06-01**, which is Boltz-2's PDB cutoff. AlphaFold2-multimer v3's is 2021-09-30, so it
  is covered too.
- **novel interface**: dropped if any entry released *before* that date contains homologues of **both** chains
  (RCSB sequence search, 30% identity, e-value ≤ 0.1). This is what stops a model scoring well from memory.
- **non-redundant**: processed best-resolution first, and an entry is dropped if a kept one already has a
  near-duplicate of both chains (5-mer containment ≥ 0.5 on both, either pairing). RCSB's own sequence-cluster ids
  come back empty for entries this new, which is why redundancy is measured locally.

1,890 entries matched the structural query; 111 survived every filter; 104 produced usable items.

## How an item is built

`pipeline/fetch_structures.py` writes biological assembly 1 with only the two protein chains, renamed **A** (the
larger chain) and **B** (the smaller), waters, ligands, hydrogens and alternate locations removed, and residues
renumbered from 1 (author numbering is kept in the metadata).

`pipeline/make_items.py` then produces two items per complex:

- **interface** = every residue with a heavy atom within 5.0 Å of a heavy atom of the other chain
- **real**: the deposited sequence
- **fake**: 50% of the interface positions, drawn at random across both chains, each changed to a random different
  amino acid. Cysteine is excluded as a destination so no spurious disulfides appear.
- **both** are then rebuilt from scratch on the crystal backbone with **FASPR** (Huang, Pearce & Zhang, *Bioinformatics*
  2020; MIT licence), including the real one.

Repacking the real complex too is the point: if only the fakes were repacked, their side chains would carry a
signature of the packer (ideal rotamers, no crystal-strained conformers) and the game could be won without ever
looking at the interface. After repacking, the two items differ only in interface sequence.

**The limitation this leaves.** The backbone is fixed, so a fake cannot relax the way a real protein would. Fakes
average about 3 clashing atom pairs across the interface against about 0.3 for real complexes, and that one cue
alone scores ~68%. It is visible to the player, so the comparison with the models stays fair, but it is a property
of the construction, not of binding.

**The second limitation.** Replacing half an interface with uniformly random residues leaves a sequence no protein
family would produce, and that is detectable without any reasoning about binding. ESM2-650M, given one chain's
sequence at a time with no structure and no partner, calls it right 95% of the time; ProteinMPNN given the backbone
reaches 99%. So the ceiling here measures sequence naturalness far more than interface quality. A harder version
would draw replacements from a profile of the chain's own family, or from residues of similar type and burial, so
that each chain stays a plausible protein and only the fit across the join is wrong. Treat the current numbers as a
floor on model performance, not as evidence about binding prediction.

## What the browser is given

`public/data/structures/{id}_{real,fake}.pdb` — the full two-chain structure with all atoms, after repacking. The
label is never in the file name's content, only in `dataset.json`, which the app needs anyway to score you.
`dataset.json` holds the ten interface descriptors, every model's score and call, and the complex metadata that is
revealed after an answer.

## Interface descriptors (`pipeline/features.py`)

Computed on the structure the player sees, with Shrake–Rupley solvent accessibility (Biopython): buried area, atom
contacts within 4.5 Å, clashes within 2.2 Å, hydrogen-bond-capable N/O pairs within 3.5 Å, salt bridges within
4.0 Å, the carbon/sulfur share of the buried area, buried polar atoms with no partner, net interface charge product,
packing density and buried area per contact. These ten numbers are shown on screen and are the only input to the
feature model.

## Benchmarks

- **Boltz-2** (Passaro et al. 2025; MIT) — `pipeline/modal_boltz2.py`, run on Modal with an A100. Each item's two
  sequences only, MSAs from the ColabFold MSA server, 3 recycling steps, 1 diffusion sample. Score: **ipTM**.
  Interface pLDDT is kept as a second variant.
- **AlphaFold2-multimer v3** (Evans et al. 2021) via **ColabFold** (Mirdita et al. 2022; MIT) —
  `pipeline/modal_af2.py`, same Modal setup, `--model-type alphafold2_multimer_v3`, 3 recycles, 1 model.
  Score: **ipTM**. **Not in dataset 1.0.0**: on Modal, ColabFold stalled while loading the weights, before predicting,
  and the run was stopped to save GPU credit. The script is kept; `build_dataset.py` adds AF2 once `af2.json` exists.
- **ProteinMPNN** (Dauparas et al. 2022; MIT), `v_48_020`, no backbone noise — `pipeline/mpnn_scores.py`.
  Mean log p of the residue actually present at the interface positions, decoded last given everything else:
  once with the whole two-chain backbone (`mpnn_complex`), once with only that residue's own chain
  (`mpnn_single`), and their difference (`mpnn_delta`), which is the interface-complementarity term.
- **ESM2 650M** (Lin et al. 2023; MIT) — `pipeline/esm_scores.py`. Masked-marginal log probability at the interface
  positions, each chain scored on its own, with no partner and no structure. The control that separates "this
  sequence looks odd" from "this interface looks wrong".
- **Feature model** — gradient-boosted trees (scikit-learn) on the ten descriptors, scored with
  **leave-one-complex-out** cross-validation, so it never trains on the complex it is judging.
- **Single-cue rules** — fewest clashes, most hydrogen bonds, largest buried area.

Every score is turned into a real/fake call by ranking all items and calling the better half real. Items are
balanced 50/50, so every model calls exactly half of them real and 50% is chance for everyone, player included.
Ranking rather than a median cut matters for the integer cues, where many items tie.

## Running the pipeline

Two interpreters, because the structure tools and the model tools want different stacks:

```bash
# structures: gemmi, biopython, numpy, scikit-learn
uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python numpy requests gemmi biopython scikit-learn
# models: torch + fair-esm (the repo uses the system python3, shared with the other BioAI by eye games)

.venv/bin/python pipeline/select_complexes.py     # -> data/work/complexes.json
.venv/bin/python pipeline/fetch_structures.py     # -> data/work/real/
.venv/bin/python pipeline/make_items.py           # -> data/work/items.json, pdb_game/   (needs tools/FASPR)
.venv/bin/python pipeline/features.py             # -> data/work/features.json
python3           pipeline/mpnn_scores.py         # -> data/work/mpnn.json              (needs tools/ProteinMPNN)
python3           pipeline/esm_scores.py          # -> data/work/esm.json
.venv/bin/python pipeline/model_jobs.py           # -> data/work/model_jobs.json
modal run         pipeline/modal_boltz2.py        # -> data/work/boltz2.json
modal run         pipeline/modal_af2.py           # -> data/work/af2.json   (optional; not in 1.0.0)
.venv/bin/python pipeline/build_dataset.py        # -> app/public/data/
```

`build_dataset.py` leaves out any model whose scores are missing, so the app can be built and played before the GPU
runs finish. Build FASPR with
`xcrun clang++ -std=c++11 -isysroot "$(xcrun --show-sdk-path)" -O3 -ffast-math -o FASPR src/*.cpp` on macOS, or
`g++ -O3 -ffast-math -o FASPR src/*.cpp` on Linux, and keep `dun2010bbdep.bin` beside the binary.
