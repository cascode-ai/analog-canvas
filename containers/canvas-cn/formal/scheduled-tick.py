#!/usr/bin/env python3
"""Invoke the runtime's scheduled work once (wrangler.jsonc crons, generated timer)."""
import argparse
import pathlib
import sys
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:8792')
    parser.add_argument('--credentials', required=True)
    args = parser.parse_args()
    token = (pathlib.Path(args.credentials) / 'sync-admin-token').read_text().strip()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(args.origin + '/__regional/scheduled', data=b'', method='POST',
                                     headers={'Authorization': 'Bearer ' + token})
    try:
        with opener.open(request, timeout=270) as response:
            return 0 if response.status == 200 else 1
    except OSError as error:
        # The class only: a body could carry an upstream payload.
        print(type(error).__name__, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
