#!/usr/bin/env python3
"""Install the release Production serves after explicit overseas verification.

Production publishes /regional-release/current.json with every deploy. This
runner follows it: once matching CI proof has stayed live for --settle-seconds,
it downloads only changed files,
checks every SHA-256 and required credential, backs up the stopped state,
switches the release, smoke-tests it and switches back on failure. It never
changes state directories, credentials or switches; a failed install leaves
the previous release serving and reports through its monitor file.
"""
import argparse
import importlib.util
import concurrent.futures
import gzip
import hashlib
import http.client
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

_maintenance_spec = importlib.util.spec_from_file_location('canvas_maintenance', pathlib.Path(__file__).with_name('maintenance.py'))
_maintenance = importlib.util.module_from_spec(_maintenance_spec)
_maintenance_spec.loader.exec_module(_maintenance)
Snapshot, entrance = _maintenance.Snapshot, _maintenance.entrance
_source_spec = importlib.util.spec_from_file_location('canvas_observations', pathlib.Path(__file__).with_name('observations.py'))
_source = importlib.util.module_from_spec(_source_spec)
_source_spec.loader.exec_module(_source)
Fetcher, NoRedirect, ReleaseError = _source.Fetcher, _source.NoRedirect, _source.ReleaseError
TRANSPORT_ORIGIN = _source.TRANSPORT_ORIGIN
read_current, verified_overseas = _source.read_current, _source.verified_overseas

SAFE_PATH = re.compile(r'^(?!.*\.\.)[A-Za-z0-9_@+\-./]+$')
GZIP_BUILD_ASSET = re.compile(r'assets/assets/[\w.-]+-[\w-]{8,}\.(?:js|css)')
SWITCHES = {'project-writes-enabled', 'resource-writes-enabled'}
SYNC_TIMERS = ['canvas-cn-project-sync.timer', 'canvas-cn-resource-sync.timer',
               'canvas-cn-analytics-sync.timer', 'canvas-cn-scheduled.timer']
# Only these timers start by themselves when a release first ships them;
# replication timers stay an operator's decision.
AUTO_TIMERS = {'canvas-cn-scheduled.timer', 'canvas-cn-release.timer',
               'canvas-cn-release-alert.timer', 'canvas-cn-formal-backup.timer'}
NGINX_SITE = '/etc/nginx/conf.d/analog-canvas-formal.conf'
PUBLIC_CONFIG = '/etc/analog-canvas-formal/public.json'
PUBLIC_ORIGIN = 'https://analog-canvas.tokenzhang.com'
UNIT_PATTERNS = ('canvas-cn-*.service', 'canvas-cn-*.timer',
                 'canvas-ops-monitor.service', 'canvas-ops-monitor.timer')
ICP_FILING = re.compile(r'[\u3400-\u9fff]ICP备[0-9]+号(?:-[0-9]+)?')
# Written into a release only after it passed its smoke checks while serving.
VERIFIED = '.verified'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def source_of(manifest, path):
    """The Production path a release file is fetched from (longest prefix).

    A source may name the file as `{path}`; root files carry a suffix there so
    Production's HTML handling cannot redirect them.
    """
    for prefix in sorted(manifest['sources'], key=len, reverse=True):
        if path.startswith(prefix):
            source, rest = manifest['sources'][prefix], path[len(prefix):]
            return source.replace('{path}', rest) if '{path}' in source else source + rest
    raise ReleaseError('release-failed')


def read_manifest(fetcher, current):
    commit = current['commit']
    text = fetcher.get(current['manifest'], 8 * 1024 * 1024)
    if sha256(text) != current.get('sha256'):
        raise ReleaseError('release-failed')
    manifest = json.loads(text)
    if manifest.get('schemaVersion') != 1 or manifest.get('commit') != commit:
        raise ReleaseError('release-failed')
    for path, digest in manifest['files'].items():
        if not SAFE_PATH.match(path) or path.startswith('/') or not re.match(r'^[0-9a-f]{64}$', digest):
            raise ReleaseError('release-failed')
    return commit, manifest, text


def required_credentials(config_text):
    return sorted(set(re.findall(r'embed "/([A-Za-z0-9_.-]+)"', config_text)))


def check_credentials(config_text, credentials):
    for name in required_credentials(config_text):
        path = credentials / name
        if not path.is_file():
            raise ReleaseError('release-failed')
        if name in SWITCHES and path.read_text() not in ('true', 'false'):
            raise ReleaseError('release-failed')


def fetch_verified(fetcher, path, digest, attempts=4, delay=5):
    """One release file; the border link drops reads, so retry with backoff."""
    for attempt in range(1, attempts + 1):
        try:
            data = fetcher.get(path)
            if sha256(data) == digest:
                return data
            error = ReleaseError('release-failed')
        except urllib.error.HTTPError as failure:
            if failure.code < 500 and failure.code != 429:
                raise
            error = failure
        except (OSError, urllib.error.URLError) as failure:
            error = failure
        if attempt < attempts:
            time.sleep(delay * attempt)
    raise error


def assemble(fetcher, manifest, current, target, workers=4):
    """Copy unchanged files from the serving release; download the rest.

    Files already in `target` with the right digest (an earlier interrupted
    attempt) are kept, so a slow link still converges across ticks.
    """
    known = {}
    old = current / 'release.json'
    if old.is_file():
        for path, digest in json.loads(old.read_text()).get('files', {}).items():
            if (current / path).is_file():
                known.setdefault(digest, current / path)

    def place(item):
        path, digest = item
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_file() and sha256(destination.read_bytes()) == digest:
            return 0
        local = known.get(digest)
        if local is not None and sha256(local.read_bytes()) == digest:
            shutil.copyfile(local, destination)
            return 0
        data = fetch_verified(fetcher, source_of(manifest, path), digest)
        temporary = destination.with_name(destination.name + '.part')
        temporary.write_bytes(data)
        os.replace(temporary, destination)
        return len(data)

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        downloaded = sum(pool.map(place, manifest['files'].items()))
    carry_previous_assets(current, target)
    return downloaded


def carry_previous_assets(current, target):
    """Tabs opened on the serving release still load its hashed chunks.

    Only the serving release's own listed assets are carried, so each release
    keeps exactly one release of history and never grows.
    """
    old = current / 'release.json'
    if not old.is_file():
        return
    for path in json.loads(old.read_text()).get('files', {}):
        source, destination = current / path, target / path
        if path.startswith('assets/assets/') and source.is_file() and not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)


def precompress_assets(candidate, files):
    """Stage optional gzip copies beside the verified build assets."""
    sidecars = []
    try:
        with tempfile.TemporaryDirectory(prefix='.asset-gzip-', dir=candidate) as directory:
            pending = pathlib.Path(directory) / 'compressed'
            for path in files:
                name = path + '.gz'
                if not GZIP_BUILD_ASSET.fullmatch(path) or name in files:
                    continue
                source = candidate / path
                raw = source.read_bytes()
                packed = gzip.compress(raw, compresslevel=3, mtime=0)
                if len(packed) >= len(raw):
                    continue
                pending.write_bytes(packed)
                pending.chmod(0o644)
                modified = source.stat().st_mtime_ns
                os.utime(pending, ns=(modified, modified))
                pending.replace(candidate / name)
                sidecars.append(name)
    except OSError:
        print('Regional asset precompression stopped early.')
    return sidecars


def prepare_release_backup(host, candidate, sidecars):
    try:
        host.backup(candidate)
    except _maintenance.BackupHeadroom:
        if not sidecars:
            raise
        for path in sidecars:
            (candidate / path).unlink()
        host.backup(candidate)


class Host:
    """The privileged operations; replaced in tests."""

    def __init__(self, run=subprocess.run, maintenance_dir=pathlib.Path('/var/lib/canvas-cn-maintenance'),
                 current_release=pathlib.Path('/opt/analog-canvas/current-formal'), local='http://127.0.0.1:8792'):
        self.run = run
        self.snapshot = None
        self.maintenance_dir = pathlib.Path(maintenance_dir)
        self.current_release, self.local = current_release, local

    def systemctl(self, *args, check=True):
        return self.run(['systemctl', *args], check=check, capture_output=True)

    def active(self, unit):
        return self.systemctl('is-active', '--quiet', unit, check=False).returncode == 0

    def uncertain_write(self):
        return entrance('status')['uncertain']

    def held_operations(self):
        status = entrance('status')
        return status.get('operationReader'), status.get('operationInventory')

    def seal_operation_inventory(self, pending):
        entrance('seal-project-operations/' + _maintenance.inventory_digest(pending))

    def check_backup_space(self):
        Snapshot().admit_capture()

    def backup(self, release):
        if not pathlib.Path('/run/canvas-cn-ingress/control.sock').is_socket():
            raise ReleaseError('entrance-not-installed')
        if entrance('status')['uncertain']:
            raise ReleaseError('uncertain-write')
        self.snapshot = Snapshot()
        self.snapshot.prepare()

    def hold(self, reader=None):
        # A timer being stopped does not finish an already running tick.
        # Keep serving while a bounded sync tick finishes; the entrance's
        # separate 3-second request drain starts only after this wait.
        deadline = time.monotonic() + 90
        def busy(unit):
            status = self.systemctl('show', unit, '--property=ActiveState', '--value', check=False)
            return status.returncode != 0 or status.stdout.strip() not in (b'inactive', b'failed')
        while any(busy(timer.replace('.timer', '.service')) for timer in SYNC_TIMERS):
            if time.monotonic() >= deadline:
                raise ReleaseError('background-busy')
            time.sleep(.05)
        try:
            entrance('hold-project-operations/' + str(reader) if reader is not None else 'hold')
        except _maintenance.HoldRefused as error:
            if error.reason == 'uncertain-write':
                raise ReleaseError('uncertain-write') from error
            raise
        except RuntimeError:
            if entrance('status')['uncertain']:
                raise ReleaseError('uncertain-write')
            raise

    def pause_background(self):
        directory = self.maintenance_dir
        directory.mkdir(mode=0o700, exist_ok=True)
        paused = [timer for timer in SYNC_TIMERS if self.active(timer)]
        save(directory / 'paused.json', paused)
        for timer in paused:
            self.systemctl('stop', timer)

    def resume_background(self):
        record = self.maintenance_dir / 'paused.json'
        if not record.exists():
            return
        if pathlib.Path(_maintenance.CONTROL).is_socket() and entrance('status').get('operationReader') is not None:
            return
        paused = json.loads(record.read_text())
        if not isinstance(paused, list) or any(timer not in SYNC_TIMERS for timer in paused):
            raise ReleaseError('invalid-paused-timers')
        for timer in paused:
            self.systemctl('start', timer)
        record.unlink()

    def capture(self, serving, pending=None):
        self.snapshot.capture(serving / 'release.json', pending)

    def resume(self):
        required, inventory = self.held_operations()
        if required is None:
            entrance('resume')
            return
        if (type(required) is not int or required not in (0, 1) or
                not operation_reader_ready(self.local, self.current_release, required, inventory)):
            raise ReleaseError('incompatible-project-operation-format')
        entrance('resume-project-operations')

    def cancel_operation_hold(self):
        # The caller still owns the lock and has not stopped or switched any process.
        entrance('resume-project-operations')

    def finish_backup(self):
        self.snapshot.publish()

    def discard_backup(self):
        if self.snapshot and not self.snapshot.captured:
            self.snapshot.discard()

    def recover_entrance(self, local, credentials):
        if not pathlib.Path('/run/canvas-cn-ingress/control.sock').is_socket():
            return
        status = entrance('status')
        if not status['holding'] and not (self.maintenance_dir / 'paused.json').exists():
            return
        required = status.get('operationReader')
        if (required is not None and
                (type(required) is not int or required not in (0, 1) or
                 _maintenance.operation_format(self.current_release)[0] < required)):
            raise ReleaseError('incompatible-project-operation-format')
        if not self.active('canvas-cn-formal.service'):
            self.systemctl('start', 'canvas-cn-formal.service')
        if not smoke(local, credentials):
            raise ReleaseError('release-failed')
        self.resume()
        self.resume_background()

    def nginx_reload(self):
        self.run(['nginx', '-t'], check=True, capture_output=True)
        self.run(['systemctl', 'reload', 'nginx'], check=True, capture_output=True)


def switch(link, target):
    temporary = link.with_name(link.name + '.next')
    if temporary.is_symlink() or temporary.exists():
        temporary.unlink()
    temporary.symlink_to(target)
    os.replace(temporary, link)


def unit_files(directory):
    return sorted(p for pattern in UNIT_PATTERNS for p in directory.glob(pattern) if p.is_file())


def install_units(release, unit_dir, host, changed, added):
    """Copy changed units, recording each before it is written."""
    monitor = release.parent.parent / 'monitor-releases' / release.name
    if (release / 'canvas-ops-monitor.service').is_file():
        monitor.mkdir(parents=True, exist_ok=True)
        for name in ('host_monitor.py', 'observations.py'):
            shutil.copyfile(release / name, monitor / name)
    for unit in unit_files(release):
        installed = unit_dir / unit.name
        contents = unit.read_bytes().replace(b'@RELEASE@', str(monitor.resolve()).encode())
        if installed.is_file() and installed.read_bytes() == contents:
            continue
        (changed if installed.is_file() else added).append(unit.name)
        installed.write_bytes(contents)
    if changed or added:
        host.systemctl('daemon-reload')


def smoke(local, credentials, attempts=30, delay=2, require_memory=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    inbound = (credentials / 'sync-inbound-token').read_text().strip()
    checks = [
        ('/', None, lambda r, b: b'<div id="root"' in b),
        ('/api/agent/mcp-manifest.json', None, lambda r, b: json.loads(b).get('version')),
        ('/api/project-sync/status', inbound, lambda r, b:
         json.loads(b).get('origin') == 'cn' and json.loads(b).get('fenced') is False),
    ]
    if require_memory is None:
        require_memory = pathlib.Path('/opt/analog-canvas/current-formal/memory.mjs').is_file()
    if require_memory:
        checks.append(('/__regional/health', None, lambda r, b: json.loads(b).get('ready') is True))
    # Keep the legacy attempts * delay startup budget, but sample readiness
    # promptly rather than holding healthy requests for a full retry interval.
    # urllib timeouts bound socket operations; late complete bodies still fail.
    deadline = time.monotonic() + attempts * delay
    while time.monotonic() < deadline:
        try:
            for path, token, ok in checks:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                headers = {'Authorization': 'Bearer ' + token} if token else {}
                with opener.open(urllib.request.Request(local + path, headers=headers), timeout=min(20, remaining)) as response:
                    body = response.read(1024 * 1024)
                    if time.monotonic() >= deadline:
                        return False
                    if response.status == 200 and path == '/api/project-sync/status':
                        state = json.loads(body)
                        if state.get('origin') == 'cn' and state.get('fenced') is True:
                            # Restart fencing protects against a restored/rewound store.
                            # Use the ordinary peer protocol; never clear it locally or
                            # require unrelated historical backlog to drain first.
                            admin = (credentials / 'sync-admin-token').read_text().strip()
                            request = urllib.request.Request(local + '/api/project-sync/run',
                                data=b'{}', headers={'Authorization': 'Bearer ' + admin,
                                                    'Content-Type': 'application/json'})
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                return False
                            with opener.open(request, timeout=min(20, remaining)) as reconciliation:
                                reconciliation.read(1024 * 1024)
                            raise ValueError('project-writes-not-ready')
                    if response.status != 200 or not ok(response, body):
                        raise ValueError(path)
            return True
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(min(.1, max(0, deadline - time.monotonic())))
    return False


def save(path, value):
    temporary = path.with_suffix('.next')
    with temporary.open('w', encoding='utf-8') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output)
    os.replace(temporary, path)


def public_settings():
    path = pathlib.Path(PUBLIC_CONFIG)
    return json.loads(path.read_text()) if path.is_file() else None


def nginx_config(release, settings):
    private = (release / 'nginx.conf').read_bytes()
    if not settings:
        return private
    mode, number = settings['mode'], settings['filingNumber']
    if mode not in ('stage', 'open') or (number and not ICP_FILING.fullmatch(number)):
        raise ValueError('Invalid public listener or ICP filing number')
    if mode == 'open' and not number:
        raise ValueError('Public HTTPS requires an ICP filing number')
    template = release / 'nginx-public.conf'
    if not template.is_file():
        # Releases older than the filing feature can still serve privately.
        return private
    public_listeners = ('listen 443 ssl;\n    listen [::]:443 ssl;' if mode == 'open'
                        else 'listen 127.0.0.1:8443 ssl;')
    public = template.read_text(encoding='utf-8')
    return private + b'\n' + (public
        .replace('listen @LISTEN@;', public_listeners)
        .replace('@UPSTREAM_HOST@', '$http_host' if mode == 'open' else 'localhost')
        .replace('@FILING_NUMBER@', number)).encode('utf-8')


def write_nginx_site(path, data):
    temporary = path.with_suffix('.next')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def configure_public(release, mode, number, credentials, host):
    settings = None if mode == 'off' else {'mode': mode, 'filingNumber': number}
    candidate = nginx_config(release, settings)
    if settings and not (release / 'nginx-public.conf').is_file():
        raise ValueError('The serving release has no public listener template')
    if mode == 'open':
        client = json.loads((credentials / 'regional-client.json').read_text())
        if (client.get('clientOrigin') != PUBLIC_ORIGIN or
                client.get('origin') != PUBLIC_ORIGIN or
                client.get('transportOrigin') != TRANSPORT_ORIGIN):
            raise ValueError('Configure the regional public and transport origins first')
    site, config = pathlib.Path(NGINX_SITE), pathlib.Path(PUBLIC_CONFIG)
    previous = site.read_bytes()
    write_nginx_site(site, candidate)
    try:
        host.nginx_reload()
        if settings:
            save(config, settings)
        else:
            config.unlink(missing_ok=True)
    except (OSError, subprocess.CalledProcessError):
        write_nginx_site(site, previous)
        host.nginx_reload()
        raise


def compatible_project_formats(serving, candidate):
    # Bootstrap from a pre-capability release. Once installed, an unknown
    # candidate is as unsafe as an explicitly unreadable one.
    prior = serving / 'project-format.json'
    after = candidate / 'project-format.json'
    if not prior.exists() and not after.exists():
        return True
    def read(path):
        value = json.loads(path.read_bytes())
        if (not isinstance(value, dict) or type(value.get('read')) is not int or
                type(value.get('write')) is not int or not 0 < value['write'] <= value['read']):
            raise ValueError('Invalid Project format capability')
        return value
    if not prior.is_file() or not after.is_file():
        return False
    old = read(prior)
    new = read(after)
    return new['read'] >= old['read'] and old['write'] <= new['write'] <= old['read']


def hold_operations(host, local, serving, candidate):
    old = _maintenance.operation_format(serving)
    new = _maintenance.operation_format(candidate)
    if not (old[0] or new[0]):
        host.hold()
        return None
    host.hold(reader=max(min(old[0], new[0]), old[1], new[1]))
    try:
        pending = _maintenance.project_operations(local, old)
        if _maintenance.required_reader(pending) > new[0]:
            raise ReleaseError('incompatible-project-operation-format')
        host.seal_operation_inventory(pending)
        return pending if old[0] else None
    except Exception as error:
        host.cancel_operation_hold()
        if isinstance(error, ReleaseError):
            raise
        raise ReleaseError('project-operation-proof-unavailable') from error


def operation_reader_ready(local, release, required=0, inventory=None):
    try:
        fmt = _maintenance.operation_format(release)
        if fmt[0] < required:
            return False
        if not fmt[0] and inventory is None:
            # Legacy-only handovers predate managed operation inventories.
            return True
        pending = _maintenance.project_operations(local, fmt)
        return inventory is None or _maintenance.inventory_digest(pending) == inventory
    except (OSError, ValueError, http.client.HTTPException):
        return False


def tick(args, host=None, fetcher=None, now=None):
    host = host or Host(current_release=pathlib.Path(args.current), local=args.local)
    fetcher = fetcher or Fetcher(args.origin)
    now = time.time() if now is None else now
    state_path = pathlib.Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    current = pathlib.Path(args.current)
    serving = current.resolve()
    record = serving / 'release.json'
    installed = json.loads(record.read_text()).get('commit') if record.is_file() else None
    credentials = pathlib.Path(args.credentials)
    site = pathlib.Path(NGINX_SITE)
    # An interrupted runner may have left requests held and the verified old
    # runtime stopped. Resume only after real backend checks, never a fake 200.
    if (serving / VERIFIED).exists():
        host.recover_entrance(args.local, credentials)
    if not (serving / VERIFIED).exists():
        # A runner stopped between switch and smoke left this release unproved.
        previous = state.get('previous')
        journal = state.get('operationReader', 0)
        floor, inventory = host.held_operations()
        if (type(journal) is not int or journal not in (0, 1) or
                floor is not None and (type(floor) is not int or floor not in (0, 1))):
            raise ReleaseError('incompatible-project-operation-format')
        required = max(journal, floor or 0)
        if smoke(args.local, credentials, attempts=args.smoke_attempts,
                 require_memory=(serving / 'memory.mjs').is_file()) and operation_reader_ready(args.local, serving, required, inventory):
            (serving / VERIFIED).write_text('')
            host.recover_entrance(args.local, credentials)
        elif previous and pathlib.Path(previous).is_dir() and pathlib.Path(previous) != serving:
            previous = pathlib.Path(previous)
            if _maintenance.operation_format(previous)[0] < max(required, _maintenance.operation_format(serving)[1]):
                raise ReleaseError('incompatible-project-operation-format')
            restored_site = nginx_config(previous, public_settings())
            if not site.is_file() or site.read_bytes() != restored_site:
                write_nginx_site(site, restored_site)
                host.nginx_reload()
            switch(current, previous)
            host.systemctl('restart', 'canvas-cn-formal.service', check=False)
            host.recover_entrance(args.local, credentials)
            return {'health': 'failed', 'reason': 'release-rolled-back', 'status': 'rolled-back',
                    'serving': None, 'lastAttemptAt': now, 'failedCommit': installed,
                    'failedReason': 'release-rolled-back'}
        else:
            raise ReleaseError('release-failed')
    result = {'health': 'ok', 'reason': None, 'serving': installed, 'lastAttemptAt': now}
    if state.get('archivePending') or state.get('status') == 'archive-failed':
        result['archivePending'] = True
    if host.uncertain_write():
        return dict(result, health='failed', reason='release-failed', status='uncertain-write',
                    lastCaughtUpAt=state.get('lastCaughtUpAt'))
    published = read_current(fetcher)
    commit = published['commit']
    if commit == installed:
        if result.get('archivePending'):
            return dict(result, health='failed', reason='release-failed', status='archive-failed')
        if state.get('health') == 'failed' and not smoke(args.local, credentials,
                attempts=args.smoke_attempts, require_memory=(serving / 'memory.mjs').is_file()):
            return dict(result, health='failed', reason='release-failed', status='runtime-not-ready')
        return dict(result, status='current', lastCaughtUpAt=now)
    # Waiting for another candidate is not recovery from an open incident.
    # Only a confirmed serving version or a successful install closes it.
    if state.get('health') == 'failed':
        result.update(health='failed', reason=state.get('reason', 'release-failed'))
    if state.get('failedCommit') == commit:
        return dict(result, health='failed', reason=state.get('failedReason', 'release-failed'),
                    status='refused', failedCommit=commit, failedReason=state.get('failedReason'))
    identity = {key: published.get(key) for key in ['commit', 'sha256', 'attempt']}
    if not verified_overseas(fetcher, published):
        return dict(result, status='awaiting-verification', pending=identity,
                    lastCaughtUpAt=state.get('lastCaughtUpAt', now))
    pending = state.get('pending') or {}
    if any(pending.get(key) != value for key, value in identity.items()) or 'firstSeen' not in pending:
        pending = dict(identity, firstSeen=now)
    if now - pending['firstSeen'] < args.settle_seconds:
        return dict(result, status='settling', pending=pending, lastCaughtUpAt=state.get('lastCaughtUpAt', now))
    waiting_for_space = dict(result, health='failed', reason='retry', status='backup-headroom', pending=pending)
    try:
        host.check_backup_space()
    except _maintenance.BackupHeadroom:
        return waiting_for_space
    except OSError:
        return dict(result, health='failed', reason='release-failed', status='backup-failed',
                    failedCommit=commit, failedReason='release-failed')
    commit, manifest, text = read_manifest(fetcher, published)
    releases = pathlib.Path(args.releases).resolve()
    target = releases / commit
    # One download directory for every commit: hashed paths are verified by
    # digest, so progress survives both interruption and a newer commit.
    partial = releases / 'incoming.partial'
    if not partial.exists():
        earlier = sorted(releases.glob('*.partial'), key=lambda p: p.stat().st_mtime)
        if earlier:
            earlier[-1].rename(partial)
    partial.mkdir(parents=True, exist_ok=True)
    if partial.is_symlink():
        raise ReleaseError('release-failed')
    for stale in releases.glob('*.partial'):
        if stale != partial:
            shutil.rmtree(stale, ignore_errors=True)
    for path in partial.rglob('*'):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ReleaseError('release-failed')
        if path.is_file() and path.relative_to(partial).as_posix() not in manifest['files']:
            path.unlink()
    downloaded = assemble(fetcher, manifest, serving, partial)
    old_format = _maintenance.operation_format(serving)
    new_format = _maintenance.operation_format(partial, manifest)
    # Readers land first. Both the target and automatic rollback must be able
    # to read what either runtime can write during an interrupted handover.
    if old_format[0] < new_format[1] or new_format[0] < old_format[1]:
        return dict(result, health='failed', reason='release-failed', status='incompatible-project-operation-format',
                    failedCommit=commit, failedReason='release-failed')
    if not compatible_project_formats(serving, partial):
        return dict(result, health='failed', reason='release-failed', status='incompatible-project-format',
                    failedCommit=commit, failedReason='release-failed')
    # A rollback or another deploy while downloading invalidates this candidate.
    if read_current(fetcher) != published or not verified_overseas(fetcher, published):
        return dict(result, status='source-changed', pending={})
    (partial / 'release.json').write_bytes(text)
    check_credentials((partial / 'config.capnp').read_text(), credentials)
    # The service keeps a private umask for its monitor. Only the verified
    # release tree is readable by the unprivileged runtime and nginx.
    for path in partial.rglob('*'):
        path.chmod(0o755 if path.is_dir() else 0o644)
    partial.chmod(0o755)
    if target.exists():
        shutil.rmtree(target)
    partial.rename(target)
    unit_dir = pathlib.Path(args.unit_dir)
    saved_units = {p.name: p.read_bytes() for p in unit_files(unit_dir)}
    nginx_before = site.read_bytes() if site.exists() else None
    changed, added, operator_restarted = [], [], False
    sidecars = []
    try:
        sidecars = precompress_assets(target, manifest['files'])
        try:
            prepare_release_backup(host, target, sidecars)
        except _maintenance.BackupHeadroom:
            return waiting_for_space
        except Exception as error:
            if isinstance(error, ReleaseError) and error.reason == 'uncertain-write':
                return dict(result, health='failed', reason='release-failed', status='uncertain-write')
            # Nothing is switched yet; do not stop the runtime again each minute.
            return dict(result, health='failed', reason='release-failed', status='backup-failed',
                        failedCommit=commit, failedReason='release-failed')
        # Transport failure here is retryable: no release has been switched yet.
        if read_current(fetcher) != published or not verified_overseas(fetcher, published):
            return dict(result, status='source-changed', pending={})
        host.pause_background()
        try:
            operations = hold_operations(host, args.local, serving, target)
        except Exception as error:
            if isinstance(error, ReleaseError) and error.reason == 'uncertain-write':
                return dict(result, health='failed', reason='release-failed', status='uncertain-write')
            if isinstance(error, ReleaseError) and error.reason in ('incompatible-project-operation-format', 'project-operation-proof-unavailable'):
                return dict(result, health='failed', reason='release-failed', status=error.reason)
            return dict(result, status='handover-deferred', pending=pending)
        try:
            # Persisted before switching, so an interrupted runner can roll back.
            required = _maintenance.required_reader(operations or [])
            inventory = _maintenance.inventory_digest(operations or []) if old_format[0] or new_format[0] else None
            save(state_path, dict(state, previous=str(serving), installing=commit, operationReader=required))
            host.systemctl('stop', 'canvas-cn-formal.service')
            host.capture(serving, operations)
            install_units(target, unit_dir, host, changed, added)
            nginx_new = nginx_config(target, public_settings())
            if nginx_new != nginx_before:
                write_nginx_site(site, nginx_new)
                host.nginx_reload()
            switch(current, target)
            if 'canvas-cn-operator.service' in changed:
                operator_restarted = True
                host.systemctl('restart', 'canvas-cn-operator.service')
            host.systemctl('start', 'canvas-cn-formal.service')
            ok = smoke(args.local, credentials, attempts=args.smoke_attempts,
                       require_memory=(target / 'memory.mjs').is_file()) and operation_reader_ready(args.local, target, required, inventory)
        except Exception:
            ok = False
        if ok:
            (target / VERIFIED).write_text('')
            host.resume()
            host.resume_background()
            try:
                host.finish_backup()
            except Exception:
                # Code is healthy and accepting writes. Never roll it back for
                # an archive/compression error; keep the captured staging tree.
                return dict(result, health='failed', reason='release-failed',
                            status='archive-failed', archivePending=True,
                            serving=commit, previous=str(serving))
            for unit in added:
                if unit in AUTO_TIMERS:
                    host.systemctl('enable', '--now', unit, check=False)
            prune(releases, keep={target, serving}, count=args.keep)
            monitors = releases.parent / 'monitor-releases'
            if (target / 'canvas-ops-monitor.service').is_file() and monitors.is_dir():
                prune(monitors, keep={monitors / commit}, count=2)
            return dict(result, health='ok', reason=None, archivePending=False,
                        status='installed', serving=commit, previous=str(serving),
                        downloadedBytes=downloaded, lastCaughtUpAt=now)
        # Restore the serving release exactly: link, units, nginx site, processes.
        if _maintenance.operation_format(serving)[0] < max(required, new_format[1]):
            raise ReleaseError('incompatible-project-operation-format')
        host.systemctl('stop', 'canvas-cn-formal.service', check=False)
        switch(current, serving)
        for name in changed + added:
            if name not in saved_units:
                (unit_dir / name).unlink(missing_ok=True)
        for name, data in saved_units.items():
            (unit_dir / name).write_bytes(data)
        host.systemctl('daemon-reload', check=False)
        if site.exists() and site.read_bytes() != nginx_before:
            if nginx_before is None:
                site.unlink()
            else:
                write_nginx_site(site, nginx_before)
            try:
                host.nginx_reload()
            except Exception:
                pass
        if operator_restarted:
            host.systemctl('restart', 'canvas-cn-operator.service', check=False)
        host.systemctl('restart', 'canvas-cn-formal.service', check=False)
        restored = smoke(args.local, credentials, attempts=args.smoke_attempts,
                         require_memory=(serving / 'memory.mjs').is_file()) and operation_reader_ready(args.local, serving, required, inventory)
        if restored:
            host.resume()
        return dict(result, health='failed', reason='release-rolled-back' if restored else 'release-failed',
                    status='rolled-back', failedCommit=commit, failedReason='release-rolled-back')
    finally:
        try:
            if sidecars and current.resolve() != target:
                for path in sidecars:
                    (target / path).unlink(missing_ok=True)
        finally:
            try:
                host.discard_backup()
            finally:
                host.resume_background()


def prune(releases, keep, count):
    keep = {p.resolve() for p in keep}
    candidates = sorted((p for p in releases.iterdir() if p.is_dir() and p.resolve() not in keep
                         and not p.name.endswith('.partial')), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in candidates[max(count - len(keep), 0):]:
        shutil.rmtree(old, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='https://analog-canvas-origin.tokenzhang.com')
    parser.add_argument('--local', default='http://127.0.0.1:8792')
    parser.add_argument('--current', default='/opt/analog-canvas/current-formal')
    parser.add_argument('--releases', default='/opt/analog-canvas/formal-releases')
    parser.add_argument('--credentials', default='/etc/analog-canvas-formal')
    parser.add_argument('--unit-dir', default='/etc/systemd/system')
    parser.add_argument('--state', default='/var/lib/canvas-cn-release/monitor.json')
    parser.add_argument('--public-mode', choices=('stage', 'open', 'off'))
    parser.add_argument('--filing-number', default='')
    parser.add_argument('--settle-seconds', type=int, default=120)
    parser.add_argument('--smoke-attempts', type=int, default=30)
    parser.add_argument('--keep', type=int, default=10)
    args = parser.parse_args()
    if args.public_mode:
        try:
            configure_public(pathlib.Path(args.current).resolve(), args.public_mode,
                             args.filing_number, pathlib.Path(args.credentials), Host())
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            parser.exit(1, f'Public listener configuration failed: {error}\n')
        return 0
    state_path = pathlib.Path(args.state)
    previous = {}
    try:
        previous = json.loads(state_path.read_text()) if state_path.exists() else {}
    except (OSError, ValueError):
        pass
    try:
        result = tick(args)
    except ReleaseError as error:
        result = {'health': 'failed', 'reason': error.reason, 'lastAttemptAt': time.time()}
    except (OSError, ValueError, TypeError, KeyError, subprocess.CalledProcessError, urllib.error.URLError):
        # Bodies and paths may contain upstream payloads; report the class only.
        result = {'health': 'failed', 'reason': 'transport-or-invalid-status', 'lastAttemptAt': time.time()}
    # Only an uninterrupted observation may carry its settling clock forward.
    if previous.get('status') == 'archive-failed':
        previous['archivePending'] = True
    for key in ['lastCaughtUpAt', 'failedCommit', 'failedReason', 'previous', 'archivePending']:
        if key not in result and key in previous:
            result[key] = previous[key]
    if 'status' not in result and state_path.exists():
        # The interrupted attempt can have saved a newer journal inside tick().
        try:
            journal = json.loads(state_path.read_text())
        except (OSError, ValueError):
            journal = previous
        if journal.get('installing'):
            for field in ('installing', 'operationReader', 'previous'):
                if field in journal:
                    result[field] = journal[field]
    save(state_path, result)
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
