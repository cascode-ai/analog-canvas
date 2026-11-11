"""Bounded metric history and anonymous Nginx latency summaries."""
import datetime
import json
import math
from pathlib import Path

CATEGORIES = {'page', 'sync', 'auth', 'projects', 'simulation', 'agent',
              'gallery', 'api-other', 'static'}
HISTOGRAM = [0.1, 0.3, 1, 3, 10, 30, 120]


def http_window(path, now, window=300, limit=2 * 1024 * 1024):
    """Read a bounded tail of current + one rotated log; never persist raw rows."""
    groups = {}
    incomplete = False
    malformed = 0
    found = False
    for candidate in [path.with_name(path.name + '.1'), path]:
        if not candidate.exists():
            continue
        found = True
        with candidate.open('rb') as stream:
            stream.seek(0, 2)
            file_size = stream.tell()
            stream.seek(max(0, file_size - limit))
            if file_size > limit:
                stream.readline()  # Skip partial first row.
            content = stream.read(limit)
        earliest = None
        for line in content.splitlines():
            try:
                row = json.loads(line)
                at, seconds, status, size = row['at'], row['seconds'], row['status'], row['bytes']
                category = row['category']
                if (category not in CATEGORIES or type(status) is not int or not 100 <= status <= 599
                        or type(size) is not int or size < 0
                        or not isinstance(at, (float, int)) or not math.isfinite(at)
                        or not isinstance(seconds, (float, int)) or not math.isfinite(seconds) or seconds < 0):
                    raise ValueError('invalid metric')
                earliest = at if earliest is None else min(at, earliest)
                if not now - window <= at <= now:
                    continue
                g = groups.setdefault(category, {'requests': 0, 'serverErrors': 0,
                    'clientErrors': 0, 'rateLimited': 0, 'bytes': 0,
                    'sumSeconds': 0, 'maxSeconds': 0, 'histogram': [0] * 8})
                g['requests'] += 1
                g['serverErrors'] += status >= 500
                g['clientErrors'] += 400 <= status < 500
                g['rateLimited'] += status == 429
                g['bytes'] += size
                g['sumSeconds'] += seconds
                g['maxSeconds'] = max(g['maxSeconds'], seconds)
                index = next((i for i, boundary in enumerate(HISTOGRAM) if seconds <= boundary), 7)
                g['histogram'][index] += 1
                # Static files have '-', retries can have a list. Do not guess
                # a single backend duration for those multi-attempt responses.
                try:
                    upstream = float(row.get('upstream', '-'))
                    if math.isfinite(upstream) and upstream >= 0:
                        g['upstreamSamples'] = g.get('upstreamSamples', 0) + 1
                        g['upstreamSumSeconds'] = g.get('upstreamSumSeconds', 0) + upstream
                        g['upstreamMaxSeconds'] = max(g.get('upstreamMaxSeconds', 0), upstream)
                except (TypeError, ValueError):
                    pass
            except (ValueError, KeyError, TypeError):
                malformed += 1
        if file_size > limit and (earliest is None or earliest > now - window):
            incomplete = True
    # A partial last line will be read on the next sample; make uncertainty visible.
    for group in groups.values():
        target = math.ceil(group['requests'] * .95)
        total = 0
        for index, count in enumerate(group['histogram']):
            total += count
            if total >= target:
                group['p95UpperSeconds'] = HISTOGRAM[index] if index < 7 else None
                break
        group['averageSeconds'] = group['sumSeconds'] / group['requests']
        if group.get('upstreamSamples'):
            group['upstreamAverageSeconds'] = group['upstreamSumSeconds'] / group['upstreamSamples']
    return {'windowSeconds': window, 'available': found, 'incomplete': incomplete,
            'malformedRows': malformed, 'groups': groups}


def record_history(history, metrics, previous):
    now = metrics['at']
    if now <= history.get('lastAt', 0):
        return history
    bucket_key = str(int(now // 300) * 300)
    # UTC dates are explicit; no attempt to recreate pre-monitoring traffic.
    day_key = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime('%Y-%m-%d')
    buckets = history.setdefault('fiveMinute', {})
    bucket = buckets.setdefault(bucket_key, {'samples': 0, 'sum': {}, 'max': {}})
    bucket['samples'] += 1
    for name in ['cpuPct', 'memoryPct', 'diskPct', 'rxMbps', 'txMbps']:
        if name not in metrics:
            continue
        bucket['sum'][name] = bucket['sum'].get(name, 0) + metrics[name]
        bucket['max'][name] = max(bucket['max'].get(name, 0), metrics[name])
        bucket.setdefault('counts', {})[name] = bucket.get('counts', {}).get(name, 0) + 1
    # HTTP windows overlap: retain latest window rather than adding requests twice.
    if 'http' in metrics:
        bucket['httpWindow'] = metrics['http']
    days = history.setdefault('dailyNetwork', {})
    day = days.setdefault(day_key, {'rxBytesObserved': 0, 'txBytesObserved': 0,
                                   'coveredSeconds': 0, 'gaps': 0})
    elapsed = now - previous.get('at', now)
    safe = (metrics['boot'] == previous.get('boot') and 10 <= elapsed <= 180
            and previous['at'] >= history.get('lastAt', 0)
            and all(metrics[k] >= previous[k] for k in ['rxBytes', 'txBytes']))
    if safe:
        # Split an interval at a UTC midnight in proportion to elapsed time.
        midnight = int(now // 86400) * 86400
        intervals = [(day, elapsed)]
        if previous['at'] < midnight:
            old_day_key = datetime.datetime.fromtimestamp(previous['at'], datetime.timezone.utc).strftime('%Y-%m-%d')
            old_day = days.setdefault(old_day_key, {'rxBytesObserved': 0, 'txBytesObserved': 0,
                                                   'coveredSeconds': 0, 'gaps': 0})
            intervals = [(old_day, midnight - previous['at']), (day, now - midnight)]
        for target, seconds in intervals:
            target['coveredSeconds'] += seconds
            for name in ['rx', 'tx']:
                target[name + 'BytesObserved'] += (metrics[name + 'Bytes'] - previous[name + 'Bytes']) * seconds / elapsed
    else:
        day['gaps'] += 1
    history['fiveMinute'] = {k: v for k, v in buckets.items() if int(k) >= now - 7 * 86400}
    history['dailyNetwork'] = dict(sorted(days.items())[-31:])
    history.update(lastAt=now, billingTraffic=False, timeZone='UTC',
                   note='eth0 includes internal and public IPv4/IPv6 traffic; gaps excluded; midnight split estimated')
    return history
