"""Private entrance control and a two-pass, stopped-state regional snapshot.

The live seed is NEVER a backup. Only a successful final copy with the sole
writer stopped can be published. Compression happens after service resumes.
"""
import hashlib
import http.client
import json
import os
import pathlib
import re
import shutil
import socket
import stat
import subprocess
import tempfile
import time
from contextlib import closing

CONTROL = '/run/canvas-cn-ingress/control.sock'
BLOCK = 512 * 1024


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


def entrance(action):
    with closing(ControlConnection('localhost', timeout=8)) as connection:
        connection.request('GET' if action == 'status' else 'POST', '/' + action, body=b'')
        response = connection.getresponse()
        body = response.read()
        if response.status != 200:
            raise RuntimeError('entrance-' + action + '-refused')
        return json.loads(body) if body else None


class Snapshot:
    def __init__(self, data=pathlib.Path('/var/lib/analog-canvas-formal'),
                 backups=pathlib.Path('/var/backups/analog-canvas-formal')):
        self.data, self.backups = pathlib.Path(data), pathlib.Path(backups)
        self.stage = None
        self.captured = False
        self.index = {}

    def prepare(self):
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.stage = pathlib.Path(tempfile.mkdtemp(prefix='.incomplete.', dir=self.backups))
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

    def capture(self, release_record):
        self.captured = False
        self.copy(final=True)
        shutil.copyfile(release_record, self.stage / 'release.json')
        self.captured = True

    def publish(self):
        if not self.captured:
            raise RuntimeError('snapshot-not-captured')
        archive = self.stage / 'state.tar.gz'
        with archive.open('wb') as output:
            subprocess.run(['tar', '-czf', '-', '-C', str(self.stage), 'state', 'artifacts'],
                           stdout=output, stderr=subprocess.PIPE, check=True,
                           env=dict(os.environ, GZIP='-1'))
            output.flush()
            os.fsync(output.fileno())
        with archive.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        (self.stage / 'state.sha256').write_text(digest + '  state.tar.gz\n')
        for name in ('state', 'artifacts'):
            shutil.rmtree(self.stage / name)
        destination = self.backups / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + self.stage.name[-8:])
        self.stage.rename(destination)
        self.stage = None
        old = sorted((p for p in self.backups.glob('20*') if p.is_dir()), reverse=True)
        for path in old[20:]:
            shutil.rmtree(path)
        return destination

    def discard(self):
        if self.stage is not None:
            shutil.rmtree(self.stage)
            self.stage = None
