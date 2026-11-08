"""Report not_evaluated unless real human judgments and an approved baseline exist."""
import argparse
import csv
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eval.core import ARMS, evaluate
from eval.pool import approved_queries


def check(report, baseline):
    if not report['n']:
        return {'status': 'not_evaluated', 'reason': 'No complete human-judged query pools with real successful runs for all arms.', 'n': 0}
    if baseline is None:
        return {'status': 'not_evaluated', 'reason': 'No participant-approved measured baseline exists.', 'n': report['n']}
    if baseline.get('label_source') != 'human' or baseline.get('approved') is not True or baseline.get('arm') not in ARMS or not isinstance(baseline.get('n'), int) or baseline['n'] <= 0:
        raise ValueError('baseline must identify participant approval and nonempty human labels')
    score = baseline.get('mrr')
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError('baseline MRR must be measured in [0,1]')
    actual = report['arms'][baseline['arm']]['mrr']
    return dict(status='passed' if actual >= score - .05 else 'failed', n=report['n'], arm=baseline['arm'],
                measured_mrr=actual, baseline_mrr=score, allowed_drop=.05)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=Path, default=Path('eval/runs.json'))
    parser.add_argument('--labels', type=Path, default=Path('eval/labels_todo.csv'))
    parser.add_argument('--baseline', type=Path, default=Path('eval/baseline.json'))
    parser.add_argument('--queries', type=Path, default=Path('eval/queries.json'))
    parser.add_argument('--require-evaluated', action='store_true', help='Fail release gate when evidence is missing')
    args = parser.parse_args()
    try:
        if not args.runs.exists() or not args.labels.exists():
            result = dict(status='not_evaluated', reason='Real runs and human label artifacts are absent.', n=0)
        else:
            with args.labels.open(newline='') as stream:
                rows = list(csv.DictReader(stream))
            payload = json.loads(args.runs.read_text())
            if payload.get('queries') != approved_queries(args.queries):
                raise ValueError('saved runs do not match approved queries')
            report = evaluate(payload, rows)
            baseline = json.loads(args.baseline.read_text()) if args.baseline.exists() else None
            result = check(report, baseline)
        print(json.dumps(result))
        if result['status'] == 'failed':
            return 1
        if result['status'] == 'not_evaluated' and args.require_evaluated:
            return 2
        return 0
    except (ValueError, OSError, KeyError):
        print(json.dumps({'status': 'invalid_evidence', 'reason': 'Malformed runs, labels or unapproved/unmeasured baseline.'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
