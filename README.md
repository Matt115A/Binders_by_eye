# Binders by eye

**Try it: https://matt115a.github.io/Binders_by_eye/**

**Can a person tell, by eye, whether two proteins really bind — and how do they compare with the AI models that
are now used to answer exactly that question?**

Each trial shows two protein chains in the pose an X-ray structure caught them in. Half the time they are a real
complex. The other half, **50% of the amino acids at their interface have been replaced at random**, so the pose is
still real but the handshake is not. You fly around the pair, look into the join, and call it: real binders, or a fake?

Press **F** (fake) or **J** (real), or tap. After each answer you get the truth, the PDB entry behind it, what was
changed, and what every benchmark model said about that same complex.

**Session 1:** learn on 40 complexes with feedback → 20 complexes held out from the start.
A complex is never shown twice, in either version, because both versions share a backbone.

## Who you are up against

Scored on identical items:

| Model | What it sees |
|---|---|
| **Boltz-2 ipTM** | only the two sequences; has to predict the complex |
| **Boltz-2 ipLDDT** | the same single prediction, scored by its confidence at the interface instead |
| **ProteinMPNN** (interface fit) | the docked structure you see |
| **Feature model** | the ten interface numbers shown on screen (leave-one-complex-out) |
| Fewest clashes / most hydrogen bonds / largest buried area | one interface number each |

The two groups are answering different questions, and the app says so. Boltz-2 gets sequences only and
must predict whether a complex forms at all — the hard, useful version of the task, and the one binder design relies on.
ProteinMPNN, the feature model and **you** are given the docked structure and only have to judge whether that
interface looks right.

## Honest notes on difficulty

- **The backbone cannot relax.** Both versions are repacked on the crystal backbone, so a fake carries strain a real
  complex does not: fakes average ~3 clashing atom pairs against ~0.3 for real ones. "Fewest clashing atoms" alone
  scores about 68%. That strain is visible on screen, so it is a fair cue, but it is an artefact of the construction
  rather than a fact about binding, and it is the single biggest reason the task is doable at all.
- **A randomised interface is simply very unlikely protein.** Any model with a feel for what amino acid sequences look
  like spots it without needing to think about binding at all. ESM2 650M, given one chain's sequence on its own with no
  structure and no partner, scores 95%; ProteinMPNN's raw log p given the backbone scores 99%. Neither can possibly be
  judging the interface, so **neither is shipped as a benchmark** — a model you are scored against should be answering
  the question you were asked. Both are still measured, because they are what pins down the size of this artefact:
  most of what separates real from fake here is sequence naturalness rather than binding.
  ProteinMPNN's **interface-fit** variant (`mpnn_delta`, 94%) does stay, on evidence rather than taste. Every score
  correlates with every other across all items, because they all track the label; the test that separates them is the
  correlation *within* one class. Among fakes, raw log p still follows ESM2 (r = +0.38) while the delta does not
  (r = −0.05): subtracting the single-chain score cancels the naturalness term and leaves what the partner adds.
  The interesting comparison is still against Boltz-2, the sequence-only folding model, which has to commit to a predicted
  complex: its ipTM scores 65% (interface pLDDT 75%), against 68% for counting clashing atoms alone.
- **The real complexes are genuinely unseen.** Every entry was released on or after 2023-06-01, after Boltz-2's
  training cutoff, and entries whose both chains have pre-cutoff homologues
  are dropped.

```bash
npm install && npm run dev        # ?debug adds a simulate button
npm test
npm run deploy                    # build the public version and push it to gh-pages
```

Rebuild the data with the scripts in `pipeline/` (see [DATA.md](DATA.md)).
