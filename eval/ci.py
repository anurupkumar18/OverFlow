"""Required ranking check: collect fresh provider runs, then compare real judgments."""
import argparse
import csv
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eval.core import evaluate, fingerprint
from eval.gate import check
from eval.pool import approved_queries, collect, provider_evidence
from eval.run import markdown
from scripts.ingest.elastic import Client, ElasticError, read_env, select_inference


def unavailable(reason):
    return {'gate': {'status': 'not_evaluated', 'reason': reason, 'n': 0}, 'runs': None, 'report': None}


def run_live_gate(queries, labels, baseline, client, rerank_id=None, catalog=None):
    if not queries or baseline is None or not any(row.get('label_source') == 'human' and str(row.get('label', '')) in ('0', '1', '2') for row in labels):
        return unavailable('Approved queries, human judgments and an approved measured baseline are required.')
    endpoints = client.request('GET', '/_inference')
    try:
        rerank = select_inference(endpoints, rerank_id, task='rerank')
    except ValueError:
        rerank = None
    try:
        before = provider_evidence(client, rerank, endpoints)
    except (ElasticError, ValueError, KeyError):
        before = None
    if not isinstance(catalog, dict) or not isinstance(catalog.get('talks'), list) or not catalog['talks']:
        return unavailable('The checked-out catalog is required for a fresh provider comparison.')
    proposed_corpus = fingerprint(sorted((talk['id'], talk) for talk in catalog['talks']))
    if before is None or before.get('corpus_sha256') != proposed_corpus:
        return unavailable('The provider corpus does not match the checked-out catalog; index the proposed catalog in an approved evaluation environment before checking this revision.')
    payload = collect(queries, client, rerank)
    try:
        after = provider_evidence(client, rerank, client.request('GET', '/_inference'))
    except (ElasticError, ValueError, KeyError):
        after = None
    if before is not None and before == after:
        payload.update(before, evidence_status='provider identity stable before and after fresh CI collection')
    else:
        payload.update(corpus_sha256=None, ranking_config_sha256=None,
                       evidence_status='provider identity unavailable or changed during collection')
    report = evaluate(payload, labels)
    return {'gate': check(report, baseline), 'runs': payload, 'report': report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queries', type=Path, default=Path('eval/queries.json'))
    parser.add_argument('--labels', type=Path, default=Path('eval/labels_todo.csv'))
    parser.add_argument('--baseline', type=Path, default=Path('eval/baseline.json'))
    parser.add_argument('--catalog', type=Path, default=Path('app/data/catalog.json'))
    parser.add_argument('--env', type=Path, help='Optional private ES read-key file, loaded internally')
    parser.add_argument('--output', type=Path, required=True, help='CI artifact directory, outside tracked evidence')
    args = parser.parse_args()
    try:
        queries = approved_queries(args.queries)
        with args.labels.open(newline='') as stream:
            labels = list(csv.DictReader(stream))
        baseline = json.loads(args.baseline.read_text()) if args.baseline.exists() else None
        if not queries or baseline is None:
            result = unavailable('Approved queries and an approved measured baseline are required; saved runs are not reused.')
        else:
            values = read_env(args.env) if args.env else {key: os.environ.get(key, '') for key in
                     ('ES_URL', 'ES_READ_KEY', 'ES_API_KEY', 'ES_RERANK_INFERENCE_ID')}
            if not values.get('ES_URL') or not (values.get('ES_READ_KEY') or values.get('ES_API_KEY')):
                result = unavailable('A configured read-only Elasticsearch connection is required for fresh CI evidence.')
            else:
                result = run_live_gate(queries, labels, baseline, Client(values, read_only=True), values.get('ES_RERANK_INFERENCE_ID'), json.loads(args.catalog.read_text()))
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'gate.json').write_text(json.dumps(result['gate'], indent=2) + '\n')
        if result['runs'] is not None:
            (args.output / 'runs.json').write_text(json.dumps(result['runs'], indent=2) + '\n')
            (args.output / 'results.json').write_text(json.dumps(result['report'], indent=2) + '\n')
            (args.output / 'results.md').write_text(markdown(result['report']))
        print(json.dumps(result['gate']))
        return 0 if result['gate']['status'] == 'passed' else 2 if result['gate']['status'] == 'not_evaluated' else 1
    except (ValueError, OSError, KeyError, TypeError, ElasticError):
        print(json.dumps({'status': 'invalid_evidence', 'reason': 'Fresh ranking evaluation failed. Check provider access, complete pools and approved baseline privately.'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
