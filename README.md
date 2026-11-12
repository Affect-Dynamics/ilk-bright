# Affect Dynamics - Meridian

**Reasoning-intensive retrieval powered by ilk and TypeSafe Jev.**

[BRIGHT benchmark](https://brightbenchmark.github.io/) · [Benchmark results](suite-blind/suite-summary.json) · [Evaluation methodology](EVALUATION.md)

## Benchmark results

Meridian achieved **28.99 nDCG@10** on the full BRIGHT short-document benchmark using enhanced lexical retrieval and Jev relevance judgments. BRIGHT's official metric function reproduced our local scores across all twelve datasets for both evaluated configurations. This is a locally validated result, not yet an accepted leaderboard entry.

| Configuration | Macro nDCG@10 (×100) |
|---|---:|
| BM25-100 + Jev | 24.84 |
| BM25-200 + Jev | 27.53 |
| **Enhanced lexical + Jev (Meridian)** | **28.99** |
| Capability discovery + Jev | 25.92 |
| Combined expansion + Jev | 27.55 |
| Frozen 90/10 + Jev | 28.90 |

The full experiment covers 12 datasets, 1,384 queries, 48,075 API requests and 529,788 probabilistic judgments across six configurations. These totals reflect the shared experiment, not the standalone serving cost of Meridian.

| Dataset | Meridian | Frozen 90/10 |
|---|---:|---:|
| Biology | 32.00 | 32.41 |
| Earth Science | 42.28 | 42.37 |
| Economics | 31.16 | 32.07 |
| Pony | 24.32 | 22.32 |
| Psychology | 30.21 | 30.57 |
| Robotics | 31.99 | 32.13 |
| Stack Overflow | 34.10 | 34.08 |
| Sustainable Living | 35.04 | 34.91 |
| AoPS | 7.90 | 8.00 |
| LeetCode | 35.63 | 35.36 |
| TheoremQA Theorems | 21.17 | 20.66 |
| TheoremQA Questions | 22.06 | 21.97 |
| **Macro average** | **28.99** | **28.90** |

## Architecture

Meridian is the public-facing retrieval system. ilk is its Node.js engine, and Jev (TypeSafe System One) supplies numeric relevance judgments. The primary configuration preserves 100 BM25 candidates, adds up to 100 unique enhanced lexical candidates, and deterministically ranks the resulting pool using Jev scores. The final output contains at most 100 document IDs.

The retrieval pipeline does not generate query rewrites, reasoning traces or answers, and does not use dense embedding retrieval. This describes the pipeline interface, not undisclosed hosted-model internals or training.

The six-arm experiment shares relevance judgments over a deduplicated candidate union. The frozen 90/10 arm reserves ten expansion slots for capability discovery, but is an ablation rather than the winning configuration. Descriptive IDs were excluded from searchable enhanced text and masked in model requests; original IDs still influence deterministic ordering. Gold labels are used only for evaluation.

## Reproduce

Requires Node.js 22+ and a Jev API key. In PowerShell:

```powershell
npm ci
node --test
$env:JEV_KEY = "your-key"
node suite.js --cache data --out suite-blind-repro
```

The runner downloads BRIGHT data, evaluates all twelve tasks sequentially, and checkpoints reports. Repeat the identical command to resume. Default child heap is 8192 MB; use --heap 4096 if appropriate. The original run used dataset revision main, frozen v0.4.1 isolation logic and the v0.4.2 suite wrapper. Existing cache files are reused; use a fresh cache to pin a different revision. The checked-in summaries are historical results, not resume checkpoints.

## Evaluation

See [EVALUATION.md](EVALUATION.md) for the official metric validation, score export commands, limitations and reproduction steps. The retrieval engine is Node.js; Python is needed only to run BRIGHT's official metric function.

## Repository layout

- `suite.js`: full-suite runner
- `isolate.js`: frozen six-arm experiment
- `bright.js`: earlier retrieval experiments
- `suite-blind/`: committed summaries and evaluation comparison
- `export-scores.mjs`: converts saved rankings to BRIGHT score files
- `eval-only.py`: evaluates saved rankings using BRIGHT's metric function
- [Development history](docs/development-history.md): earlier versions and experimental notes

Benchmark corpus, credentials, full reports and generated score files are excluded from Git.
