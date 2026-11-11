# Gallery off-site backups

The private `cascode-ai/analog-canvas-backups` repository owns the backup
collector, its tests, schedule (weekly, plus manual dispatch) and recovery
instructions. Snapshots are date-stamped private Release attachments, never overwritten;
Gallery and Store runs keep only the two newest Releases of their kind and delete
older ones. Manual activity migration captures remain until explicitly removed.
`cascode-ai` members can read
them (they contain submitter emails and sign-in methods; store snapshots also
every private Cloud Project); only the Owner changes the repository or starts
its workflows.

## Credentials

- `GALLERY_BACKUP_TOKEN` (read-only) lives in this repository's
  `cloudflare-production` environment and the backups repository's Actions
  secrets; deployment syncs it to the Worker. Rotate by updating both and
  deploying; never commit or print it. It allows
  `GET /api/gallery/maintenance/automated-backup?table=…` pages; no admin
  session, writes, restore or private Cloud Projects. Every other Gallery
  read is open to anyone
  ([reader access](specs/community-gallery.md#reader-access)).
- `STORE_BACKUP_TOKEN`, stored and rotated the same way, reads only
  `automated-backup?scope=store` and `scope=activity` pages.

## Private activity capture

`automated-backup?scope=activity` uses the Store credential, never the Gallery
credential. It captures `entryBookmarks`, `selectionBoards`,
`selectionBoardItems`, `selectionBoardEvents` and `entryOpens`: private Statistics
bookmarks, Board metadata/items/audit history and daily per-entry open counts.
`&source=<key>` selects a Dataset store. These rows are outside the existing
Gallery, Store and Reviews captures; their inventories remain unchanged.

Use the same fenced paging and changed-key reconciliation below. Board event
cursors contain a positive integer `seq`; other table cursors contain strings.
Administrators can read the community scope with
`schema-backup?scope=activity&table=…`. The export changes no business rows and
enables no replication. `schema-restore` does not restore these tables; retain
the original capture and reconcile both regions before any data migration.

## Reviews capture

`automated-backup?scope=reviews` (the Gallery credential) reads a store's
[reviews](specs/community-gallery.md#reviews), fixes and reference images:
`entryReviews`, `entryFixes`, `entryReferences`. `&source=<key>` reads a
dataset's store instead of the community one; `source` is also allowed for
`activity`, but with Gallery or Store scope returns 400 `invalid-source`.
The scope has its own revision and change index, so a
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
curl "https://analog-canvas.tokenzhang.com/api/gallery/maintenance/netlists?format=spice"
```

Pages hold up to 100 public entries (`limit` ≤ 200); pass `nextCursor` as
`after` until `null`. `format=spectre` and `id=<entry>` are supported; blocked
exports carry `netlist: null` with diagnostics. Anyone can open the URL.
Fields:
[Gallery specification](specs/community-gallery.md#administration).

## Recovery

Live account cleanup is independent of backup expiry. Private Release copies
expire through the retention above, Cloudflare bookmarks after their recovery
window, and local snapshots under the regional host's backup policy. Keep
exported operator copies access-controlled and apply their retention separately.

Follow the Release archive's README. Inspect rows offline first, keep original
IDs, history and likes, and take a new live backup before any administrator
write. **Never feed a Gallery-only snapshot to `schema-restore`**: it also
replaces private Cloud Projects. Use the
[recovery rules for the active region](deployment.md#point-in-time-recovery).
Investigate any
failed or missing run; keep local copies as a second destination.

## Tools on snapshots

- `pnpm gallery:author-parts -- --author "NAME" --after ENTRY_ID` counts parts
  of an author's public circuits after an entry (`--from N`, `--csv FILE`).
- `pnpm replica:import` copies the newest snapshot into a local replica without
  submitter emails (`~/Library/Application Support/Analog Canvas/local-replica/`);
  `pnpm dev:replica` runs the editor against the real Worker on it, signed in as
  the Owner with a loopback-only account switcher. Nothing reaches Production.
