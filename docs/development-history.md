# ilk BRIGHT v0.1
Affect Dynamics | Node.js 22+, no Python, no npm dependencies.

Run in PowerShell from this directory:

```powershell
node bright.js --task pony --mode bm25 --limit 10
$env:JEV_KEY = "your-key"
node bright.js --task pony --mode all --limit 10 --out pilot --audit
```

First run downloads the official Hugging Face `xlangai/BRIGHT` examples/documents via datasets-server rows API (100 rows/page). The pony corpus is ~7,894 documents; downloading can take many requests. Cache is reused. If the dataset service is unavailable or truncates content, use complete local JSONL/JSON arrays with `--examples path --documents path`. No live dataset or Jev request was run during packaging. The data service may impose response limits; inspect source completeness before claiming official results. Do not use a partial corpus for a leaderboard score.

Four arms: local BM25 (unique terms, stopwords, no stemming; not the official Pyserini baseline); BM25 + Jev relevance; Jev term discovery from original query and lexical pseudo-relevance feedback; discovery + independent candidate-channel merge + Jev relevance. The latter is experimental, not a full pyramid engine. Discovery is one POST up to 80 judgments; reranking defaults to 10 docs per POST, 100 candidates, with query-relevant 1800-character excerpts. `all` normally takes 21 POSTs/query; `ilk` 11; `bm25` zero. `--top 30` reduces cost but is a pilot setting; default 100 for comparability. `--batch 20` reduces requests but increases payload. Logs contain usage and latency, audit contains query/document text and exact payloads (not API key). No gold IDs or human reasoning sent to model. Excluded IDs never retrieved.

Outputs: task-report.json (per-query metrics and logs), task-summary.json, task-{bm25,rerank,discovery,ilk}-score.json (official score mapping). Scores encode rank, not calibrated probabilities. nDCG@10, Recall@100, MRR@100 on 0–1 scale; multiply nDCG by 100 for leaderboard. Official evaluator parity not yet verified; compare with upstream evaluator before submission. `--offset 10 --limit 10` for a separate pilot; use separate `--out` directories to avoid overwrite. Remove `--limit` for full task. All 12 short tasks supported via --task. Larger tasks may need more Node heap; in-memory postings are prototype quality. No long-document support.

Leaderboard requires macro-average nDCG@10 across all 12 tasks, not one task or subset. Freeze configuration before full evaluation, disclose pilot tuning, compare official baselines, and report model/API version, request budget and hardware. Official instructions: https://brightbenchmark.github.io/ and https://github.com/xlang-ai/BRIGHT .

Tests: `node --test` (synthetic fixtures only).

## v0.2 capability experiment

Run `node bright.js --task pony --mode all --limit 10 --out pilot-v02 --audit`.
Reuse the previous `data/` cache via `--cache PATH`. `bright-v01.js` is the untouched control.
New `discovery` is capability-based, `code` is enhanced lexical retrieval, `ilk` judges the protected baseline plus up to `--extra 100` novel documents (default). `--top` controls the baseline and individual channel widths. At default settings there are at most 200 unique document judgments plus 50 capability judgments, in at most 21 sequential POSTs with batch 10. Shared candidate judgments are reused. Output is capped at 100 ranked IDs. `poolRecall` measures pre-reranking coverage; final recall100 can still decrease. The fixed capability vocabulary is generic and experimental, not a learned document classifier. Enhanced lexical index splits code identifiers and includes filename terms; original BM25 is unchanged. No gold labels are used in retrieval. Run `node --test` for local verification. Live performance is unverified; compare the same ten queries, then hold out remaining queries before tuning. 

## v0.3: multidimensional relevance

CLI defaults to evaluating the four independent dimensions (instruction, coverage,
direct, specificity) and a fixed weighted blend `multi` on the same protected
pool as v0.2. The blend uses 0.35/0.30/0.15/0.20 respectively; these are untrained
starting weights, not fitted to the pilot. Existing controls are unchanged.
Each dimension gets its own score JSON and metrics. `dimensionRows` contains the
raw probabilities, and `oracle` is an offline upper bound calculated only after
retrieval, never exported as a submission run. The oracle does not make API calls.
With top=100, extra=100, batch=10, all mode uses at most 41 POSTs and 1,050
judgments per query (200 original relevance, 50 discovery, 800 new dimensions).
Use `--no-dimensions` for the original v0.2 behavior. For a smaller smoke test use
`--limit 2`. For held-out Pony queries use `--offset 10` (omit `--limit` to finish
all remaining queries). A nonzero offset is not a full leaderboard run.

```powershell
node bright.js --task pony --mode all --limit 10 --out pilot-v03 --audit
node bright.js --task pony --mode all --offset 10 --out heldout-v03
```

The original and new relevance judgments use separate requests to preserve the
original control context. Scores are not guaranteed calibrated across batches.
No live API validation or official evaluator parity is claimed for this release.

### v0.3.1 download recovery

The benchmark algorithms are unchanged. The Hugging Face rows downloader now resumes existing `.jsonl.tmp` checkpoints, validates row IDs and offsets, and uses bounded exponential backoff for transient errors (including 503 and 429). Copy your existing `data` folder, including `.tmp` files, into this version or pass `--cache` with the previous directory. If a partial cache is corrupt or comes from a different dataset revision, remove only that dataset's `.tmp` and `.tmp.meta.json` and restart. Successful downloads become `.jsonl` files as before.

## Bulk download (v0.3.2)
Install the JavaScript Parquet readers: `npm install hyparquet hyparquet-compressors`.
Run `node bulk.js --task biology --cache data` before running bright.js. Downloads two official Parquet files, then creates the usual JSONL cache. Existing complete cache files are reused. If a direct download is throttled, download the corresponding file in your browser and save it as `data/biology-documents.parquet` or `data/biology-examples.parquet`, then rerun. No retrieval or ranking changes. Default revision is main; use --revision to pin a dataset revision. Single-shard splits only; for multi-shard splits use the original downloader or import JSONL. 

### v0.3.3 Unicode recovery
Outgoing Jev string values are made well-formed (lone UTF-16 surrogates and NUL replaced with U+FFFD). Excerpt boundaries are repaired without changing normal text or ranking. On failure the CLI reports the query ID. The existing per-query report and score checkpoints can be reused with `--resume` and the original task, offset, limit, mode, top, batch, dimensions, extra, audit and output directory. Resume checks report metadata, query IDs/text/gold and saved score presence; legacy reports do not record every option, so use identical settings and dataset files. No partial failed query is reused.

## v0.4: discovery channel isolation

`bright.js` is unchanged from v0.3.3. `isolate.js` is a separate runner. Use existing JSONL caches (or `bulk.js` to create them). Node 22+.

```powershell
node isolate.js --task economics --cache data --offset 10 --out isolation-economics --replay economics-heldout/economics-report.json --offline
node isolate.js --task economics --cache data --offset 10 --out isolation-economics-live --replay economics-heldout/economics-report.json
```

`--replay` can be repeated to supply pilot and held-out reports; without it, capability probabilities are obtained fresh. Offline mode requires replay for every selected query and makes zero API calls; final ranking metrics are null. Live mode judges the sorted union once with the unchanged generic relevance prompt and shares scores across arms. All arms retain the same first 100 BM25 candidates; BM25-200 and three expanded arms target 200. Discovery channels search to depth 200 (different from v0.3 depth 100); missing expansion slots are filled with BM25 tail and counted. If the corpus or lexical matches are insufficient, actual sizes are reported. Candidate recall counts the entire pool; final metrics use top 100. Oracle uses gold only after retrieval. Unique contributions are measured on standalone depth-200 channels, not necessarily retained in capped arms; actual arm rescues and added gold are separately reported. `--blind` removes ID text from the enhanced index and uses opaque aliases in Jev requests; this is a combined metadata sensitivity control, not a separate isolated ID-only test. Tie-breaking still uses original IDs in retrieval, and alias assignment is stable. `--resume` requires identical options and corpus/query/replay hashes. Legacy replay reports lack corpus hashes; task, corpus size, query text and labels are checked, but exact original corpus identity cannot be independently guaranteed. Output contains per-query candidates, scores, metrics, and summary, with atomic checkpoints. No official evaluator parity claim.

## v0.4.1: frozen allocation validation

`isolate.js` adds `allocation_90_10` alongside the original five arms. It preserves BM25-100, reserves ten unique capability candidates, then takes ninety unique enhanced lexical candidates. Duplicates are skipped. If quotas cannot be filled, the deterministic backfill interleaves lexical, capability, and BM25-200, recording the fallback count. All six arms use the same union of generic relevance judgments. Candidate generation and prompts otherwise remain unchanged.

Fresh Psychology validation (no replay from Economics):

```sh
npm install hyparquet hyparquet-compressors
node bulk.js --task psychology --cache data
node isolate.js --task psychology --cache data --blind --out isolation-psychology
```

Use `--resume` with the identical command to resume an interrupted run. A small `--limit 10` smoke run must use a different output directory; the full validation should retain all queries and the frozen configuration. `--blind` removes document-ID tokens from the enhanced index and uses opaque aliases in Jev requests; original IDs still resolve output and deterministic retrieval tie-breaking (and batch ordering), so this is a metadata-content control, not complete ID-invariance. No gold labels are used in retrieval or judgments. Economics was development data for the ratio; Psychology is a cross-domain validation. Live Jev and official evaluator parity are not verified locally.

## Full blind suite

`npm install hyparquet hyparquet-compressors`

`node suite.js --cache data --out suite-blind`

Requires Node 22+ and JEV_KEY. Runs all twelve tasks sequentially with frozen v0.4.1 blind isolation, six arms, fresh judgments, no replay. Rerun the identical command to resume; existing reports are validated by isolate.js. Use --heap 4096 if appropriate for available RAM (default 8192 MB per child). --tasks accepts a comma-separated subset for debugging; use a separate output folder. The suite summary is updated after each task; partial macro averages include completed tasks only. Existing cache files are reused by bulk.js; --revision affects new downloads only, so use a fresh cache for a pinned revision. The runner stops on failure; retry the same command after resolving it. All scores are local, not official leaderboard submissions.
