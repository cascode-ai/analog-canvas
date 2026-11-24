"""Run up to three normal, fully locked backup attempts in the existing daily oneshot."""
import pathlib
import subprocess
import sys
import time


def scheduled(script=pathlib.Path(__file__).with_name('formal-backup.sh'),
              lock='/run/lock/canvas-cn-formal-release.lock'):
    # The unit's 96 minutes leave a full 30-minute attempt plus six minutes of
    # margin when the last retry starts at the one-hour cutoff. Never enter
    # maintenance on a budget consumed by an earlier attempt or lock wait.
    latest_retry = time.monotonic() + 3600
    for delay in (0, 60, 180):
        if delay:
            print(f'Daily backup will retry after {delay} seconds.', flush=True)
            time.sleep(delay)
            if time.monotonic() >= latest_retry:
                print('Daily backup failed: insufficient time for another full attempt.', file=sys.stderr)
                return 1
        # Re-resolve the current release under the release lock after each delay.
        status = subprocess.run(['/usr/bin/flock', '-w', '900', lock, '/usr/bin/bash', script]).returncode
        if status != 42:  # Reserved solely for a proved clean read drain.
            return status if status >= 0 else 1
    print('Daily backup failed: busy-drain persisted after three attempts.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(scheduled())
