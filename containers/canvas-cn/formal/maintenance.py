"""Private entrance control and a two-pass, stopped-state regional snapshot.

The live seed is NEVER a backup. Only a successful final copy with the sole
writer stopped can be published. Compression happens after service resumes.
"""
import hashlib
import http.client
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
from contextlib import closing

CONTROL = '/run/canvas-cn-ingress/control.sock'


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

    def prepare(self):
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.stage = pathlib.Path(tempfile.mkdtemp(prefix='.incomplete.', dir=self.backups))
        # Files may vanish while the application is writing the seed. A final
        # checksum pass after shutdown must succeed without this exception.
        self.copy(final=False)

    def copy(self, final):
        args = ['rsync', '-a', '--delete']
        if final:
            args.append('--checksum')
        args += [str(self.data / name) for name in ('state', 'artifacts')]
        result = subprocess.run(args + [str(self.stage) + '/'], capture_output=True)
        if result.returncode not in ((0,) if final else (0, 24)):
            raise RuntimeError('snapshot-copy-failed')

    def capture(self, release_record):
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
