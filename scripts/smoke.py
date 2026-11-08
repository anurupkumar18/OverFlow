#!/usr/bin/env python3
"""Bounded, read-only app smoke; explicit live checks never accept fallback as live."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.operations import Client, OperationError, admin_token, require

MODES = ('hybrid_rerank', 'hybrid', 'bm25', 'snapshot')


def utc(value):
    require(isinstance(value, str) and value.endswith('Z'), 'invalid_utc_timestamp')
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise OperationError('invalid_utc_timestamp') from None


def version_of(payload, expected=None):
    value = payload.get('version')
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9._-]{1,80}', value), 'missing_or_invalid_version')
    require(expected is None or value == expected, 'version_mismatch')
    return value


def verify_mode(payload, require_live):
    require(payload.get('mode') in MODES and isinstance(payload.get('degraded'), bool), 'invalid_mode_or_degradation')
    if require_live:
        require(payload['mode'] != 'snapshot' and not payload['degraded'], 'live_search_unavailable')


def verify_status(payload):
    state = payload.get('status')
    require(state in ('available', 'unavailable'), 'invalid_service_status')
    keys = ('p95_ms', 'error_ratio', 'degraded_share', 'as_of')
    require(all(key in payload for key in keys), 'incomplete_service_status')
    if state == 'unavailable':
        require(all(payload[key] is None for key in keys), 'unavailable_status_must_be_unknown')
        return state
    def finite(value):
        try:
            return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)
        except OverflowError:
            return False
    require(all(finite(payload[key]) for key in keys[:3]), 'nonfinite_service_status')
    require(payload['p95_ms'] >= 0 and 0 <= payload['error_ratio'] <= 1 and 0 <= payload['degraded_share'] <= 1,
            'invalid_service_status_range')
    utc(payload['as_of'])
    return state


def run(url, expect_version=None, env=None, require_live=False):
    require(not require_live or (env is not None and expect_version is not None), 'live_check_requires_env_and_expected_version')
    client = Client(url)
    token = admin_token(env) if env is not None else None
    require(b'Overflow' in client.request('/'), 'app_document_missing')
    config = client.json('/api/config')
    version = version_of(config, expect_version)
    for path in ('/healthz', '/readyz'):
        probe = client.json(path)
        version_of(probe, version)
        require(probe.get('ok') is True, 'probe_not_healthy')

    def search():
        result = client.json('/api/search?q=kubernetes')
        version_of(result, version)
        verify_mode(result, require_live)
        require(isinstance(result.get('items'), list) and 0 < len(result['items']) <= 100, 'search_has_no_valid_items')
        require(type(result.get('total')) is int and result['total'] >= len(result['items']), 'invalid_search_total')
        return result

    result = search()
    talk = result['items'][0]
    require(isinstance(talk, dict) and isinstance(talk.get('id'), str) and 0 < len(talk['id']) <= 128, 'invalid_sample_session')
    alternatives = client.json('/api/planb/' + quote(talk['id'], safe=''))
    verify_mode(alternatives, require_live)
    items = alternatives.get('items')
    require(isinstance(items, list) and len(items) <= 3, 'invalid_plan_b_count')
    seen = set()
    for item in items:
        require(isinstance(item, dict) and isinstance(item.get('id'), str) and item['id'] not in seen and item['id'] != talk['id'],
                'invalid_plan_b_session')
        seen.add(item['id'])
        require(isinstance(item.get('room'), str) and isinstance(talk.get('room'), str) and item['room'] != talk['room'],
                'plan_b_uses_same_or_unknown_room')
        require(abs((utc(item.get('start')) - utc(talk.get('start'))).total_seconds()) <= 600, 'plan_b_start_outside_window')
        require(utc(item.get('end')) > datetime.now(timezone.utc), 'plan_b_session_ended')
        fullness = item.get('fullness')
        require(isinstance(fullness, dict) and 'likely_full' in fullness and
                (fullness['likely_full'] is None or fullness['likely_full'] is False),
                'plan_b_fullness_not_eligible')

    status = client.json('/api/status')
    version_of(status, version)
    status_state = verify_status(status)
    dependencies = 'not_checked'
    if token is not None:
        deps = client.json('/api/deps', token=token, max_bytes=65536)
        version_of(deps, version)
        elastic, telemetry = deps.get('elasticsearch'), deps.get('telemetry')
        require(isinstance(elastic, dict) and isinstance(telemetry, dict), 'invalid_dependency_status')
        require(all(isinstance(container.get(key), bool) for container, keys in
                    ((elastic, ('configured', 'connected')), (telemetry, ('configured', 'verified_status')))
                    for key in keys), 'invalid_dependency_status')
        dependencies = 'verified' if all((elastic['configured'], elastic['connected'], telemetry['configured'], telemetry['verified_status'])) else 'unavailable'
    if require_live:
        require(config.get('live_interactions') is True and status_state == 'available' and dependencies == 'verified',
                'live_dependencies_unavailable')
    durations = []
    for _ in range(10):
        started = time.perf_counter()
        search()
        durations.append((time.perf_counter() - started) * 1000)
    return {'status': 'passed', 'version': version, 'mode': result['mode'], 'degraded': result['degraded'],
            'results': result['total'], 'plan_b_count': len(items), 'plan_b_nonempty_verified': bool(items),
            'service_status': status_state, 'dependencies': dependencies, 'require_live': require_live,
            'searches': 10, 'p95_ms': round(sorted(durations)[math.ceil(.95 * len(durations)) - 1], 2),
            'latency_scope': 'bounded read-only smoke including process startup; not service latency or a production benchmark'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Explicit app base URL; HTTPS except loopback')
    parser.add_argument('--expect-version', help='Exact served APP_VERSION; stale or mixed versions fail')
    parser.add_argument('--env', type=Path, help='Private file containing ADMIN_TOKEN; enables protected dependency reads')
    parser.add_argument('--require-live', action='store_true', help='Require expected version, healthy live search, metrics and dependencies')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(run(args.url, args.expect_version, args.env, args.require_live), indent=2))
        return 0
    except OperationError as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
