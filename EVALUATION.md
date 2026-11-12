# Meridian evaluation and reproducibility

Submission name: **Affect Dynamics - Meridian**

## Validation

BRIGHT short-document retrieval, macro-average nDCG@10 across 12 datasets. The user-run official metric function (extracted unchanged from BRIGHT's retrievers.py) evaluated the exported rankings against the official relevance labels with pytrec_eval. All 24 dataset/configuration scores agreed with the local implementation within rounding precision.

| Configuration | Official metric | Local metric |
|---|---:|---:|
| Enhanced lexical | 28.989083 | 28.988998 |
| Frozen 90/10 | 28.904000 | 28.903887 |

The committed [comparison](suite-blind/official-comparison.json) is reconstructed from the successful console log dated November 12, 2026 (local values rounded to five decimal places in the log). It is not the original full-precision JSON output. Replace it with the original official-comparison.json from the evaluation directory if available.

The primary submission configuration is enhanced lexical + Jev. It was selected after comparing the six complete configurations, so this is not an independent holdout estimate of a configuration selected in advance. The 90/10 configuration was frozen before the full run and Economics informed its allocation.

## Reproduce the official metric

From the repository root, with complete saved isolation reports in suite-blind-repro (or substitute the original run directory):

```powershell
node export-scores.mjs suite-blind-repro official-scores
git clone https://github.com/xlang-ai/BRIGHT.git
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install datasets pytrec-eval-terrier
python .\eval-only.py
```

The exporter uses rank-derived scores to preserve the original ranking order. The evaluation-only runner imports the official metric function without importing retrieval-model dependencies, checks query IDs and exclusions, and writes official-comparison.json at the repository root. Copy that file into suite-blind/ for versioned archival. No new Jev calls are made during scoring. To reproduce the historical run exactly, retain the original dataset files and report hashes; the original data revision was main and the hosted model name was jev-latest, neither an immutable revision pin. The evaluator commit and Python dependency versions from the historical Windows run have not been recorded here.

## Limitations

- Only the short-document benchmark is evaluated.
- The shared candidate union provides matched relevance scores across arms, but standalone serving performance/cost and model repeatability are not established by this experiment.
- Descriptive document IDs were masked in prompts and excluded from enhanced index content, not from deterministic tie-breaking or batch ordering.
- Duplicate relevance IDs are deduplicated by both metric implementations; the official score parity confirms this did not change the reported results.
- Official metric parity does not imply leaderboard acceptance or independent verification of model provenance, training data or eligibility.

Upstream: https://github.com/xlang-ai/BRIGHT
