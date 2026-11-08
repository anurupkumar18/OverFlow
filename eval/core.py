"""Blind pooling and honest metrics on complete human-judged query pools."""
import hashlib
import math
import random

ARMS = ('bm25', 'semantic', 'hybrid', 'hybrid_rerank')


def validate_runs(payload):
    queries = payload.get('queries', [])
    qids = [q['id'] for q in queries]
    if len(qids) != len(set(qids)):
        raise ValueError('duplicate query id')
    indexed = {}
    for run in payload.get('runs', []):
        key = (run['query_id'], run['arm'])
        if key[0] not in qids or key[1] not in ARMS or key in indexed:
            raise ValueError('unknown or duplicate run')
        ids = run.get('ids', [])
        if not isinstance(ids, list) or any(not isinstance(identifier, str) or not identifier for identifier in ids):
            raise ValueError('result ids must be nonempty strings in an array')
        if len(ids) != len(set(ids)):
            raise ValueError('duplicate result id')
        elapsed = run.get('elapsed_ms')
        if run.get('status') not in ('ok', 'error') or (run['status'] == 'ok' and (isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed < 0)):
            raise ValueError('invalid measured run')
        indexed[key] = run
    return queries, indexed


def pool_ids(indexed, query_id):
    return sorted({identifier for arm in ARMS for identifier in indexed.get((query_id, arm), {}).get('ids', [])[:5]})


def pool_rows(payload, catalog):
    queries, indexed = validate_runs(payload)
    rows = []
    for query in queries:
        identifiers = pool_ids(indexed, query['id'])
        seed = int.from_bytes(hashlib.sha256(query['id'].encode()).digest()[:8], 'big')
        random.Random(seed).shuffle(identifiers)
        for identifier in identifiers:
            talk = catalog.get(identifier, {})
            rows.append(dict(query_id=query['id'], query=query['text'], talk_id=identifier,
                             title=talk.get('title', ''), abstract=talk.get('abstract', ''),
                             label='', label_source=''))
    return rows


def evaluate(payload, labels):
    queries, indexed = validate_runs(payload)
    allowed = {q['id']: set(pool_ids(indexed, q['id'])) for q in queries}
    judged, seen = {}, set()
    for row in labels:
        key = (row['query_id'], row['talk_id'])
        if key in seen:
            raise ValueError('duplicate label')
        seen.add(key)
        if key[0] not in allowed or key[1] not in allowed[key[0]]:
            raise ValueError('label outside current blinded pool')
        value = str(row.get('label', '')).strip()
        if value == '':
            continue
        if value not in ('0', '1', '2') or row.get('label_source') != 'human':
            raise ValueError('labels must be human-entered 0/1/2 with label_source=human')
        judged[key] = int(value)
    eligible, incomplete, failed, no_relevant = [], [], [], []
    for query in queries:
        qid = query['id']
        if any(indexed.get((qid, arm), {}).get('status') != 'ok' for arm in ARMS):
            failed.append(qid)
        elif not allowed[qid] or any((qid, t) not in judged for t in allowed[qid]):
            incomplete.append(qid)
        elif not any(judged[(qid, t)] > 0 for t in allowed[qid]):
            no_relevant.append(qid)
        else:
            eligible.append(qid)
    arms = {}
    for arm in ARMS:
        recall, reciprocal, elapsed, unknown = [], [], [], 0
        for qid in eligible:
            run = indexed[(qid, arm)]
            relevant = {t for t in allowed[qid] if judged[(qid, t)] > 0}
            top = run['ids'][:10]
            recall.append(len(set(top) & relevant) / len(relevant))
            reciprocal.append(next((1 / rank for rank, t in enumerate(top, 1) if t in relevant), 0))
            unknown += sum((qid, t) not in judged for t in top)
            elapsed.append(run['elapsed_ms'])
        arms[arm] = dict(recall_at_10=sum(recall) / len(recall) if recall else None,
                         mrr=sum(reciprocal) / len(reciprocal) if reciprocal else None,
                         p95_ms=sorted(elapsed)[math.ceil(.95 * len(elapsed)) - 1] if elapsed else None,
                         latency_samples=len(elapsed), unjudged_results_at_10=unknown)
    return dict(n=len(eligible), total_queries=len(queries), eligible_query_ids=eligible,
                excluded_incomplete=incomplete, excluded_failed=failed, excluded_no_relevant=no_relevant, arms=arms,
                interpretation='Recall@10 uses relevant documents in the top-5-per-arm judged pool, not corpus-wide recall. MRR is truncated at 10 and uses judged relevant items; unjudged results stay unknown. Complete human query pools and successful runs for all four arms are required; queries with no judged relevant items are excluded. Latency is client-observed per request, nearest-rank p95 on included queries only.')
