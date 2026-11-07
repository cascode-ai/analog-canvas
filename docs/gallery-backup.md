# Gallery off-site backups

The private `cascode-ai/analog-canvas-backups` repository owns the backup
collector, its tests, schedule (weekly, plus manual dispatch) and recovery
instructions. Snapshots are date-stamped private Release attachments, never overwritten;
each run keeps only the two newest Releases of its kind and deletes older ones. `cascode-ai` members can read
them (they contain submitter emails and sign-in methods; store snapshots also
every private Cloud Project); only the Owner changes the repository or starts
its workflows.

## Credentials

- `GALLERY_BACKUP_TOKEN` (read-only) lives in this repository's
  `cloudflare-production` environment and the backups repository's Actions
  secrets; deployment syncs it to the Worker. Rotate by updating both and
  deploying; never commit or print it. It allows member Gallery reads,
  `GET /api/gallery/maintenance/automated-backup?table=…` pages and the netlist
  read below; no admin session, writes, restore or private Cloud Projects.
  A person or script reading the Gallery uses a read key
  ([reader access](specs/community-gallery.md#reader-access)), never this one.
- `STORE_BACKUP_TOKEN`, stored and rotated the same way, reads only
  `automated-backup?scope=store` pages.

## Reviews capture

`automated-backup?scope=reviews` (the Gallery credential) reads a store's
[reviews](specs/community-gallery.md#reviews), fixes and reference images:
`entryReviews`, `entryFixes`, `entryReferences`. `&source=<key>` reads a
dataset's store instead of the community one; `source` with another scope is
400 `invalid-source`. The scope has its own revision and change index, so a
review restarts no Gallery capture. The weekly run captures it for the
community and each dataset with comparisons, beside the Gallery archive.
`schema-restore` does not restore it; recover rows from the offline archive.

## Gallery capture

Each capture holds every Gallery row (all statuses, versions, likes, project
text, previews, moderation, private
[testbenches](specs/community-gallery.md#testbench-privacy) and
[simulation checks](specs/community-gallery.md#simulation-checks)) plus the
SQLite definitions. Changed-key reconciliation follows the protocol below;
the archive is rebuilt and read back in SQLite before publishing. Accounts, analytics, the
component catalog and private Cloud Projects are outside it.

## Consistent capture protocol

The read-only backup endpoint retains one-row pages and existing credentials.
`table=inventory` also returns `changeCursor: {epoch, revision}`. Normal writes
maintain a scope-specific index of changed keys, including deleted keys; it
contains no Project contents and does not alter business rows.

After paging the full scope, read a new inventory. When revisions differ,
request `table=changes&after=JSON({epoch,since,until})` using the first and new
cursor revisions. Follow opaque `nextCursor` values until null; each page holds
at most 256 `{table,key}` entries. Re-read each with `table=…&key=JSON(key)`:
one row replaces that key locally; zero rows removes it. Keys changed again
while paging may move to a later revision and are reconciled in the next round.

Publish only after the final inventory matches the reconciled target's epoch,
revision, legacy `snapshotRevision`, schema and counts, and table counts,
identity uniqueness, references and offline restore pass. Reconcile again if
the fence moves. A restart or cursor older than 100,000 retained mutation
revisions returns 409 and requires full recapture; malformed cursors return 400.
Across each reconciliation interval, the numeric suffix of `snapshotRevision`
and the index revision must advance by the same mutation count; their initial
values may differ. A mismatch requires recapture. Preserve normal writes
throughout capture.

Collectors without this capability retain the original before/after revision
check. The private backup repository owns bounded retries and reconciliation.

## Local snapshots

`node scripts/gallery-private-snapshot.mjs` captures the Gallery, waits for the
verified Release and downloads it under
`~/Library/Application Support/Analog Canvas/gallery/` (`--cached`: latest
existing Release; `--directory PATH`: another 0700 destination). `--store`
does the same for the whole store, Gallery plus every private Cloud Project,
which is backed up only this way. It uses the GitHub CLI login, never a token,
never overwrites a capture, and keeps the two newest verified snapshots (older
ones go to the macOS Trash). Administrators can read store pages in the browser
from `GET /api/gallery/maintenance/schema-backup?table=…`.

## Reading netlists from another machine

```bash
curl -H "Authorization: Bearer $GALLERY_BACKUP_TOKEN" \
  "https://analog-canvas.tokenzhang.com/api/gallery/maintenance/netlists?format=spice"
```

Pages hold up to 100 public entries (`limit` ≤ 200); pass `nextCursor` as
`after` until `null`. `format=spectre` and `id=<entry>` are supported; blocked
exports carry `netlist: null` with diagnostics. Administrators can open the URL
signed in, without the token. Fields:
[Gallery specification](specs/community-gallery.md#administration).

## Recovery

Follow the Release archive's README. Inspect rows offline first, keep original
IDs, history and likes, and take a new live backup before any administrator
write. **Never feed a Gallery-only snapshot to `schema-restore`**: it also
replaces private Cloud Projects. Within 30 days use
[point-in-time recovery](deployment.md#point-in-time-recovery). Investigate any
failed or missing run; keep local copies as a second destination.

## Tools on snapshots

- `pnpm gallery:author-parts -- --author "NAME" --after ENTRY_ID` counts parts
  of an author's public circuits after an entry (`--from N`, `--csv FILE`).
- `pnpm replica:import` copies the newest snapshot into a local replica without
  submitter emails (`~/Library/Application Support/Analog Canvas/local-replica/`);
  `pnpm dev:replica` runs the editor against the real Worker on it, signed in as
  the Owner with a loopback-only account switcher. Nothing reaches Production.
