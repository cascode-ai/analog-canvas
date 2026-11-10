#!/usr/bin/env python3
"""Deliver one analytics batch through the local runtime; record only health."""
import argparse
import json
import math
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(args):
    parsed = urllib.parse.urlsplit(args.origin)
    if (parsed.scheme != 'http' or parsed.hostname not in ['127.0.0.1', 'localhost', '::1']
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ['', '/']):
        raise ValueError('loopback origin required')
    state = pathlib.Path(args.state)
    previous = json.loads(state.read_text()) if state.exists() else {}
    now = time.time()
    result = dict(health='failed', reason='retry', lastAttemptAt=now, mode=previous.get('mode'))
    try:
        token = (pathlib.Path(args.credentials) / 'sync-admin-token').read_text().strip()
        if not token:
            raise ValueError('missing credential')
        request = urllib.request.Request(args.origin.rstrip('/') + '/api/analytics-sync/tick', data=b'{}',
                                         headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=75) as response:
            raw = response.read(8193)
        if len(raw) > 8192:
            raise ValueError('oversized status')
        status = json.loads(raw)
        if status.get('mode') == 'standalone' and previous.get('mode') != 'collector':
            result.update(health='ok', reason=None, status='not-enabled', mode='standalone')
        else:
            if status.get('mode') != 'collector':
                result['reason'] = 'disabled'
                raise ValueError('collector stopped')
            for name in ['sequence', 'acknowledged', 'pending']:
                if type(status.get(name)) is not int or status[name] < 0:
                    raise ValueError('invalid status')
            if status['sequence'] - status['acknowledged'] != status['pending']:
                raise ValueError('inconsistent status')
            oldest = status.get('oldestPendingAt')
            if status['pending'] and (type(oldest) not in [int, float] or not math.isfinite(oldest) or oldest < 0):
                raise ValueError('missing oldest event')
            lag = max(0, now - oldest / 1000) if oldest is not None else 0
            result.update(mode='collector', pending=status['pending'], lagSeconds=lag,
                          status='pending' if status['pending'] else 'caught-up',
                          health='failed' if lag > 120 else 'ok', reason='replication-lag' if lag > 120 else None)
    except urllib.error.HTTPError as error:
        result['reason'] = 'blocked' if error.code == 409 else 'retry'
    except (OSError, ValueError, TypeError, KeyError):
        pass
    temporary = state.with_suffix('.next')
    with temporary.open('w', encoding='utf-8') as output:
        os.chmod(temporary, 0o600)
        json.dump(result, output)
    os.replace(temporary, state)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:8792')
    parser.add_argument('--credentials', required=True)
    parser.add_argument('--state', required=True)
    args = parser.parse_args()
    result = run(args)
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
