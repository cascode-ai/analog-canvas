#!/usr/bin/env python3
"""Deliver bounded origin-owned publication snapshots in both directions."""
import argparse
import gzip
import hashlib
import http.client
import json
import math
import os
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

MAX_RESPONSE = 50 * 1024 * 1024
TOKEN = re.compile(r'^[a-z0-9-]{1,64}$')
RANK = {'blocked': 4, 'retry': 3, 'pending': 2, 'sent': 1, 'caught-up': 0}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Blocked(Exception):
    """A refusal the next attempt would repeat; the stream waits for repair."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason if TOKEN.match(reason) else 'invalid-response'


class Retry(Exception):
    """A transient fault; the stream is retried on the next tick."""


def endpoint(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ['', '/']:
        raise ValueError('invalid origin')
    if not (parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
        raise ValueError('HTTPS required outside loopback')
    return value.rstrip('/')


def request_timeout(payload_bytes, remaining, cap=120):
    """15 s plus 1 s per 256 KiB of payload, capped and bounded by the tick deadline."""
    return min(15 + math.ceil(payload_bytes / (256 * 1024)), cap, remaining)


def write_monitor(path, value):
    tmp = path.with_suffix('.next')
    with tmp.open('w', encoding='utf-8') as output:
        os.chmod(tmp, 0o600)
        json.dump(value, output)
    os.replace(tmp, path)


def read_body(response, until):
    """Read a bounded, possibly gzip-encoded body before the request deadline."""
    encoding = (response.headers.get('Content-Encoding') or 'identity').strip().lower()
    if encoding not in ('identity', 'gzip'):
        raise Blocked('unsupported-encoding')
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS) if encoding == 'gzip' else None
    body = bytearray()
    while True:
        if time.monotonic() > until:
            raise Retry('request-deadline')
        chunk = response.read(256 * 1024)
        if not chunk:
            break
        body += inflater.decompress(chunk, MAX_RESPONSE + 1 - len(body)) if inflater else chunk
        if len(body) > MAX_RESPONSE or (inflater and inflater.unconsumed_tail):
            raise Blocked('oversized-response')
    if inflater:
        body += inflater.flush(MAX_RESPONSE + 1 - len(body))
        if len(body) > MAX_RESPONSE:
            raise Blocked('oversized-response')
    return bytes(body)


def refusal(error):
    """The peer's typed refusal token, never its payload."""
    try:
        raw = error.read(8192)
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)[:8192]
        reason = json.loads(raw).get('error')
        if isinstance(reason, str) and TOKEN.match(reason):
            return reason
    except (OSError, ValueError, AttributeError, EOFError, zlib.error):
        pass
    return 'http-' + str(error.code)


def run(args):
    config = json.loads(pathlib.Path(args.config).read_text(encoding='utf-8'))
    registry = json.loads(pathlib.Path(args.sources).read_text(encoding='utf-8'))
    stores = ['gallery'] + [s['key'] for s in registry['sources']]
    streams = (['gallery', 'components'] + stores[1:] + [s + '-interactions' for s in stores]
               + [s + '-opens' for s in stores] + [s + '-activity' for s in stores])
    sides = [(endpoint(config[k + 'Origin']), pathlib.Path(config[k + 'TokenFile']).read_text().strip())
             for k in ['local', 'peer']]
    if sides[0][0] == sides[1][0] or any(not token or '\n' in token or '\r' in token for _, token in sides):
        raise ValueError('invalid peer configuration')
    if any(not s.replace('-', '').isalnum() for s in streams):
        raise ValueError('invalid stream')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + args.max_seconds

    def call(side, stream, operation, body=None, query=''):
        origin, token = sides[side]
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                   'Accept-Encoding': 'gzip',
                   'User-Agent': 'Analog-Canvas-Regional/1 (+https://analog-canvas.tokenzhang.com)'}
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Retry('tick-deadline')
        data = None
        if body is not None:
            encoded = json.dumps(body, ensure_ascii=False).encode()
            data = gzip.compress(encoded)
            headers['Content-Encoding'] = 'gzip'
            timeout = request_timeout(len(encoded), remaining)
        elif operation == 'changes':
            # A download's size is unknown in advance: allow one maximal snapshot.
            timeout = min(120, remaining)
        else:
            timeout = request_timeout(0, remaining)
        request = urllib.request.Request(origin + '/api/resource-sync/' + stream + '/' + operation + query,
                                         data=data, headers=headers)
        try:
            with opener.open(request, timeout=timeout) as response:
                raw = read_body(response, time.monotonic() + timeout)
        except urllib.error.HTTPError as error:
            if error.code >= 500 or error.code == 429:
                raise Retry('http-' + str(error.code))
            raise Blocked(refusal(error))
        except (OSError, http.client.HTTPException):
            raise Retry('transport')
        try:
            return json.loads(raw)
        except ValueError:
            raise Blocked('invalid-response')

    def step(stream, source, target):
        """Deliver at most one snapshot; return the outcome and the target's cursor."""
        current = call(target, stream, 'status')
        if current.get('region') != ('cn' if target == 0 else 'overseas'):
            raise Blocked('peer-identity-mismatch')
        received = current.get('received')
        after = 0 if received is None else received.get('sequence')
        if type(after) is not int or after < 0:
            raise Blocked('invalid-peer-cursor')
        item = call(source, stream, 'changes', query='?after=' + str(after))
        expected_origin = 'cn' if source == 0 else 'overseas'
        if item.get('event', 'absent') is None:
            if item.get('region') != expected_origin or item.get('sequence') != after:
                raise Blocked('source-tail-mismatch')
            if received is not None and received.get('epoch') != item.get('epoch'):
                raise Blocked('source-epoch-changed')
            return 'caught-up', after
        payload = item.get('payload')
        if not isinstance(payload, str) or hashlib.sha256(payload.encode()).hexdigest() != item.get('digest'):
            raise Blocked('peer-integrity-failure')
        event = json.loads(payload)
        if event.get('origin') != expected_origin or event.get('stream') != stream or event.get('after') != after:
            raise Blocked('peer-identity-mismatch')
        result = call(target, stream, 'changes', item)
        if result.get('sequence') != event.get('sequence'):
            raise Blocked('invalid-durable-receipt')
        return 'sent', result['sequence']

    # One failing stream never stops the others: each direction is retried
    # round-robin until it is caught up, refused or the tick ends.
    units = {(stream, source, 1 - source): {'status': 'pending', 'reason': None, 'cursor': None}
             for stream in streams for source in (1, 0)}
    active = list(units)
    sent = 0
    while active and time.monotonic() < deadline:
        for unit in list(active):
            if time.monotonic() >= deadline:
                break
            state = units[unit]
            try:
                state['status'], state['cursor'] = step(*unit)
                state['reason'] = None
            except Blocked as error:
                state.update(status='blocked', reason=error.reason)
            except Retry as error:
                state.update(status='retry', reason=str(error))
            except (ValueError, TypeError, KeyError, AttributeError):
                state.update(status='blocked', reason='invalid-response')
            if state['status'] == 'sent':
                sent += 1
            else:
                active.remove(unit)
    report = {}
    for stream in streams:
        directions = [(units[(stream, source, 1 - source)], 'cn' if source == 1 else 'overseas') for source in (1, 0)]
        worst = max((state for state, _ in directions), key=lambda state: RANK[state['status']])
        report[stream] = {'status': worst['status'], 'reason': worst['reason'],
                          'cursor': {target: state['cursor'] for state, target in directions},
                          'directions': {target: state for state, target in directions}}
    statuses = {entry['status'] for entry in report.values()}
    overall = ('caught-up' if statuses == {'caught-up'} else 'blocked' if 'blocked' in statuses
               else 'retry' if 'retry' in statuses else 'sent')
    return {'status': overall, 'transferred': sent, 'streams': report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['config', 'sources', 'state']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--max-seconds', type=int, choices=range(1, 241), default=70, metavar='1..240')
    args = parser.parse_args()
    path = pathlib.Path(args.state)
    now = time.time()
    caught = 0
    try:
        previous = json.loads(path.read_text()) if path.exists() else {}
        checkpoint = previous.get('lastCaughtUpAt', previous.get('lastAttemptAt', now))
        if type(checkpoint) not in (int, float) or not 0 <= checkpoint <= now:
            raise ValueError('invalid monitor checkpoint')
        caught = checkpoint
        result = run(args)
        caught = now if result['status'] == 'caught-up' else caught
        reason = ('blocked' if result['status'] == 'blocked'
                  else None if now - caught <= 120 else 'replication-lag')
        result.update(health='ok' if reason is None else 'error', reason=reason)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        result = {'health': 'error', 'reason': 'transport-or-invalid-status', 'status': 'blocked'}
    result['lastAttemptAt'] = now
    result['lastCaughtUpAt'] = caught
    write_monitor(path, result)
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
