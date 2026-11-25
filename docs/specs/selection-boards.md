# Selection Boards

Status: `accepted`

Primary owner: `worker/boards.ts`

The selection board is the one ordered list of public Gallery entries that
collaborators build together, for example a Season's benchmark. Entries,
accounts and previews stay the [Gallery's](community-gallery.md). An entry may be
the community wall's or a reference dataset's circuit (`ag-308`, `ct-001`…).

## Rules

- There is one board, at `/boards`; no link names a board. Anyone reads it: its
  entries' names, authors, component counts and previews. Nothing else of the
  Gallery opens through it. A link from when there were several boards,
  `/boards/<id>`, moves to `/boards`.
- The board is the oldest board kept, so a board made before there was one
  stays the board; else its first change makes it (`Selection board`, 50
  slots), in the region a create would pick for its id.
- Any collaborator, a signed-in account that is not blocked, changes it: add,
  replace, remove, move, note, rename, slots, lock and unlock.
- The board holds only public entries, each once, at most its slots (1–500). An
  entry that later leaves the public wall stays on the board without its
  name or preview. A reference dataset's circuit must be public in that
  dataset's own store, where its name, facts and drawing are read; the board's
  store keeps only its id. A wall entry is never taken for a dataset id.
- Every change records the account's display name, the time and what changed;
  the page shows the latest 300. Deleting an account replaces its name on
  the board with "(deleted account)".
- The page is in English.
- A board draws each entry plain, as a benchmark Task holds it: no colour on parts,
  labels or wires and none of the drafting drawn over the circuit (frames,
  construction lines, notes, arrows, circles); net and supply labels stay. The
  Gallery entry itself is unchanged.
- Each entry shows its circuit type, transistor count and levels, and the page
  maps the board by all three. A type is one of the Gallery taxonomy's groups
  but Design Attributes, set by hand or else taken from the entry's first tag in
  such a group. Transistors are the top Cell's parts of the catalog's
  transistor category; an entry is multi-level when its project has more than
  one Cell or its top Cell places an analog, logic or signal-flow block or a User
  Component, else single-level. Both are counted once per preview revision.
- A locked board refuses every change but unlock. The page offers no lock (only the API does) and shows unlock on a locked board; it edits the title and slots in place and puts the latest change, with the whole log, at its top.
- Changes in one request apply all or none, as one revision; an open page
  reloads the board when the revision moves.
- Both entrances use the same Board and permissions. Local reads, writer-routed
  commands, revision preconditions and uncertain-response reconciliation follow
  [regional activity](regional-activity.md).
- Board pages and previews are `noindex`, never cached by shared caches, and
  send no referrer to another site.

## Contract

| Route                                        | Who       | Answer                                       |
| -------------------------------------------- | --------- | -------------------------------------------- |
| `GET /boards`                                | anyone    | the page                                     |
| `GET /boards/<id>`                           | anyone    | a redirect to `/boards`                      |
| `GET /api/board`                             | anyone    | `{board, items, events, entryNames, viewer}` |
| `POST /api/board/changes` `{changes: [...]}` | signed-in | the board                                    |
| `GET /api/board/export`                      | anyone    | `{title, slots, lockedAt, revision, items}`  |
| `GET /api/board/preview/<entry id>`          | anyone    | the entry's preview SVG                      |

Before its first change the board reads as `Selection board`, 50 slots,
revision 0, with no items.

A change is `{kind: "add", entry, note?}`, `{kind: "replace", itemId, entry,
note?}`, `{kind: "remove" | "note" | "move", itemId, note? | to?}`,
`{kind: "type", itemId, type}`, `{kind: "rename", title}`, `{kind: "slots", slots}`, `{kind: "lock" |
"unlock"}`; `entry` is an entry id or any Canvas link naming one. Errors:
`board-not-found`, `entry-not-public`, `bad-type`, `entry-already-on-board` (with
`entryId`), `board-full`, `board-locked`, `slots-below-items`, `sign-in-required`, `blocked`, `bad-changes`.

## Acceptance criteria

`worker/boards.test.ts` pins the one board read by anyone and made by its
first change, an earlier board kept as the board, the English page, each
change and its record, all-or-none batches, plain previews,
types, transistor counts and levels, lock and unlock by any collaborator, previews
only for entries on the board, reference datasets' circuits read from their own
stores, and the sign-in return to the board.
