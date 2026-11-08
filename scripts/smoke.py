#!/usr/bin/env python3
"""Bounded, read-only smoke against one explicit base URL."""
import argparse
import json
import math
import time
from datetime import datetime, timezone
from urllib.request import urlopen

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    def get(path):
        with urlopen(base + path, timeout=10) as response:
            assert response.status == 200
            return response.read()
    def payload(path):
        return json.loads(get(path))
    html = get('/').decode()
    assert 'Overflow' in html
    assert get('/healthz') and get('/readyz')
    result = payload('/api/search?q=kubernetes')
    assert result['items'] and result['mode'] in ('hybrid_rerank','hybrid','bm25','snapshot')
    assert isinstance(result['degraded'], bool)
    talk = result['items'][0]
    alternatives = payload('/api/planb/' + talk['id'])
    assert len(alternatives['items']) <= 3
    assert isinstance(alternatives['degraded'], bool) and alternatives['mode']
    parse = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00'))
    for item in alternatives['items']:
        assert item['id'] != talk['id'] and item['room'] != talk['room']
        assert abs((parse(item['start']) - parse(talk['start'])).total_seconds()) <= 600
        assert parse(item['end']) > datetime.now(timezone.utc)
        assert item['fullness']['likely_full'] is not True
    status = payload('/api/status')
    assert status['status'] in ('available','unavailable')
    durations = []
    for _ in range(10):
        start = time.perf_counter()
        payload('/api/search?q=kubernetes')
        durations.append((time.perf_counter() - start) * 1000)
    print(json.dumps({'url':base,'version':result['version'],'mode':result['mode'],'results':result['total'],
                      'plan_b_count':len(alternatives['items']),'status':status['status'],
                      'searches':10,'p95_ms':round(sorted(durations)[math.ceil(.95*len(durations))-1],2),
                      'latency_scope':'local/read-only smoke, not a production benchmark'}, indent=2))

if __name__ == '__main__':
    main()
