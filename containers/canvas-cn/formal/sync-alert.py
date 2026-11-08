#!/usr/bin/env python3
"""Independently watch replication health and deliver bounded email alerts."""
import argparse
import json
import math
import os
import pathlib
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

CONFIRMATION_SECONDS = 120
IMMEDIATE_SYNC_FAILURES = {'blocked', 'disabled', 'journal-capacity'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def write_state(path, state):
    temp = path.with_suffix('.next')
    with temp.open('w', encoding='utf-8') as output:
        os.chmod(temp, 0o600)
        json.dump(state, output)
    os.replace(temp, path)


def condition(path, now, stale_seconds=120):
    try:
        status = json.loads(path.read_text())
        at = status.get('lastAttemptAt')
        if type(at) not in [int, float] or not math.isfinite(at) or at > now or now - at > stale_seconds:
            return 'stale-monitor'
        if status.get('health') == 'ok':
            return 'ok'
        reasons = {'retry', 'blocked', 'disabled', 'write-fenced', 'journal-capacity',
                   'replication-lag', 'transport-or-invalid-status',
                   'release-failed', 'release-rolled-back'}
        return status.get('reason') if status.get('reason') in reasons else 'invalid-monitor'
    except (OSError, ValueError, TypeError, AttributeError):
        return 'invalid-monitor'


def observe_confirmation(state, field, now):
    since = state.get(field)
    if type(since) not in [int, float] or not 0 <= since <= now:
        since = state[field] = now
    return now - since < CONFIRMATION_SECONDS


def observe_sync_health(path, state, previous, health, now):
    pending = state.get('pending')
    pending_condition = pending['condition'] if pending is not None else 'ok'
    before = state.copy()
    if (pending is not None and health in IMMEDIATE_SYNC_FAILURES
            and pending_condition not in IMMEDIATE_SYNC_FAILURES
            and (pending_condition == 'ok' or previous not in IMMEDIATE_SYNC_FAILURES)):
        state.setdefault('queuedUrgent', health)

    if health == 'ok':
        incident_open = (previous != 'ok' or pending_condition not in ('ok', 'test')
                         or 'queuedUrgent' in state)
        field = 'recoverySince' if incident_open else None
    elif health in IMMEDIATE_SYNC_FAILURES:
        field = None
    else:
        # Keep the existing retry clock across upgrades and soft reason changes.
        field = 'retrySince'

    for other in ('retrySince', 'recoverySince'):
        if other != field:
            state.pop(other, None)
    waiting = field is not None and observe_confirmation(state, field, now)
    if state != before:
        write_state(path, state)
    return waiting


def run(args):
    scope = getattr(args, 'scope', 'Project')
    service = {'Publication': 'canvas-cn-resource-sync.service',
               'Release': 'canvas-cn-release.service'}.get(scope, 'canvas-cn-project-sync.service')
    endpoint = urllib.parse.urlsplit(args.mail_endpoint)
    local_test = endpoint.scheme == 'http' and endpoint.hostname == '127.0.0.1' and endpoint.path == '/emails'
    if args.mail_endpoint != 'https://api.resend.com/emails' and not local_test:
        raise ValueError('unsupported mail endpoint')
    config = json.loads(pathlib.Path(args.config).read_text())
    for name in ['apiKey', 'from', 'to']:
        if not isinstance(config.get(name), str) or not config[name].strip() or '\n' in config[name] or '\r' in config[name]:
            raise ValueError('invalid mail configuration')
    state_path = pathlib.Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    now = time.time()
    health = condition(pathlib.Path(args.monitor), now, getattr(args, 'stale_seconds', 120))
    previous = state.get('acceptedCondition', 'ok')
    waiting = False
    if scope == 'Release':
        if health != 'retry' and state.pop('retrySince', None) is not None:
            write_state(state_path, state)
    else:
        waiting = observe_sync_health(state_path, state, previous, health, now)
    pending = state.get('pending')
    if pending is None:
        queued_urgent = state.get('queuedUrgent') if scope != 'Release' else None
        if not args.test and queued_urgent is None:
            if waiting:
                return {'result': 'waiting-for-confirmation'}
            if scope == 'Release' and health == 'retry':
                since = state.get('retrySince')
                waiting = observe_confirmation(state, 'retrySince', now)
                if state['retrySince'] != since:
                    write_state(state_path, state)
                if waiting:
                    return {'result': 'waiting-for-retry'}
        escalated = (scope != 'Release' and health in IMMEDIATE_SYNC_FAILURES
                     and previous not in IMMEDIATE_SYNC_FAILURES)
        if args.test:
            if state.get('testAccepted'):
                return {'result': 'already-tested'}
            target = 'test'
        elif queued_urgent is not None:
            target = state.pop('queuedUrgent')
        elif health == 'ok' and previous == 'ok':
            return {'result': 'healthy'}
        elif (health != 'ok' and previous != 'ok' and not escalated
              and now - state.get('lastAcceptedAt', 0) < 3600):
            return {'result': 'suppressed'}
        else:
            target = health
        label = 'TEST' if target == 'test' else 'RECOVERED' if target == 'ok' else 'FAILURE'
        pending = {'key': 'canvas-cn-sync-' + str(uuid.uuid4()), 'condition': target, 'createdAt': now,
                   'body': {'from': config['from'], 'to': [config['to']],
                            'subject': '[Canvas CN] ' + scope + ' sync ' + label,
                            'text': 'Canvas domestic ' + scope + ' synchronization\n'
                                    + 'Status: ' + target + '\n'
                                    + 'Time (UTC): ' + datetime.now(timezone.utc).isoformat() + '\n'
                                    + 'Inspect ' + service + ' and its private monitor.json on the domestic ECS.\n'
                                    + 'This message contains no Project content or credentials.'}}
        state['pending'] = pending
        if target != 'test':
            state.pop('retrySince', None)
        if target == 'ok':
            state.pop('recoverySince', None)
        write_state(state_path, state)
    # Resend retains idempotency keys for 24h. Keep margin and stop ambiguous
    # delivery outside that window until an operator checks the mail log.
    created = pending.get('createdAt')
    if type(created) not in [int, float] or not math.isfinite(created) or not 0 <= now - created < 23 * 3600:
        raise ValueError('uncertain delivery expired; reconcile mail log')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(args.mail_endpoint, data=json.dumps(pending['body']).encode(),
                                    headers={'Authorization': 'Bearer ' + config['apiKey'],
                                             'Content-Type': 'application/json', 'Idempotency-Key': pending['key'],
                                             'User-Agent': 'Analog-Canvas-Sync-Monitor/1'})
    with opener.open(request, timeout=20) as response:
        data = response.read(8193)
        if response.status != 200 or len(data) > 8192:
            raise ValueError('invalid mail response')
    receipt = json.loads(data)
    if not isinstance(receipt.get('id'), str) or not receipt['id']:
        raise ValueError('missing mail receipt')
    if pending['condition'] == 'test':
        state['testAccepted'] = True
        state['testReceipt'] = receipt['id']
    else:
        state['acceptedCondition'] = pending['condition']
        state['lastAcceptedAt'] = now
    state.pop('pending')
    write_state(state_path, state)
    return {'result': 'accepted-by-mail-service', 'condition': pending['condition'], 'id': receipt['id']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['config', 'monitor', 'state']:
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--mail-endpoint', default='https://api.resend.com/emails')
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--scope', choices=['Project', 'Publication', 'Release'], default='Project')
    parser.add_argument('--stale-seconds', type=int, default=120)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args)))
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        print(json.dumps({'result': 'delivery-failed'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
