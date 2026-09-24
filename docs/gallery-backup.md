# Gallery off-site backups

Production Gallery backups run in the private `Arcadia-1/analog-canvas-backups`
repository's GitHub Actions workflow, weekly on Sunday at 03:17 UTC and on
manual dispatch. They do not require a running desktop, browser session or
Codex. That repository owns the collector, its tests, schedule and recovery
instructions. Date-stamped private Release attachments retain old snapshots
without overwriting them or putting every database in Git history. Automatic
retention deletion is deliberately disabled initially.

The read-only `GALLERY_BACKUP_TOKEN` is stored as a GitHub Actions secret in
both repositories. Production deployment syncs it to the Worker. Rotation
requires updating both secrets and deploying; never commit or print its value.
It authorizes only two reads: `GET /api/gallery/maintenance/automated-backup`
with `table=inventory|galleryEntries|galleryEntryVersions|galleryLikes`, whose
pages contain one raw record and an opaque continuation cursor, and
`GET /api/gallery/maintenance/netlists`, the public entries' netlists (see
below). The credential grants no admin session, mutation, restore or private
Cloud Project access. Preview does not receive the secret. Responses are never
publicly cached.

Every capture includes all Gallery statuses, retained historical versions,
likes, raw project text, previews, ownership and moderation metadata. The
inventory includes the selected tables' SQLite definitions and indexes.
A DO lifetime identifier plus SQLite's cumulative change count identifies the
capture interval: any SQL mutation or object restart causes the collector to
retry instead of accepting a mixed snapshot. The final counts must match;
identities must be unique and history/likes must reference a captured entry.
Each result is reconstructed in a temporary SQLite database and read back
against all source rows before being published. No content hashes are required.

Private Cloud Projects, accounts, analytics and the shared component catalog
are outside this Gallery-only backup. Included Project Code already carries
the definitions its drawings reference. The existing manual full-store
schema-backup and schema-restore APIs have a different scope.

## Reading netlists from another machine

The Gallery stores each drawing's Project Code, not its netlist. The netlist
read prints them on the server, so another machine needs only the credential
and `curl`, not a checkout of this repository:

```bash
curl -H "Authorization: Bearer $GALLERY_BACKUP_TOKEN" \
  "https://analog-canvas.tokenzhang.com/api/gallery/maintenance/netlists?format=spice"
```

Each page holds up to 100 public entries (`limit` up to 200) in entry-id
order. Pass the response's `nextCursor` back as `after` until it is `null`.
`format=spectre` prints Spectre instead, and `id=<entry>` reads one entry. An
entry whose export is blocked carries `netlist: null` and the diagnostics that
blocked it. A signed-in administrator can open the same URL in a browser
without the token. The
[Gallery specification](specs/community-gallery.md#administration) owns the
response fields.

## Recovery

Download a completed private Release's archive and follow its README. It
contains original raw rows, SQLite schema, a standalone recovered database and
a capture/verification manifest. To recover selected deleted Gallery rows,
inspect them in the offline database first; keep original IDs, history and
like relationships. Take a new live backup and account for newer edits before
any administrator writes. A full-store restore can overwrite newer work.

**Never feed a Gallery-only snapshot into the old `schema-restore` endpoint**:
that operation also replaces private Cloud Projects and reapplies current
history retention. Live recovery remains an explicit administrator operation;
the scheduled job is strictly read-only and never performs automatic restores.

GitHub Actions can be delayed or disabled and credentials can expire. A failed
or missing run must be investigated; an old successful archive remains valid.
The weekly interval means up to seven days of newly published work may be
absent from the last snapshot. GitHub repository administrators control Actions
failure notifications. A private repository protects confidentiality through
access control; it is not an offline or immutable archive, so keep the existing
local recovery copies as a second destination.

For an already-authorized Mac, run `node scripts/gallery-private-snapshot.mjs`
from the main repository to start a fresh capture, wait for its verified
private Release, and download its SQLite database under
`~/Library/Application Support/Analog Canvas/gallery/` (outside iCloud
Documents). Use `--cached` to download the latest existing Release without
contacting Production. Use
`--directory PATH` for another private (mode 0700) destination. The helper uses the existing
GitHub CLI login and never reads or stores the backup token. It keeps each
dated snapshot separately and never overwrites a prior capture.
