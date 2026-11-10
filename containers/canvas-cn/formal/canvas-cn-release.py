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
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
_maintenance_spec = importlib.util.spec_from_file_location('canvas_maintenance', pathlib.Path(__file__).with_name('maintenance.py'))
_maintenance = importlib.util.module_from_spec(_maintenance_spec)
_maintenance_spec.loader.exec_module(_maintenance)
Snapshot, entrance = _maintenance.Snapshot, _maintenance.entrance

SHA = re.compile(r'^[0-9a-f]{40}$')
SAFE_PATH = re.compile(r'^(?!.*\.\.)[A-Za-z0-9_@+\-./]+$')
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
TRANSPORT_ORIGIN = 'https://analog-canvas-origin.tokenzhang.com'
ICP_FILING = re.compile(r'[\u3400-\u9fff]ICP备[0-9]+号(?:-[0-9]+)?')
# Written into a release only after it passed its smoke checks while serving.
VERIFIED = '.verified'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReleaseError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Fetcher:
    def __init__(self, origin, timeout=120):
        if not re.match(r'^https://[A-Za-z0-9.-]+$', origin):
            raise ValueError('HTTPS origin required')
        self.origin = origin
        self.timeout = timeout
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path, limit=64 * 1024 * 1024):
        request = urllib.request.Request(self.origin + path, headers={
            'Accept-Encoding': 'identity',
            'User-Agent': 'Analog-Canvas-Regional-Release/1',
        })
        with self.opener.open(request, timeout=self.timeout) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            # A missing release file answers with the editor shell.
            raise ReleaseError('transport-or-invalid-status')
        return data


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


def read_current(fetcher):
    try:
        current = json.loads(fetcher.get('/regional-release/current.json', 4096))
    except ValueError:
        raise ReleaseError('transport-or-invalid-status')
    commit = current.get('commit') if isinstance(current, dict) else None
    if not isinstance(commit, str) or not SHA.match(commit):
        raise ReleaseError('transport-or-invalid-status')
    if current.get('manifest') != f'/regional-release/{commit}/release.json':
        raise ReleaseError('transport-or-invalid-status')
    return current


def verified_overseas(fetcher, current):
    """Only CI writes proof, after its live checks; assets alone are not proof."""
    digest, attempt = current.get('sha256'), current.get('attempt')
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        return False
    if not isinstance(attempt, str) or not re.fullmatch(r'[1-9][0-9]*-[1-9][0-9]*', attempt):
        return False
    try:
        proof = json.loads(fetcher.get(
            f"/api/regional-release/verification/{current['commit']}/{digest}/{attempt}", 4096))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    except ValueError:
        return False
    return isinstance(proof, dict) and proof == {
        'schemaVersion': 1, 'commit': current['commit'], 'sha256': digest,
        'attempt': attempt, 'verified': True}


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


class Host:
    """The privileged operations; replaced in tests."""

    def __init__(self, run=subprocess.run, maintenance_dir=pathlib.Path('/var/lib/canvas-cn-maintenance')):
        self.run = run
        self.snapshot = None
        self.maintenance_dir = pathlib.Path(maintenance_dir)

    def systemctl(self, *args, check=True):
        return self.run(['systemctl', *args], check=check, capture_output=True)

    def active(self, unit):
        return self.systemctl('is-active', '--quiet', unit, check=False).returncode == 0

    def backup(self, release):
        if not pathlib.Path('/run/canvas-cn-ingress/control.sock').is_socket():
            raise ReleaseError('entrance-not-installed')
        if entrance('status')['uncertain']:
            raise ReleaseError('uncertain-write')
        self.snapshot = Snapshot()
        self.snapshot.prepare()

    def hold(self):
        # A timer being stopped does not finish an already running tick.
        deadline = time.monotonic() + 3
        def busy(unit):
            status = self.systemctl('show', unit, '--property=ActiveState', '--value', check=False)
            return status.returncode != 0 or status.stdout.strip() not in (b'inactive', b'failed')
        while any(busy(timer.replace('.timer', '.service')) for timer in SYNC_TIMERS):
            if time.monotonic() >= deadline:
                raise ReleaseError('background-busy')
            time.sleep(.05)
        try:
            entrance('hold')
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
        paused = json.loads(record.read_text())
        if not isinstance(paused, list) or any(timer not in SYNC_TIMERS for timer in paused):
            raise ReleaseError('invalid-paused-timers')
        for timer in paused:
            self.systemctl('start', timer)
        record.unlink()

    def capture(self, serving):
        self.snapshot.capture(serving / 'release.json')

    def resume(self):
        entrance('resume')

    def finish_backup(self):
        self.snapshot.publish()

    def discard_backup(self):
        if self.snapshot and not self.snapshot.captured:
            self.snapshot.discard()

    def recover_entrance(self, local, credentials):
        if not pathlib.Path('/run/canvas-cn-ingress/control.sock').is_socket():
            return
        if not entrance('status')['holding'] and not (self.maintenance_dir / 'paused.json').exists():
            return
        if not self.active('canvas-cn-formal.service'):
            self.systemctl('start', 'canvas-cn-formal.service')
        if not smoke(local, credentials, attempts=3, delay=.1):
            raise ReleaseError('release-failed')
        entrance('resume')
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


def install_units(release, unit_dir, host, changed, added):
    """Copy changed units, recording each before it is written."""
    units = sorted(release.glob('canvas-cn-*.service')) + sorted(release.glob('canvas-cn-*.timer'))
    for unit in (u for u in units if u.is_file()):
        installed = unit_dir / unit.name
        if installed.is_file() and installed.read_bytes() == unit.read_bytes():
            continue
        (changed if installed.is_file() else added).append(unit.name)
        shutil.copyfile(unit, installed)
    if changed or added:
        host.systemctl('daemon-reload')


def smoke(local, credentials, attempts=30, delay=2):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    inbound = (credentials / 'sync-inbound-token').read_text().strip()
    checks = [
        ('/', None, lambda r, b: b'<div id="root"' in b),
        ('/api/agent/mcp-manifest.json', None, lambda r, b: json.loads(b).get('version')),
        ('/api/project-sync/status', inbound, lambda r, b: json.loads(b).get('origin') == 'cn'),
    ]
    for attempt in range(attempts):
        try:
            for path, token, ok in checks:
                headers = {'Authorization': 'Bearer ' + token} if token else {}
                with opener.open(urllib.request.Request(local + path, headers=headers), timeout=20) as response:
                    if response.status != 200 or not ok(response, response.read(1024 * 1024)):
                        raise ValueError(path)
            return True
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(delay)
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


def tick(args, host=None, fetcher=None, now=None):
    host = host or Host()
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
        if smoke(args.local, credentials, attempts=args.smoke_attempts):
            (serving / VERIFIED).write_text('')
            host.recover_entrance(args.local, credentials)
        elif previous and pathlib.Path(previous).is_dir() and pathlib.Path(previous) != serving:
            previous = pathlib.Path(previous)
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
    published = read_current(fetcher)
    commit = published['commit']
    result = {'health': 'ok', 'reason': None, 'serving': installed, 'lastAttemptAt': now}
    if commit == installed:
        return dict(result, status='current', lastCaughtUpAt=now)
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
    saved_units = {p.name: p.read_bytes() for p in unit_dir.glob('canvas-cn-*') if p.is_file()}
    nginx_before = site.read_bytes() if site.exists() else None
    host.pause_background()
    changed, added, operator_restarted = [], [], False
    try:
        try:
            host.backup(target)
        except Exception as error:
            if isinstance(error, ReleaseError) and error.reason == 'uncertain-write':
                return dict(result, health='failed', reason='release-failed', status='uncertain-write')
            # Nothing is switched yet; do not stop the runtime again each minute.
            return dict(result, health='failed', reason='release-failed', status='backup-failed',
                        failedCommit=commit, failedReason='release-failed')
        # Transport failure here is retryable: no release has been switched yet.
        if read_current(fetcher) != published or not verified_overseas(fetcher, published):
            return dict(result, status='source-changed', pending={})
        try:
            host.hold()
        except Exception as error:
            if isinstance(error, ReleaseError) and error.reason == 'uncertain-write':
                return dict(result, health='failed', reason='release-failed', status='uncertain-write')
            return dict(result, status='handover-deferred', pending=pending)
        try:
            # Persisted before switching, so an interrupted runner can roll back.
            save(state_path, dict(state, previous=str(serving), installing=commit))
            host.systemctl('stop', 'canvas-cn-formal.service')
            host.capture(serving)
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
            ok = smoke(args.local, credentials, attempts=args.smoke_attempts)
        except Exception:
            ok = False
        if ok:
            (target / VERIFIED).write_text('')
            host.resume()
            try:
                host.finish_backup()
            except Exception:
                # Code is healthy and accepting writes. Never roll it back for
                # an archive/compression error; keep the captured staging tree.
                return dict(result, health='failed', reason='release-failed',
                            status='archive-failed', serving=commit, previous=str(serving))
            for unit in added:
                if unit in AUTO_TIMERS:
                    host.systemctl('enable', '--now', unit, check=False)
            prune(releases, keep={target, serving}, count=args.keep)
            return dict(result, status='installed', serving=commit, previous=str(serving),
                        downloadedBytes=downloaded, lastCaughtUpAt=now)
        # Restore the serving release exactly: link, units, nginx site, processes.
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
        restored = smoke(args.local, credentials, attempts=args.smoke_attempts)
        if restored:
            host.resume()
        return dict(result, health='failed', reason='release-rolled-back' if restored else 'release-failed',
                    status='rolled-back', failedCommit=commit, failedReason='release-rolled-back')
    finally:
        host.discard_backup()
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
    for key in ['lastCaughtUpAt', 'failedCommit', 'failedReason', 'previous']:
        if key not in result and key in previous:
            result[key] = previous[key]
    save(state_path, result)
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
