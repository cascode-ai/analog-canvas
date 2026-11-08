#!/usr/bin/env python3
"""Print a compaction request from a verified, privately restored Gallery directory."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3


def outbound_digest(db, sequence, tables):
    head, = db.execute(
        'SELECT event_id FROM project_sync_outbox WHERE sequence=?', (sequence,),
    ).fetchone()
    for table in ('project_sync_erased', 'project_sync_compacted'):
        if table in tables:
            row = db.execute(f'SELECT hash FROM {table} WHERE head=?', (head,)).fetchone()
            if row:
                return row[0]
    digest = hashlib.sha256()
    chunks = db.execute(
        'SELECT payload FROM project_sync_payloads WHERE head=? ORDER BY chunk', (head,),
    )
    count = 0
    for payload, in chunks:
        digest.update(payload.encode('utf-8') if isinstance(payload, str) else gzip.decompress(payload))
        count += 1
    if not count:
        raise ValueError('The restored outbox has no payload or digest at its tip')
    return digest.hexdigest()


def read_checkpoint(path):
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'project_sync_peer' not in tables:
            return None
        peer = db.execute(
            'SELECT p.origin,p.epoch,p.sequence,r.hash FROM project_sync_peer p '
            'JOIN project_sync_receipts r ON p.sequence=r.sequence',
        ).fetchone()
        if not peer:
            return None
        if db.execute('PRAGMA quick_check').fetchone() != ('ok',):
            raise ValueError('The restored Project store failed integrity checking')
        origin, epoch, sequence = db.execute(
            'SELECT origin,epoch,sequence FROM project_sync_meta',
        ).fetchone()
        peer_origin, peer_epoch, peer_sequence, peer_hash = peer
        if {origin, peer_origin} != {'cn', 'overseas'}:
            raise ValueError('The restored store does not contain the regional Project stream pair')
        return {
            origin: {
                'epoch': epoch, 'sequence': sequence,
                'hash': outbound_digest(db, sequence, tables) if sequence else None,
            },
            peer_origin: {'epoch': peer_epoch, 'sequence': peer_sequence, 'hash': peer_hash},
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gallery_directory', type=Path)
    args = parser.parse_args()
    checkpoints = [
        checkpoint
        for path in args.gallery_directory.resolve().glob('*.sqlite')
        if (checkpoint := read_checkpoint(path)) is not None
    ]
    if len(checkpoints) != 1:
        parser.exit(1, 'Expected exactly one restored Gallery store with regional Project receipts\n')
    print(json.dumps({'checkpoint': checkpoints[0], 'dryRun': True}))


if __name__ == '__main__':
    main()
