"""Bounded HTTP helpers for operator commands; never expose provider bodies."""
import base64
import http.client
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.ingest.elastic import ElasticError, NoRedirect, read_env

MAX_WORKER_INPUT = 65536
REASONS = frozenset(('target_requires_https_or_loopback_without_credentials', 'invalid_request_bound',
                     'request_exceeds_bound', 'request_timed_out', 'unexpected_http_status',
                     'response_exceeds_bound', 'redirect_refused', 'http_request_failed',
                     'transport_unavailable', 'invalid_response', 'request_worker_failed'))


class OperationError(RuntimeError):
    """Only fixed, non-sensitive reason codes may be passed to this error."""


def require(condition, reason):
    if not condition:
        raise OperationError(reason)


def admin_token(path):
    try:
        token = read_env(path).get('ADMIN_TOKEN', '')
    except (OSError, ValueError, UnicodeError):
        raise OperationError('private_configuration_unavailable') from None
    require(isinstance(token, str) and 0 < len(token) <= 8192 and
            all(33 <= ord(character) <= 126 for character in token), 'admin_token_missing_or_invalid')
    return token


class Client:
    def __init__(self, url, timeout=10):
        try:
            parsed = urllib.parse.urlsplit(url)
            local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
            valid = (bool(parsed.hostname) and not parsed.username and not parsed.password and
                     not parsed.query and not parsed.fragment and
                     (parsed.scheme == 'https' or (parsed.scheme == 'http' and local)))
            parsed.port
        except ValueError:
            valid = False
        require(valid, 'target_requires_https_or_loopback_without_credentials')
        require(isinstance(timeout, (int, float)) and not isinstance(timeout, bool) and
                0 < timeout <= 60 and math.isfinite(timeout), 'invalid_request_bound')
        self.url = url.rstrip('/')
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, method='GET', body=None, token=None, max_bytes=2_000_000):
        """Own one child for the complete request, including DNS and slow headers.

        A socket timeout only limits idle time. A parent-process deadline can stop
        a peer that continuously drips bytes, without global alarms or threads.
        Request contents travel solely over private pipes, never argv or env.
        """
        require(type(max_bytes) is int and 0 < max_bytes <= 2_000_000, 'invalid_request_bound')
        payload = json.dumps({'url': self.url, 'timeout': self.timeout, 'path': path,
                              'options': {'method': method, 'body': body, 'token': token, 'max_bytes': max_bytes}}).encode()
        require(len(payload) <= MAX_WORKER_INPUT, 'request_exceeds_bound')
        deadline = time.monotonic() + self.timeout
        process = None
        try:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--http-worker'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'request_timed_out')
            output, _ = process.communicate(input=payload, timeout=remaining)
            require(process.returncode == 0 and len(output) <= 4 * ((max_bytes + 2) // 3) + 512,
                    'request_worker_failed')
            reply = json.loads(output)
            require(isinstance(reply, dict), 'request_worker_failed')
            if 'error' in reply:
                reason = reply['error']
                raise OperationError(reason if isinstance(reason, str) and reason in REASONS else 'request_worker_failed')
            require(isinstance(reply.get('body'), str), 'request_worker_failed')
            decoded = base64.b64decode(reply['body'], validate=True)
            require(len(decoded) <= max_bytes, 'response_exceeds_bound')
            return decoded
        except subprocess.TimeoutExpired:
            raise OperationError('request_timed_out') from None
        except (OSError, ValueError, UnicodeError):
            raise OperationError('request_worker_failed') from None
        finally:
            if process is not None:
                # Kill before reaping on every incomplete path, including caller
                # cancellation. The child owns no descendants or worker threads.
                if process.poll() is None:
                    process.kill()
                process.communicate()

    def _request_direct(self, path, method='GET', body=None, token=None, max_bytes=2_000_000):
        """Worker-only transport; the parent enforces its wall-clock deadline."""
        require(type(max_bytes) is int and 0 < max_bytes <= 2_000_000, 'invalid_request_bound')
        headers = {'Accept': 'application/json'}
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        encoded = None
        if body is not None:
            encoded = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.url + path, method=method, data=encoded, headers=headers)
        deadline = time.monotonic() + self.timeout
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                require(response.status == 200, 'unexpected_http_status')
                length = response.headers.get('Content-Length')
                if length is not None:
                    require(0 <= int(length) <= max_bytes, 'response_exceeds_bound')
                chunks = []
                received = 0
                while True:
                    require(time.monotonic() < deadline, 'request_timed_out')
                    chunk = response.read1(min(65536, max_bytes + 1 - received))
                    if not chunk:
                        return b''.join(chunks)
                    received += len(chunk)
                    require(received <= max_bytes, 'response_exceeds_bound')
                    chunks.append(chunk)
        except ElasticError:
            raise OperationError('redirect_refused') from None
        except urllib.error.HTTPError:
            raise OperationError('http_request_failed') from None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
            raise OperationError('transport_unavailable') from None
        except (ValueError, UnicodeError):
            raise OperationError('invalid_response') from None

    def json(self, path, **options):
        def reject_constant(_value):
            raise ValueError('nonfinite JSON')
        try:
            value = json.loads(self.request(path, **options), parse_constant=reject_constant)
        except (ValueError, UnicodeError):
            raise OperationError('invalid_json_response') from None
        require(isinstance(value, dict), 'invalid_json_response')
        return value


def _worker():
    """Internal private-pipe protocol. Never emit exceptions or request values."""
    try:
        raw = sys.stdin.buffer.read(MAX_WORKER_INPUT + 1)
        require(len(raw) <= MAX_WORKER_INPUT, 'request_exceeds_bound')
        task = json.loads(raw)
        client = Client(task['url'], task['timeout'])
        result = client._request_direct(task['path'], **task['options'])
        reply = {'body': base64.b64encode(result).decode('ascii')}
    except OperationError as error:
        reason = str(error)
        reply = {'error': reason if reason in REASONS else 'request_worker_failed'}
    except Exception:
        reply = {'error': 'request_worker_failed'}
    sys.stdout.write(json.dumps(reply))


if __name__ == '__main__':
    if sys.argv[1:] != ['--http-worker']:
        sys.exit(2)
    _worker()
