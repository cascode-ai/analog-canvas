"""Private entrance control and a two-pass, stopped-state regional snapshot.

The live seed is NEVER a backup. Only a successful final copy with the sole
writer stopped can be published. Compression happens after service resumes.
"""
import datetime
import errno
import hashlib
import http.client
import json
import os
import pathlib
import re
import secrets
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import tarfile
import urllib.parse
from contextlib import closing

CONTROL = '/run/canvas-cn-ingress/control.sock'
DISK_RESERVE = 1024**3
BLOCK = 512 * 1024
OPERATION_FORMAT = 'project-create-operation-format.json'
ARCHIVED_OPERATIONS = 'project-operation-recovery.json'


def operation_format(release, manifest=None):
    """Capabilities are part of the SHA-verified release, including the rollback reader."""
    if manifest is None:
        manifest = json.loads((release / 'release.json').read_bytes())
    if not isinstance(manifest, dict) or not isinstance(manifest.get('files'), dict):
        raise ValueError('invalid-operation-release-manifest')
    files = manifest['files']
    path = release / OPERATION_FORMAT
    if OPERATION_FORMAT not in files and not path.exists() and not path.is_symlink():
        return (0, 0)
    expected = operation_declaration_digest(files)
    if path.is_symlink() or not path.is_file():
        raise ValueError('project-operation-format-missing')
    return read_operation_format(path.read_bytes(), expected)


def operation_declaration_digest(files):
    value = files.get(OPERATION_FORMAT)
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('invalid-operation-declaration-digest')
    return value


def read_operation_format(raw, expected):
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('project-operation-format-digest')
    value = json.loads(raw)
    if (not isinstance(value, dict) or type(value.get('read')) is not int or
            value['read'] != 1 or type(value.get('write')) is not int or value['write'] not in (0, 1)):
        raise ValueError('unsupported-project-operation-format')
    return value['read'], value['write']


def pending_formats(value, fmt):
    if (not isinstance(value, dict) or type(value.get('version')) is not int or value['version'] != 2 or
            value.get('operationVersions') != [fmt[0]] or type(value['operationVersions'][0]) is not int or
            type(value.get('writeVersion')) is not int or
            value['writeVersion'] != fmt[1] or not isinstance(value.get('pending'), list)):
        raise ValueError('project-operation-capability-mismatch')
    pending = value['pending']
    seen = set()
    for row in pending:
        if (not isinstance(row, dict) or any(type(row.get(key)) is not int for key in
                ('operationVersion', 'count', 'blocked')) or row['count'] < 1 or
                not 0 <= row['blocked'] <= row['count'] or not 0 < row['operationVersion'] <= fmt[0] or
                row['operationVersion'] in seen):
            raise ValueError('unreadable-pending-project-operation')
        seen.add(row['operationVersion'])
    return pending


def project_operations(local, fmt):
    url = urllib.parse.urlsplit(local)
    if url.scheme != 'http' or url.hostname != '127.0.0.1':
        raise ValueError('project-operation-control-requires-loopback')
    def probe(request):
        with closing(http.client.HTTPConnection('127.0.0.1', url.port, timeout=3)) as conn:
            conn.request('POST', '/__regional/project-create-receipt', json.dumps(request),
                         {'Content-Type': 'application/json'})
            reply = conn.getresponse()
            body = reply.read(4097)
            if len(body) > 4096:
                raise ValueError('project-operation-capabilities-unavailable')
            return reply.status, body
    status, body = probe({'action': 'capabilities'})
    if not fmt[0] and status == 400 and not body:
        # V1 knows no operation inventory. Require its exact receipt handshake
        # on a fresh, permanently too-old-to-register ticket before accepting that fact.
        ticket = '0' * 12 + secrets.token_hex(26)
        status, body = probe({'action': 'settle', 'ticket': ticket})
        result = json.loads(body) if status == 200 else None
        if (isinstance(result, dict) and type(result.get('version')) is int and
                result == {'version': 1, 'ticket': ticket, 'state': 'unknown'}):
            return []
        raise ValueError('project-operation-legacy-reader-mismatch')
    if not fmt[0] or status != 200:
        raise ValueError('project-operation-capabilities-unavailable')
    return pending_formats(json.loads(body), fmt)


def required_reader(pending):
    return max((row['operationVersion'] for row in pending), default=0)


def inventory_digest(pending):
    rows = sorted((row['operationVersion'], row['count'], row['blocked']) for row in pending)
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def seed_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_ctime_ns)


def seed_blocks(stage):
    """Index the private seed while the application can still serve traffic."""
    indexed = {}
    for path in (stage / 'state').glob('*/*.sqlite'):
        name = path.relative_to(stage).as_posix()
        # An exact rsync filter can safely name these regular workerd databases.
        if not re.fullmatch(r'state/[\w-]+/[0-9a-f]{64}\.sqlite', name, re.ASCII):
            continue
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_size < 8 * 1024**2
                or path.parent.is_symlink() or (stage / 'state').is_symlink()):
            continue
        with path.open('rb') as source:
            indexed[name] = (seed_identity(info), [
                hashlib.sha256(chunk).digest() for chunk in iter(lambda: source.read(BLOCK), b'')])
    return indexed


def reconcile_database(source, target, index):
    """Check every stopped byte. Only differing blocks need new disk writes."""
    if (source.parent.is_symlink() or source.parent.parent.is_symlink()
            or not source.is_file() or source.is_symlink() or not target.is_file()
            or seed_identity(target.lstat()) != index[0]):
        return False
    with source.open('rb') as reader, target.open('r+b') as writer:
        info = os.fstat(reader.fileno())
        for number, chunk in enumerate(iter(lambda: reader.read(BLOCK), b'')):
            if number >= len(index[1]) or hashlib.sha256(chunk).digest() != index[1][number]:
                writer.seek(number * BLOCK)
                writer.write(chunk)
        if info.st_size != index[0][2]:
            writer.truncate(info.st_size)
        writer.flush()
        old = os.fstat(writer.fileno())
        if (old.st_uid, old.st_gid) != (info.st_uid, info.st_gid):
            os.fchown(writer.fileno(), info.st_uid, info.st_gid)
        os.fchmod(writer.fileno(), stat.S_IMODE(info.st_mode))
    os.utime(target, ns=(info.st_atime_ns, info.st_mtime_ns))
    return True


class ControlConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(CONTROL)


class HoldRefused(RuntimeError):
    def __init__(self, reason):
        super().__init__('entrance-hold-refused: ' + reason)
        self.reason = reason


def entrance(action):
    with closing(ControlConnection('localhost', timeout=8)) as connection:
        connection.request('GET' if action == 'status' else 'POST', '/' + action, body=b'')
        response = connection.getresponse()
        if response.status != 200:
            if (action in ('hold', 'hold-project-operations/0', 'hold-project-operations/1') and
                    response.status in (409, 503) and response.getheader('Content-Type') == 'application/json'):
                try:
                    raw = response.read(257)
                    body = json.loads(raw) if len(raw) <= 256 else None
                except (UnicodeError, ValueError):
                    body = None
                if (isinstance(body, dict) and set(body) == {'version','reason'} and
                        type(body['version']) is int and body['version'] == 1 and isinstance(body['reason'], str) and
                        body['reason'] in ('busy-drain','active-write','uncertain-write','storage-error',
                                           'already-held','incompatible-control') and
                        (response.status == 409 or body['reason'] == 'storage-error')):
                    raise HoldRefused(body['reason'])
            raise RuntimeError('entrance-' + action + '-refused')
        body = response.read()
        return json.loads(body) if body else None


def prune_archives(backups):
    """Select only completed formal archives; a drill receipt enables shorter retention."""
    rows = []
    for path in sorted(backups.glob('20*'), reverse=True):
        if path.is_symlink() or not path.is_dir():
            continue
        if not re.fullmatch(r'\d{8}T\d{6}Z(?:-[a-zA-Z0-9_-]+)?', path.name):
            continue
        try:
            stamp = datetime.datetime.strptime(path.name[:16], '%Y%m%dT%H%M%SZ')
            files = [path / name for name in ('release.json', 'state.sha256', 'state.tar.gz')]
            if any(f.is_symlink() or not f.is_file() for f in files) or files[2].stat().st_size == 0:
                continue
            commit = json.loads(files[0].read_text())['commit']
            digest, filename = files[1].read_text().strip().split()
            if (not isinstance(commit, str) or not re.fullmatch('[0-9a-f]{40}', commit)
                    or not re.fullmatch('[0-9a-f]{64}', digest) or filename != 'state.tar.gz'):
                continue
        except (OSError, ValueError, KeyError, TypeError):
            continue
        day = (stamp + datetime.timedelta(hours=8)).date()
        rows.append((path, day, commit, digest))

    keep = set()
    days, releases = set(), set()
    for path, day, commit, _ in rows:
        if day not in days and len(days) < 7:
            keep.add(path)
            days.add(day)
        if commit not in releases and len(releases) < 3:
            keep.add(path)
            releases.add(commit)
    try:
        receipt = json.loads((backups / 'offsite-restore.json').read_text())
    except (OSError, ValueError):
        receipt = None
    proof = None
    if isinstance(receipt, dict) and receipt.get('verified') is True:
        proof = next((path for path, day, _, digest in rows
                      if path.name == receipt.get('archive') and digest == receipt.get('sha256')
                      and (rows[0][1] - day).days < 7), None)
    if proof is None:
        keep.update(path for path, *_ in rows[:20])
    else:
        keep.add(proof)
    for path, *_ in rows:
        if path not in keep:
            shutil.rmtree(path)


class BackupHeadroom(RuntimeError):
    """The backup seed has not started and can be retried when disk space returns."""


def _process_inode():
    try:
        return pathlib.Path('/proc/self').stat().st_ino
    except FileNotFoundError:
        return None


def check_capture_space(data, backups, *, preparing=True):
    # rsync materializes sparse files and hard links. Count each directory
    # entry's apparent size without reading live database contents.
    def apparent_size(path):
        try:
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                return info.st_size + sum(apparent_size(child) for child in path.iterdir())
            return info.st_size
        except FileNotFoundError:
            return 0  # A live WAL or temporary asset disappeared during measurement.

    seed = sum(apparent_size(data / name) for name in ('state', 'artifacts'))
    recent = sorted(backups.glob('20*/state.tar.gz'), reverse=True)[:3]
    archive = max((p.stat().st_size for p in recent), default=seed)
    required = seed + archive * 5 // 4 + DISK_RESERVE
    if preparing:
        temp = backups / '.capacity.next'
        temp.write_text(json.dumps({'requiredBytes': required, 'pid': os.getpid(),
                                    'processInode': _process_inode()}))
        temp.replace(backups / 'capacity.json')
    if shutil.disk_usage(backups).free < required:
        raise BackupHeadroom('backup-headroom')


class Snapshot:
    def __init__(self, data=pathlib.Path('/var/lib/analog-canvas-formal'),
                 backups=pathlib.Path('/var/backups/analog-canvas-formal')):
        self.data, self.backups = pathlib.Path(data), pathlib.Path(backups)
        self.stage = None
        self.captured = False
        self.index = {}

    def admit_capture(self, *, create_stage=False):
        try:
            self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
            check_capture_space(self.data, self.backups, preparing=create_stage)
            if create_stage:
                self.stage = pathlib.Path(tempfile.mkdtemp(prefix='.incomplete.', dir=self.backups))
        except OSError as error:
            if error.errno == errno.ENOSPC:
                raise BackupHeadroom('backup-headroom') from error
            raise

    def prepare(self):
        self.admit_capture(create_stage=True)
        # Files may vanish while the application is writing the seed. A final
        # checksum pass after shutdown must succeed without this exception.
        self.copy(final=False)
        self.index = seed_blocks(self.stage)

    def copy(self, final):
        args = ['rsync', '-a', '--delete']
        if final:
            args.append('--checksum')
            for name, index in self.index.items():
                if reconcile_database(self.data / name, self.stage / name, index):
                    args.append('--exclude=/' + name)
        args += [str(self.data / name) for name in ('state', 'artifacts')]
        result = subprocess.run(args + [str(self.stage) + '/'], capture_output=True)
        if result.returncode not in ((0,) if final else (0, 24)):
            raise RuntimeError('snapshot-copy-failed')

    def capture(self, release_record, pending=None):
        self.captured = False
        self.copy(final=True)
        shutil.copyfile(release_record, self.stage / 'release.json')
        fmt = operation_format(release_record.parent)
        if fmt[0]:
            # The control-plane inventory was read with dispatch held and
            # background writers drained. The final copy covers the same
            # SQLite state, including immutable request inputs and receipts.
            if pending is None:
                raise ValueError('missing-project-operation-inventory')
            value = {'version': 2, 'operationVersions': [fmt[0]], 'writeVersion': fmt[1], 'pending': pending}
            pending_formats(value, fmt)
            value['releaseSha256'] = hashlib.sha256(release_record.read_bytes()).hexdigest()
            shutil.copyfile(release_record.parent / OPERATION_FORMAT, self.stage / OPERATION_FORMAT)
            (self.stage / ARCHIVED_OPERATIONS).write_text(json.dumps(value))
        self.captured = True

    def publish(self):
        if not self.captured:
            raise RuntimeError('snapshot-not-captured')
        archive = self.stage / 'state.tar.gz'
        # Compress after resuming the writer. New images can compress much less
        # than the forecast, and serving traffic can also consume free space.
        members = ['state', 'artifacts']
        if (self.stage / ARCHIVED_OPERATIONS).exists():
            members.extend([OPERATION_FORMAT, ARCHIVED_OPERATIONS])
        try:
            with archive.open('wb') as output, subprocess.Popen(
                ['tar', '-czf', '-', '-C', str(self.stage), *members],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=dict(os.environ, GZIP='-1'),
            ) as tar, tar.stdout:
                while chunk := tar.stdout.read(8 * 1024**2):
                    if shutil.disk_usage(self.stage).free < DISK_RESERVE + len(chunk):
                        raise RuntimeError('backup-headroom')
                    output.write(chunk)
                if tar.wait() != 0:
                    raise RuntimeError('snapshot-compression-failed')
                output.flush()
                os.fsync(output.fileno())
        except BaseException:
            archive.unlink(missing_ok=True)
            raise
        with archive.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        (self.stage / 'state.sha256').write_text(digest + '  state.tar.gz\n')
        for name in ('state', 'artifacts'):
            shutil.rmtree(self.stage / name)
        destination = self.backups / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + self.stage.name[-8:])
        self.stage.rename(destination)
        self.stage = None
        prune_archives(self.backups)
        return destination


    def discard(self):
        if self.stage is not None:
            shutil.rmtree(self.stage)
            self.stage = None


def verify_operation_restore(archive, reader, local=None):
    """Read-only preflight before extracting, then optionally check the isolated restored runtime."""
    fmt = operation_format(reader)
    manifest = (archive / 'release.json').read_bytes()
    files = json.loads(manifest).get('files')
    if not isinstance(files, dict):
        raise ValueError('invalid-operation-release-manifest')
    expected = operation_declaration_digest(files) if OPERATION_FORMAT in files else None
    checksum, filename = (archive / 'state.sha256').read_text().split()
    if filename != 'state.tar.gz' or not re.fullmatch('[a-f0-9]{64}', checksum):
        raise ValueError('invalid-backup-checksum')
    with (archive / filename).open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != checksum:
            raise ValueError('backup-checksum-mismatch')
        source.seek(0)
        proof = {}
        with tarfile.open(fileobj=source, mode='r|gz') as bundle:
            for item in bundle:
                if item.name in (ARCHIVED_OPERATIONS, OPERATION_FORMAT):
                    if item.name in proof or not item.isfile() or not 0 < item.size <= 8192:
                        raise ValueError('invalid-archived-operation-proof')
                    proof[item.name] = bundle.extractfile(item).read()
    if expected is None and not proof:
        if local and project_operations(local, fmt):
            raise ValueError('restored-project-operation-inventory-mismatch')
        return []
    if set(proof) != {OPERATION_FORMAT, ARCHIVED_OPERATIONS}:
        raise ValueError('missing-archived-operation-proof')
    source_format = read_operation_format(proof[OPERATION_FORMAT], expected)
    archived = json.loads(proof[ARCHIVED_OPERATIONS])
    if archived.get('releaseSha256') != hashlib.sha256(manifest).hexdigest():
        raise ValueError('backup-release-mismatch')
    pending = pending_formats(archived, source_format)
    if fmt[0] < max(source_format[1], required_reader(pending)):
        raise ValueError('incompatible-restore-reader')
    if local and project_operations(local, fmt) != pending:
        raise ValueError('restored-project-operation-inventory-mismatch')
    return pending

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Verify a formal backup against its proposed restore reader.')
    parser.add_argument('--verify-restore', type=pathlib.Path, required=True)
    parser.add_argument('--reader', type=pathlib.Path, required=True)
    parser.add_argument('--isolated-url')
    options = parser.parse_args()
    print(json.dumps({'pending': verify_operation_restore(options.verify_restore, options.reader, options.isolated_url)}))
