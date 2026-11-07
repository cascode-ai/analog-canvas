#!/usr/bin/env python3
"""Run one local replication tick; expose failures to systemd without payloads."""
import argparse
import json
import math
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def read_json(opener, origin, route, token, post=False):
    request = urllib.request.Request(
        origin + '/api/project-sync/' + route,
        data=b'{}' if post else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    )
    with opener.open(request, timeout=40) as response:
        body = response.read(8193)
    if len(body) > 8192:
        raise ValueError('oversized response')
    return json.loads(body)


def check_status(status):
    if not isinstance(status, dict) or status.get('origin') != 'cn':
        raise ValueError('invalid region')
    for name in ['sequence', 'acknowledged', 'pending', 'journalBytes']:
        if type(status.get(name)) is not int or status[name] < 0:
            raise ValueError('invalid counter')
    if type(status.get('fenced')) is not bool or 'oldestPendingAt' not in status:
        raise ValueError('invalid status')


def save_status(state, result):
    temp = state.with_suffix('.next')
    with temp.open('w', encoding='utf-8') as output:
        os.chmod(temp, 0o600)
        json.dump(result, output)
    os.replace(temp, state)


def run(args):
    parsed = urllib.parse.urlsplit(args.origin)
    if (parsed.scheme != 'http' or parsed.hostname not in ['127.0.0.1', 'localhost', '::1']
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ['', '/']):
        raise ValueError('loopback origin required')
    if args.max_journal_bytes < 1 or args.max_lag_seconds < 1:
        raise ValueError('invalid monitoring limit')
    credentials = pathlib.Path(args.credentials)
    admin = (credentials / 'sync-admin-token').read_text().strip()
    peer = (credentials / 'sync-inbound-token').read_text().strip()
    if not admin or not peer:
        raise ValueError('missing credentials')
    # Loopback requests never use a machine-wide HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    pump = read_json(opener, args.origin.rstrip('/'), 'run', admin, True)
    if not isinstance(pump, dict) or pump.get('status') not in ['caught-up', 'sent', 'retry', 'blocked', 'disabled']:
        raise ValueError('invalid pump result')
    status = read_json(opener, args.origin.rstrip('/'), 'status', peer)
    check_status(status)
    now = time.time()
    state = pathlib.Path(args.state)
    previous = json.loads(state.read_text()) if state.exists() else {}
    caught_up = previous.get('lastCaughtUpAt', now)
    if type(caught_up) not in [int, float] or not math.isfinite(caught_up) or not 0 <= caught_up <= now:
        raise ValueError('invalid checkpoint')
    if caught_up == 0:
        caught_up = now
    if pump['status'] == 'caught-up':
        caught_up = now
    lag = now - caught_up
    if status['oldestPendingAt'] is not None:
        oldest = datetime.fromisoformat(status['oldestPendingAt'].replace('Z', '+00:00'))
        if oldest.tzinfo is None:
            raise ValueError('missing timestamp timezone')
        lag = max(lag, now - oldest.timestamp())
    reason = None
    if pump['status'] not in ['sent', 'caught-up']:
        reason = pump['status']
    elif status['fenced']:
        reason = 'write-fenced'
    elif status['journalBytes'] >= args.max_journal_bytes * 0.8:
        reason = 'journal-capacity'
    elif lag > args.max_lag_seconds:
        reason = 'replication-lag'
    result = dict(health='failed' if reason else 'ok', reason=reason,
                  status=pump['status'], pending=status['pending'],
                  journalBytes=status['journalBytes'], lagSeconds=round(max(lag, 0)),
                  lastAttemptAt=now, lastCaughtUpAt=caught_up)
    save_status(state, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:8792')
    parser.add_argument('--credentials', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--max-journal-bytes', type=int, default=1024**3)
    parser.add_argument('--max-lag-seconds', type=int, default=120)
    args = parser.parse_args()
    try:
        result = run(args)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, urllib.error.URLError):
        # Exception bodies may contain an upstream payload or credential path.
        now = time.time()
        caught_up = now
        try:
            previous = json.loads(pathlib.Path(args.state).read_text()).get('lastCaughtUpAt')
            if type(previous) in [int, float] and math.isfinite(previous) and 0 < previous <= now:
                caught_up = previous
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        result = {'health': 'failed', 'reason': 'transport-or-invalid-status',
                  'lastAttemptAt': now, 'lastCaughtUpAt': caught_up}
        try:
            save_status(pathlib.Path(args.state), result)
        except OSError:
            # The independent watcher treats an unchanged/missing file as stale.
            pass
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
