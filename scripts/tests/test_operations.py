import contextlib
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
TOKEN = 'fixture-admin-token-private'
PRIVATE = 'fixture-provider-secret-never-print'
VERSION = 'fixture-sha123'


class Fixture:
    def __init__(self):
        now = datetime.now(timezone.utc)
        iso = lambda value: value.isoformat().replace('+00:00', 'Z')
        self.talk = dict(id='qa-one', room='Salt Palace | Level 1 | A', start=iso(now + timedelta(days=1)),
                         end=iso(now + timedelta(days=1, minutes=30)), fullness={'likely_full': False})
        self.alternative = {**self.talk, 'id': 'qa-two', 'room': 'Salt Palace | Level 1 | B'}
        self.routes = {
            '/': '<html>Overflow</html>',
            '/healthz': {'ok': True, 'version': VERSION},
            '/readyz': {'ok': True, 'version': VERSION},
            '/api/config': {'version': VERSION, 'live_interactions': True},
            '/api/search': {'version': VERSION, 'items': [self.talk], 'total': 1, 'mode': 'hybrid', 'degraded': False},
            '/api/planb/qa-one': {'items': [self.alternative], 'mode': 'hybrid', 'degraded': False},
            '/api/status': {'status': 'available', 'version': VERSION, 'p95_ms': 12, 'error_ratio': 0,
                            'degraded_share': 0, 'as_of': iso(now)},
            '/api/deps': {'version': VERSION, 'elasticsearch': {'configured': True, 'connected': True},
                          'telemetry': {'configured': True, 'verified_status': True}},
        }
        self.calls = []
        self.redirects = {}
        self.statuses = {}
        self.delays = {}
        self.invalid_chunked = set()
        self.omit_length = set()
        self.trickle_headers = set()
        self.trickle_disconnected = threading.Event()
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.respond()

            def do_POST(self):
                self.respond()

            def respond(self):
                path = urlsplit(self.path).path
                body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                fixture.calls.append(dict(method=self.command, path=path, auth=self.headers.get('Authorization'), body=body))
                if path in fixture.trickle_headers:
                    try:
                        self.wfile.write(b'HTTP/1.1 200 OK\r\nX-Slow: ')
                        for _ in range(30):
                            self.wfile.write(b'a')
                            self.wfile.flush()
                            time.sleep(.04)
                        self.wfile.write(b'\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')
                    except (BrokenPipeError, ConnectionResetError):
                        fixture.trickle_disconnected.set()
                    self.close_connection = True
                    return
                if path in fixture.redirects:
                    self.send_response(307)
                    self.send_header('Location', fixture.redirects[path])
                    self.end_headers()
                    return
                if path in fixture.invalid_chunked:
                    self.send_response(200)
                    self.send_header('Transfer-Encoding', 'chunked')
                    self.end_headers()
                    self.wfile.write(b'not-a-chunk-size\r\nprivate-body\r\n')
                    self.close_connection = True
                    return
                if fixture.delays.get(path):
                    time.sleep(fixture.delays[path])
                if path == '/api/admin/mode' and path not in fixture.routes:
                    value = {'ok': True, 'mode': json.loads(body)['mode']}
                else:
                    value = fixture.routes.get(path, {'error': PRIVATE})
                encoded = value if isinstance(value, bytes) else value.encode() if isinstance(value, str) else json.dumps(value).encode()
                self.send_response(fixture.statuses.get(path, 200))
                if path not in fixture.omit_length:
                    self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                    self.wfile.write(encoded)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = Path(self.directory.name) / 'private.env'
        self.env.write_text(f'ADMIN_TOKEN={TOKEN}\nES_API_KEY={PRIVATE}\n')

    def cli(self, script, *args):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *map(str, args)],
                                cwd=ROOT, text=True, capture_output=True, timeout=15)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertNotIn(PRIVATE, result.stdout + result.stderr)
        return result

    def assert_error(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Traceback', result.stdout + result.stderr)
        self.assertTrue(result.stdout.startswith('{'), 'CLI must emit a structured, redacted failure')
        self.assertEqual(json.loads(result.stdout)['status'], 'failed')

    def test_admin_sends_only_explicit_mode_with_protected_header(self):
        with Fixture() as fixture:
            for mode in ('bm25', 'hybrid', 'hybrid_rerank'):
                result = self.cli('admin.py', fixture.url, mode, '--env', self.env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), {'status': 'updated', 'mode': mode})
                self.assertEqual(fixture.calls[-1], dict(method='POST', path='/api/admin/mode', auth='Bearer ' + TOKEN,
                                                       body=json.dumps({'mode': mode}).encode()))

    def test_admin_refuses_remote_cleartext_embedded_credentials_and_missing_token(self):
        for url in ('http://example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/?token=hidden'):
            with self.subTest(url=url):
                self.assert_error(self.cli('admin.py', url, 'hybrid', '--env', self.env))
        self.env.write_text('ES_API_KEY=' + PRIVATE)
        with Fixture() as fixture:
            self.assert_error(self.cli('admin.py', fixture.url, 'hybrid', '--env', self.env))
            self.assertEqual(fixture.calls, [])

    def test_admin_does_not_follow_redirect_or_print_provider_error(self):
        with Fixture() as origin, Fixture() as target:
            origin.redirects['/api/admin/mode'] = target.url + '/capture'
            self.assert_error(self.cli('admin.py', origin.url, 'hybrid', '--env', self.env))
            self.assertEqual(target.calls, [])
            origin.redirects.clear()
            origin.statuses['/api/admin/mode'] = 503
            origin.routes['/api/admin/mode'] = {'error': PRIVATE + TOKEN}
            self.assert_error(self.cli('admin.py', origin.url, 'hybrid', '--env', self.env))

    def test_admin_rejects_oversized_or_mismatched_acknowledgement(self):
        with Fixture() as fixture:
            fixture.routes['/api/admin/mode'] = b'x' * 70000
            fixture.omit_length.add('/api/admin/mode')
            self.assert_error(self.cli('admin.py', fixture.url, 'hybrid', '--env', self.env))
            fixture.routes['/api/admin/mode'] = {'ok': True, 'mode': 'bm25'}
            self.assert_error(self.cli('admin.py', fixture.url, 'hybrid', '--env', self.env))

    def test_smoke_default_is_read_only_and_checks_consistent_version(self):
        with Fixture() as fixture:
            result = self.cli('smoke.py', fixture.url, '--expect-version', VERSION)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['version'], VERSION)
            self.assertEqual(report['plan_b_count'], 1)
            self.assertEqual(report['dependencies'], 'not_checked')
            self.assertTrue(all(call['method'] == 'GET' and call['auth'] is None for call in fixture.calls))
            self.assertNotIn('/api/deps', [call['path'] for call in fixture.calls])

    def test_smoke_rejects_wrong_expected_or_mixed_version(self):
        with Fixture() as fixture:
            self.assert_error(self.cli('smoke.py', fixture.url, '--expect-version', 'different-sha'))
            for path in ('/healthz', '/readyz', '/api/search', '/api/status'):
                with self.subTest(path=path):
                    fixture.routes[path]['version'] = 'stale-sha'
                    self.assert_error(self.cli('smoke.py', fixture.url, '--expect-version', VERSION))
                    fixture.routes[path]['version'] = VERSION

    def test_smoke_live_checks_protected_dependencies_and_rejects_fallback(self):
        with Fixture() as fixture:
            args = (fixture.url, '--expect-version', VERSION, '--env', self.env, '--require-live')
            result = self.cli('smoke.py', *args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['dependencies'], 'verified')
            deps = [call for call in fixture.calls if call['path'] == '/api/deps']
            self.assertEqual(len(deps), 1)
            self.assertEqual(deps[0]['auth'], 'Bearer ' + TOKEN)
            self.assertTrue(all(call['auth'] is None for call in fixture.calls if call['path'] != '/api/deps'))
            fixture.routes['/api/search'].update(mode='snapshot', degraded=True)
            self.assert_error(self.cli('smoke.py', *args))
            fixture.routes['/api/search'].update(mode='hybrid', degraded=False)
            fixture.routes['/api/deps']['elasticsearch']['connected'] = False
            self.assert_error(self.cli('smoke.py', *args))

    def test_smoke_status_requires_finite_values_or_explicit_unknowns(self):
        with Fixture() as fixture:
            fixture.routes['/api/status']['p95_ms'] = float('nan')
            self.assert_error(self.cli('smoke.py', fixture.url))
            fixture.routes['/api/status'].update(status='unavailable', p95_ms=None, error_ratio=None, degraded_share=None, as_of=None)
            result = self.cli('smoke.py', fixture.url)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            fixture.routes['/api/status']['error_ratio'] = 0
            self.assert_error(self.cli('smoke.py', fixture.url))

    def test_smoke_rejects_redirect_oversized_response_and_invalid_plan_b(self):
        with Fixture() as fixture, Fixture() as target:
            fixture.redirects['/api/config'] = target.url + '/api/config'
            self.assert_error(self.cli('smoke.py', fixture.url))
            self.assertEqual(target.calls, [])
            fixture.redirects.clear()
            fixture.routes['/'] = b'x' * 2100000
            self.assert_error(self.cli('smoke.py', fixture.url))
            fixture.routes['/'] = 'Overflow'
            fixture.routes['/api/planb/qa-one']['items'] = [fixture.talk]
            self.assert_error(self.cli('smoke.py', fixture.url))

    def test_transport_failure_and_timeout_are_bounded_and_redacted(self):
        with socket.socket() as closed:
            closed.bind(('127.0.0.1', 0))
            unused = closed.getsockname()[1]
        self.assert_error(self.cli('admin.py', f'http://127.0.0.1:{unused}', 'hybrid', '--env', self.env))
        self.assert_error(self.cli('smoke.py', f'http://127.0.0.1:{unused}'))
        try:
            operations = importlib.import_module('scripts.operations')
        except ModuleNotFoundError:
            self.fail('shared bounded operations transport is missing')
        with Fixture() as fixture:
            fixture.delays['/api/config'] = .2
            client = operations.Client(fixture.url, timeout=.03)
            started = time.monotonic()
            with self.assertRaises(operations.OperationError):
                client.json('/api/config')
            self.assertLess(time.monotonic() - started, .5)

    def test_smoke_rejects_non_boolean_fullness_and_unrepresentable_status_numbers(self):
        with Fixture() as fixture:
            fixture.alternative['fullness'] = {'likely_full': 0}
            self.assert_error(self.cli('smoke.py', fixture.url))
            fixture.alternative['fullness'] = {'likely_full': False}
            fixture.routes['/api/status']['p95_ms'] = 10 ** 1000
            self.assert_error(self.cli('smoke.py', fixture.url))

    def test_live_check_requires_explicit_revision_and_private_file_before_requesting(self):
        with Fixture() as fixture:
            for extra in ((), ('--expect-version', VERSION), ('--env', self.env)):
                with self.subTest(extra=extra):
                    self.assert_error(self.cli('smoke.py', fixture.url, '--require-live', *extra))
                    self.assertEqual(fixture.calls, [])

    def test_invalid_chunked_transport_returns_redacted_failure(self):
        with Fixture() as fixture:
            fixture.invalid_chunked.add('/api/admin/mode')
            self.assert_error(self.cli('admin.py', fixture.url, 'hybrid', '--env', self.env))

    def test_trickling_headers_obey_wall_deadline_and_request_worker_is_reaped(self):
        operations = importlib.import_module('scripts.operations')
        children = []
        real_popen = subprocess.Popen

        def record_child(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            self.assertNotIn(TOKEN, str(args))
            self.assertNotIn(TOKEN, str(kwargs.get('env', {})))
            return child

        with Fixture() as fixture:
            fixture.trickle_headers.add('/slow-headers')
            prior_default = socket.getdefaulttimeout()
            prior_threads = {thread.ident for thread in threading.enumerate() if not thread.daemon}
            started = time.monotonic()
            with patch.object(subprocess, 'Popen', side_effect=record_child):
                with self.assertRaises(operations.OperationError) as failure:
                    operations.Client(fixture.url, timeout=.15).json('/slow-headers', token=TOKEN)
            self.assertLess(time.monotonic() - started, .65, 'A peer must not extend the deadline by dripping header bytes')
            self.assertNotIn(TOKEN, str(failure.exception))
            self.assertTrue(children, 'The isolated request must have an owned process')
            self.assertTrue(all(child.poll() is not None for child in children), 'Every request child must be reaped')
            self.assertTrue(fixture.trickle_disconnected.wait(.5), 'Deadline must close the active socket')
            with patch.object(subprocess, 'Popen', side_effect=record_child):
                self.assertEqual(operations.Client(fixture.url).json('/api/config')['version'], VERSION)
            self.assertEqual(len(children), 2)
            self.assertTrue(all(child.poll() is not None for child in children), 'Successful requests must also be reaped')
            self.assertEqual(socket.getdefaulttimeout(), prior_default)
            self.assertEqual({thread.ident for thread in threading.enumerate() if not thread.daemon}, prior_threads)

    def test_request_deadline_does_not_interrupt_unrelated_thread(self):
        operations = importlib.import_module('scripts.operations')
        finished = threading.Event()
        errors = []
        with Fixture() as fixture:
            fixture.trickle_headers.add('/slow-headers')
            def unrelated_request():
                try:
                    time.sleep(.25)
                    with operations.urllib.request.urlopen(fixture.url + '/api/config', timeout=1) as response:
                        self.assertEqual(json.loads(response.read())['version'], VERSION)
                except Exception as error:
                    errors.append(error)
                finally:
                    finished.set()
            thread = threading.Thread(target=unrelated_request)
            thread.start()
            try:
                with self.assertRaises(operations.OperationError):
                    operations.Client(fixture.url, timeout=.15).json('/slow-headers')
                self.assertTrue(finished.wait(1))
                self.assertEqual(errors, [])
                self.assertEqual(operations.Client(fixture.url).json('/api/config')['version'], VERSION)
            finally:
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()
