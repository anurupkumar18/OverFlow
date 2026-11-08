"""Collect four real ES arms and write an unlabeled, blinded top-five pool."""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eval.core import ARMS, fingerprint, pool_rows
from scripts.ingest.elastic import Client, ElasticError, read_env, search_body, select_inference


def approved_queries(path):
    queries = json.loads(Path(path).read_text())
    if not isinstance(queries, list) or len(queries) > 100:
        raise ValueError('approved queries must be an array of at most 100 entries')
    for query in queries:
        if not isinstance(query, dict) or not isinstance(query.get('id'), str) or not query['id'] or not isinstance(query.get('text'), str) or not query['text'].strip():
            raise ValueError('approved queries require nonempty id and text strings')
    if len({q['id'] for q in queries}) != len(queries):
        raise ValueError('duplicate approved query ids')
    return queries


def collect(queries, client, rerank_id=None):
    payload = {'queries': queries, 'runs': [], 'measured_at': dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
               'source': 'direct Elasticsearch requests; no app cache; sequential single sample per query/arm'}
    for query in queries:
        for arm in ARMS:
            start = time.perf_counter()
            try:
                body = search_body(arm, query['text'], rerank_id)
                response = client.request('POST', '/talks/_search', body)
                if response.get('timed_out') or response.get('_shards', {}).get('failed', 0):
                    raise ElasticError('incomplete search')
                ids = [hit.get('_source', {}).get('id', hit['_id']) for hit in response['hits']['hits'][:10]]
                payload['runs'].append(dict(query_id=query['id'], arm=arm, ids=ids,
                                            elapsed_ms=(time.perf_counter() - start) * 1000, status='ok'))
            except (ElasticError, ValueError, KeyError):
                payload['runs'].append(dict(query_id=query['id'], arm=arm, ids=[], elapsed_ms=None, status='error',
                                            reason='arm unavailable; no replacement arm or fabricated result'))
    return payload


def provider_evidence(client, rerank_id, endpoints):
    """Fingerprint actual indexed corpus/config; never save raw provider metadata."""
    corpus = client.request('POST', '/talks/_search', {'size': 1000, 'track_total_hits': True,
                            'query': {'match_all': {}}, 'sort': [{'id': 'asc'}], '_source': {'excludes': ['semantic_text']}})
    hits = corpus['hits']['hits']
    total = corpus['hits']['total']
    total = total['value'] if isinstance(total, dict) else total
    if corpus.get('timed_out') or corpus.get('_shards', {}).get('failed', 0) or total != len(hits):
        raise ValueError('complete stable corpus fingerprint unavailable within 1000-talk bound')
    documents = sorted((hit['_id'], hit['_source']) for hit in hits)
    mapping = client.request('GET', '/talks/_mapping')
    settings = client.request('GET', '/talks/_settings?flat_settings=true&include_defaults=false')
    synonyms = client.request('GET', '/_synonyms/overflow-synonyms')
    requests = {arm: search_body(arm, '__query__', rerank_id) for arm in ARMS if arm != 'hybrid_rerank' or rerank_id}
    return dict(corpus_sha256=fingerprint(documents), ranking_config_sha256=fingerprint(dict(
                requests=requests, mapping=mapping, settings=settings, synonyms=synonyms, inference=endpoints)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queries', type=Path, default=Path('eval/queries.json'))
    parser.add_argument('--env', type=Path, help='Read-only ES key file; loaded internally only when queries exist')
    parser.add_argument('--runs', type=Path, help='Reuse actual saved runs without network calls')
    parser.add_argument('--catalog', type=Path, default=Path('app/data/catalog.json'))
    parser.add_argument('--output', type=Path, default=Path('eval/labels_todo.csv'))
    parser.add_argument('--run-output', type=Path, default=Path('eval/runs.json'))
    args = parser.parse_args()
    try:
        queries = approved_queries(args.queries)
        if args.runs:
            payload = json.loads(args.runs.read_text())
            if payload['queries'] != queries:
                raise ValueError('saved runs do not match currently approved queries')
        elif not queries:
            payload = dict(queries=[], runs=[], measured_at=None, source='not measured; no approved queries')
        else:
            if not args.env:
                raise ValueError('an internal env path is required for real ES runs')
            values = read_env(args.env)
            client = Client(values, read_only=True)
            endpoints = client.request('GET', '/_inference')
            try:
                rerank = select_inference(endpoints, values.get('ES_RERANK_INFERENCE_ID'), task='rerank')
            except ValueError:
                rerank = None
            try:
                before = provider_evidence(client, rerank, endpoints)
            except (ElasticError, ValueError, KeyError):
                before = None
            payload = collect(queries, client, rerank)
            try:
                after = provider_evidence(client, rerank, client.request('GET', '/_inference'))
            except (ElasticError, ValueError, KeyError):
                after = None
            if before is not None and before == after:
                payload.update(before, evidence_status='provider corpus and ranking configuration stable before/after collection')
            else:
                payload.update(corpus_sha256=None, ranking_config_sha256=None,
                               evidence_status='provider corpus/configuration identity missing or changed; regression comparison not evaluated')
        catalog = {t['id']: t for t in json.loads(args.catalog.read_text())['talks']}
        rows = pool_rows(payload, catalog)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=['query_id', 'query', 'talk_id', 'title', 'abstract', 'label', 'label_source'])
            writer.writeheader()
            writer.writerows(rows)
        args.run_output.parent.mkdir(parents=True, exist_ok=True)
        args.run_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'approved_queries': len(queries), 'unlabeled_rows': len(rows), 'network_measured': payload.get('measured_at') is not None}))
    except (ValueError, OSError, ElasticError, KeyError):
        parser.exit(1, 'Pooling failed; verify approved queries, catalog, ES access and run-file compatibility privately. No credentials emitted.\n')


if __name__ == '__main__':
    main()
