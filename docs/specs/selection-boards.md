# Selection Boards

Status: `accepted`

Primary owner: `worker/boards.ts`

A selection board is an ordered, link-shared list of public Gallery entries that
collaborators build together, for example a Season's benchmark. Entries,
accounts and previews stay the [Gallery's](community-gallery.md).

## Rules

- A board's id is its link, `/boards/<24 letters and digits>`. Anyone holding
  it reads the board: its entries' names, authors, component counts and
  previews. Nothing else of the Gallery opens through it.
- Only an administrator makes a board (`/boards`). Any signed-in account that
  is not blocked changes one: add, replace, remove, move, note, rename, slots,
  lock. Unlocking takes the board's maker or an administrator.
- A board holds only public entries, each once, at most its slots (1–500). An
  entry that later leaves the public wall stays on the board without its
  name or preview.
- Every change records the account's display name, the time and what changed;
  the page shows the latest 300. Deleting an account replaces its name on
  every board with "(deleted account)".
- A locked board refuses every change but unlock.
- Changes in one request apply all or none, as one revision; an open page
  reloads the board when the revision moves.
- Board pages and previews are `noindex`, never cached by shared caches, and
  send no referrer to another site.

## Contract

| Route                                              | Who           | Answer                                       |
| -------------------------------------------------- | ------------- | -------------------------------------------- |
| `GET /boards`, `GET /boards/<id>`                  | anyone        | the page                                     |
| `POST /api/boards` `{title, slots?, entries?}`     | administrator | the board                                    |
| `GET /api/boards/<id>`                             | link holder   | `{board, items, events, entryNames, viewer}` |
| `POST /api/boards/<id>/changes` `{changes: [...]}` | signed-in     | the board                                    |
| `GET /api/boards/<id>/export`                      | link holder   | `{title, slots, lockedAt, revision, items}`  |
| `GET /api/boards/<id>/preview/<entry id>`          | link holder   | the entry's preview SVG                      |

A change is `{kind: "add", entry, note?}`, `{kind: "replace", itemId, entry,
note?}`, `{kind: "remove" | "note" | "move", itemId, note? | to?}`,
`{kind: "rename", title}`, `{kind: "slots", slots}`, `{kind: "lock" |
"unlock"}`; `entry` is an entry id or any Canvas link naming one. Errors:
`board-not-found`, `entry-not-public`, `entry-already-on-board` (with
`entryId`), `board-full`, `board-locked`, `slots-below-items`, `not-allowed`,
`sign-in-required`, `blocked`, `admin-only`, `bad-changes`.

## Acceptance criteria

`worker/boards.test.ts` pins reading by link, making by administrators only,
each change and its record, all-or-none batches, lock and unlock, previews
only for entries on the board, and the sign-in return to a board.
