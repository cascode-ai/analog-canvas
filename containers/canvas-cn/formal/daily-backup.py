"""Daily backup through the same bounded, single-writer handover as releases."""
import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location('release', pathlib.Path(__file__).with_name('canvas-cn-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def daily(host=None, serving=pathlib.Path('/opt/analog-canvas/current-formal')):
    host = host or release.Host()
    serving = serving.resolve()
    credentials = pathlib.Path('/etc/analog-canvas-formal')
    held, stopped = False, False
    try:
        host.recover_entrance('http://127.0.0.1:8792', credentials)
        host.backup(serving)
        host.pause_background()
        operations = release.hold_operations(host, 'http://127.0.0.1:8792', serving, serving)
        inventory = release._maintenance.inventory_digest(operations) if operations is not None else None
        held = True
        stopped = True
        host.systemctl('stop', 'canvas-cn-formal.service')
        host.capture(serving, operations)
        host.systemctl('start', 'canvas-cn-formal.service')
        stopped = False
        required = release._maintenance.required_reader(operations or [])
        if (not release.smoke('http://127.0.0.1:8792', credentials) or
                not release.operation_reader_ready('http://127.0.0.1:8792', serving, required, inventory)):
            raise RuntimeError('backup-runtime-not-ready')
        host.resume()
        held = False
        host.resume_background()
        host.finish_backup()
    finally:
        try:
            if stopped:
                host.systemctl('start', 'canvas-cn-formal.service')
            if (held and release.smoke('http://127.0.0.1:8792', credentials) and
                    release.operation_reader_ready('http://127.0.0.1:8792', serving,
                                                   release._maintenance.required_reader(operations or []), inventory)):
                host.resume()
        finally:
            try:
                host.discard_backup()
            finally:
                host.resume_background()


if __name__ == '__main__':
    daily()
