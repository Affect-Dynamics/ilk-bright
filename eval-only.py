"""Evaluate saved ilk rankings using the unmodified BRIGHT metric function."""
import ast
import json
from pathlib import Path
from statistics import mean
import pytrec_eval
from datasets import load_dataset

root = Path(__file__).resolve().parent
source = root / 'BRIGHT' / 'retrievers.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'calculate_retrieval_metrics')
namespace = {'pytrec_eval': pytrec_eval}
exec(compile(ast.Module(body=[fn], type_ignores=[]), str(source), 'exec'), namespace)
evaluate = namespace['calculate_retrieval_metrics']
base = json.loads((root / 'official-scores' / 'local-baseline.json').read_text(encoding='utf-8'))['tasks']
rows = []
for task, local in base.items():
    examples = load_dataset('xlangai/bright', 'examples', split=task, cache_dir=str(root / 'BRIGHT' / 'cache'))
    qrels = {e['id']: dict.fromkeys(e['gold_ids'], 1) for e in examples}
    for arm in ('lexical', 'allocation_90_10'):
        directory = root / 'official-scores' / arm / f'{task}_bm25_long_False'
        scores = json.loads((directory / 'score.json').read_text(encoding='utf-8'))
        if set(scores) != set(qrels):
            raise ValueError(f'{task} {arm}: query IDs differ from official examples')
        for e in examples:
            qid = e['id']
            excluded = set(e['excluded_ids'])
            if excluded.intersection(scores[qid]) or excluded.intersection(qrels[qid]):
                raise ValueError(f'{task} {qid}: excluded document present')
            if not scores[qid]:
                raise ValueError(f'{task} {qid}: empty run')
        result = evaluate(results=scores, qrels=qrels)
        (directory / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        official = 100 * result['NDCG@10']
        rows.append(dict(task=task, arm=arm, official=official, local=local[arm], delta=official-local[arm]))
        print(f'{task:22} {arm:18} official={official:.5f} local={local[arm]:.5f}', flush=True)
        (root / 'official-comparison.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
for arm in ('lexical', 'allocation_90_10'):
    subset = [r for r in rows if r['arm']==arm]
    print(f'{arm}: official macro={mean(r["official"] for r in subset):.6f}, local macro={mean(r["local"] for r in subset):.6f}')
