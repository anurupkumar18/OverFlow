#!/usr/bin/env python3
"""Set one explicitly chosen ranking mode through the protected app endpoint."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.operations import Client, OperationError, admin_token, require


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Explicit app base URL; HTTPS except loopback')
    parser.add_argument('mode', choices=('bm25', 'hybrid', 'hybrid_rerank'))
    parser.add_argument('--env', required=True, type=Path, help='Private file containing ADMIN_TOKEN; read internally')
    args = parser.parse_args(argv)
    try:
        client = Client(args.url)
        token = admin_token(args.env)
        response = client.json('/api/admin/mode', method='POST', body={'mode': args.mode}, token=token, max_bytes=65536)
        require(response.get('ok') is True and response.get('mode') == args.mode, 'mode_write_not_acknowledged')
        print(json.dumps({'status': 'updated', 'mode': args.mode}))
        return 0
    except OperationError as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
