"""Evaluate real saved rankings against human labels, never invented scores."""
import argparse
import csv
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eval.core import ARMS, evaluate


def markdown(report):
    lines = ['# Retrieval evaluation', '', 'Human-judged eligible queries: **n=' + str(report['n']) + '**.', '',
             '| Arm | Pooled Recall@10 | MRR@10 | Client p95 ms | Latency n | Unjudged top-10 items |',
             '|---|---:|---:|---:|---:|---:|']
    def value(number):
        return 'not measured' if number is None else f'{number:.4f}'
    for arm in ARMS:
        metrics = report['arms'][arm]
        lines.append('| ' + ' | '.join([arm, value(metrics['recall_at_10']), value(metrics['mrr']), value(metrics['p95_ms']),
                                         str(metrics['latency_samples']), str(metrics['unjudged_results_at_10'])]) + ' |')
    lines += ['', report['interpretation'], '',
              'Excluded incomplete query pools: ' + str(len(report['excluded_incomplete'])) + '.',
              'Excluded queries with unavailable arms: ' + str(len(report['excluded_failed'])) + '.',
              'Excluded fully judged pools with no relevant item: ' + str(len(report['excluded_no_relevant'])) + '.', '',
              'No deployment mode is selected automatically. No baseline is fabricated. Provider spans and production p95 are not measured by this script.']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=Path, default=Path('eval/runs.json'))
    parser.add_argument('--labels', type=Path, default=Path('eval/labels_todo.csv'))
    parser.add_argument('--output', type=Path, default=Path('eval/results.md'))
    parser.add_argument('--json-output', type=Path, default=Path('eval/results.json'))
    args = parser.parse_args()
    try:
        with args.labels.open(newline='') as stream:
            labels = list(csv.DictReader(stream))
        report = evaluate(json.loads(args.runs.read_text()), labels)
        args.output.write_text(markdown(report))
        args.json_output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'eligible_human_queries': report['n'], 'report': str(args.output)}))
    except (ValueError, KeyError, OSError):
        parser.exit(1, 'Evaluation failed: malformed runs/labels or labels not identified as human-entered.\n')


if __name__ == '__main__':
    main()
