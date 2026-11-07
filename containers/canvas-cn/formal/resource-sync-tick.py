#!/usr/bin/env python3
"""Deliver bounded origin-owned publication snapshots in both directions."""
import argparse
import hashlib
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def endpoint(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ['', '/']:
        raise ValueError('invalid origin')
    if not (parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
        raise ValueError('HTTPS required outside loopback')
    return value.rstrip('/')


def write_monitor(path, value):
    tmp = path.with_suffix('.next')
    with tmp.open('w', encoding='utf-8') as output:
        os.chmod(tmp, 0o600)
        json.dump(value, output)
    os.replace(tmp, path)


def run(args):
    config = json.loads(pathlib.Path(args.config).read_text(encoding='utf-8'))
    registry = json.loads(pathlib.Path(args.sources).read_text(encoding='utf-8'))
    streams = ['gallery', 'components'] + [s['key'] for s in registry['sources']]
    sides = [(endpoint(config[k + 'Origin']), pathlib.Path(config[k + 'TokenFile']).read_text().strip())
             for k in ['local', 'peer']]
    if sides[0][0] == sides[1][0] or any(not token or '\n' in token or '\r' in token for _, token in sides):
        raise ValueError('invalid peer configuration')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(side, stream, operation, body=None, query=''):
        if not stream.replace('-', '').isalnum():
            raise ValueError('invalid stream')
        origin, token = sides[side]
        request = urllib.request.Request(origin + '/api/resource-sync/' + stream + '/' + operation + query,
            data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                     'User-Agent': 'Analog-Canvas-Regional/1 (+https://analog-canvas.tokenzhang.com)'})
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('tick deadline')
        with opener.open(request, timeout=min(15, remaining)) as response:
            raw = response.read(50 * 1024 * 1024 + 1)
        if len(raw) > 50 * 1024 * 1024:
            raise ValueError('oversized peer response')
        return json.loads(raw)

    deadline = time.monotonic() + args.max_seconds
    sent = 0
    caught = False
    while time.monotonic() < deadline:
        changed = False
        for stream in streams:
            for source, target in [(1, 0), (0, 1)]:
                if time.monotonic() >= deadline:
                    return {'status': 'sent', 'transferred': sent}
                current = call(target, stream, 'status')
                if current.get('region') != ('cn' if target == 0 else 'overseas'):
                    raise ValueError('peer identity mismatch')
                received = current.get('received')
                after = 0 if received is None else received['sequence']
                if type(after) is not int or after < 0:
                    raise ValueError('invalid peer cursor')
                item = call(source, stream, 'changes', query='?after=' + str(after))
                expected_origin = 'cn' if source == 0 else 'overseas'
                if item.get('event', 'absent') is None:
                    if item.get('region') != expected_origin or item.get('sequence') != after:
                        raise ValueError('source tail mismatch')
                    if received is not None and received['epoch'] != item.get('epoch'):
                        raise ValueError('source epoch changed')
                    continue
                payload = item.get('payload')
                if not isinstance(payload, str) or hashlib.sha256(payload.encode()).hexdigest() != item.get('digest'):
                    raise ValueError('peer integrity failure')
                event = json.loads(payload)
                if event.get('origin') != expected_origin or event.get('stream') != stream or event.get('after') != after:
                    raise ValueError('peer identity mismatch')
                result = call(target, stream, 'changes', item)
                if result.get('sequence') != event.get('sequence'):
                    raise ValueError('invalid durable receipt')
                changed = True
                sent += 1
        if not changed:
            caught = True
            break
    return {'status': 'caught-up' if caught else 'sent', 'transferred': sent}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['config', 'sources', 'state']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--max-seconds', type=int, choices=range(1, 71), default=70)
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
        reason = None if now - caught <= 120 else 'replication-lag'
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
