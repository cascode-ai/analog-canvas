# Gallery off-site backups

Production Gallery backups run in the private `cascode-ai/analog-canvas-backups`
repository's GitHub Actions workflow, weekly on Sunday at 03:17 UTC and on
manual dispatch. They do not require a running desktop, browser session or
Codex. That repository owns the collector, its tests, schedule and recovery
instructions. Members of the `cascode-ai` organisation can read it and download
any snapshot (`node scripts/gallery-private-snapshot.mjs [--store] --cached`):
Gallery snapshots carry each entry's submitter email and sign-in method, and
store snapshots also every account's private Cloud Projects. Only the Owner
changes the repository or starts its workflows. Date-stamped private Release attachments retain old snapshots
without overwriting them or putting every database in Git history. Automatic
retention deletion is deliberately disabled initially.

The read-only `GALLERY_BACKUP_TOKEN` is stored in this repository's
`cloudflare-production` environment and as an Actions secret of the backups
repository. Production deployment syncs it to the Worker. Rotation requires
updating both secrets and deploying; never commit or print its value.
It authorizes Gallery reads only: every read a signed-in member may make (the
wall, tags, entries with their Project Code, previews), plus
`GET /api/gallery/maintenance/automated-backup` with
`table=inventory|galleryEntries|galleryEntryVersions|galleryLikes`, whose
pages contain one raw record and an opaque continuation cursor, and
`GET /api/gallery/maintenance/netlists`, the public entries' netlists (see
below). Without it or a session the Gallery reads nothing. The credential
grants no admin session, mutation, restore or private Cloud Project access. Preview does not receive the secret. Responses are never
publicly cached.

Every capture includes all Gallery statuses, retained historical versions,
likes, raw project text, previews, ownership and moderation metadata, and
each entry's and version's private testbench (`testbench_text`, kept out of
the project text since #1545; see
[Testbench privacy](specs/community-gallery.md#testbench-privacy)). The
inventory includes the selected tables' SQLite definitions and indexes.
Each inventory carries its scope's revision, which SQLite triggers count up on
every row change in exactly the tables that scope reads. A capture compares it
at its start and end and retries on any difference, so a same-count edit or a
delete and reinsert is never accepted, while a private Cloud Project save no
longer restarts a Gallery capture. The final counts must match;
identities must be unique and history/likes must reference a captured entry.
Each result is reconstructed in a temporary SQLite database and read back
against all source rows before being published. No content hashes are required.

Private Cloud Projects, accounts, analytics and the shared component catalog
are outside this Gallery-only backup. Included Project Code already carries
the definitions its drawings reference. Private Cloud Projects have the
manual whole-store backup below.

## Manual whole-store backups

The whole Gallery store — the Gallery tables plus every private Cloud Project
and its retained versions — is backed up only when started by hand:

```bash
node scripts/gallery-private-snapshot.mjs --store
```

This dispatches the private repository's `store-backup.yml` workflow, waits
for its verified Release (`store-…`, holding `store.sqlite` and
`store-backup.json`), and downloads it under
`~/Library/Application Support/Analog Canvas/store/`, keeping the two newest
like the Gallery helper. The workflow reads
`GET /api/gallery/maintenance/automated-backup?scope=store` with the separate
read-only `STORE_BACKUP_TOKEN`, stored and rotated like the Gallery credential.
It reads those one-row backup pages and nothing else: no wall, no writes, no
administrator authority, and the Gallery credential cannot read this scope.
A signed-in administrator's browser reads the same pages from
`GET /api/gallery/maintenance/schema-backup?table=…`; there is no longer a
single-response dump of the whole store, which can exceed the Worker's memory.

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
Within 30 days, rolling a whole store back to a point in time is the
[point-in-time recovery](deployment.md#point-in-time-recovery) procedure.

GitHub Actions can be delayed or disabled and credentials can expire. A failed
or missing run must be investigated; an old successful archive remains valid.
The weekly interval means up to seven days of newly published work may be
absent from the last snapshot. GitHub repository administrators control Actions
failure notifications. A private repository protects confidentiality through
access control; it is not an offline or immutable archive, so keep the newest
local recovery copies as a second destination.

For an already-authorized Mac, run `node scripts/gallery-private-snapshot.mjs`
from the main repository to start a fresh capture, wait for its verified
private Release, and download its SQLite database under
`~/Library/Application Support/Analog Canvas/gallery/` (outside iCloud
Documents). Use `--cached` to download the latest existing Release without
contacting Production. Use
`--directory PATH` for another private (mode 0700) destination. The helper uses the existing
GitHub CLI login and never reads or stores the backup token. It never
overwrites a capture. After each successful run, `--cached` included, it keeps
the two newest snapshots in that directory that pass the same integrity
checks as a new download (and the one just obtained, should it be older) and
moves older ones to the Trash with macOS's `trash` command (macOS 15 or later;
elsewhere it only lists them). A partial or failed download is neither counted
nor moved, and emptying the Trash stays the operator's decision. This relies
on the private Releases keeping every capture (`gh release download` fetches
an old one again); revisit it if their retention ever deletes.

## Counting an author's parts

`pnpm gallery:author-parts -- --author "NAME" --after ENTRY_ID` lists the
part count of each public circuit an author uploaded after the last counted
one, from the newest downloaded snapshot (take a fresh one first), and how many
circuits have each count. The count is the one the Gallery stores with each
entry, which the wall's size filter uses: every drawn part — devices, sources,
blocks and gates — but not ports, supply or ground markers or drafting.
`--from N` starts at the N-th public circuit instead, though numbers shift when
an older one is withdrawn, and `--csv FILE` writes one row per circuit. It
flags a one-Cell drawing whose name states a different transistor count, lists
withdrawn or rejected uploads it left out, and prints the `--after` value for
the next count. Any pricing is worked out elsewhere.

## A local replica for development

`pnpm replica:import` copies the newest downloaded snapshot into a private
local replica beside it (`~/Library/Application Support/Analog Canvas/local-replica/`),
stored the way the real Worker stores it and without submitters' emails.
`pnpm dev:replica` then runs the editor against the real Worker on that
replica, opened as the Owner; Sign out and Sign in lead to a page that signs
in as any of its accounts. The backup holds no roles, so the accounts that
reviewed circuits are its Owners. Both exist only on this computer: nothing reaches
Production, and the switcher answers only loopback requests.
