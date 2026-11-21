# Custom Process Presets

Status: `proposed`

Primary owner: `apps/editor/src/features/netlist-export`

Where a person's Custom Process presets live, how a Project carries the one it
was drawn with, and how the editor, Agents, the command line and the Gallery
select one. Device binding and printing stay in
[netlist export](netlist-export.md#process-configuration); this spec only
decides which `NetlistExportProfile` they receive.

## Rules

### Presets

- A Custom preset is a named `NetlistExportProfile` with `id: "custom"`, a
  stable `presetId` (`cp-` plus 10 base-36 characters) and a `name` (1–64
  characters). Built-in Processes (`abstract`, `sky130`, `sg13g2`, `ics55`)
  are not presets and are never stored per person.
- Validation is `isNetlistExportProfile`; the editor, Worker, Agent and command
  line share it. An invalid preset is refused whole, never partly applied.
- A preset is at most 64 KB of JSON; an account holds at most 32 presets.

### Account presets (per person)

- Signed in, a person's presets, their default `presetId` and their selected
  Process live in their account, private to them, and follow them across
  browsers and devices. Signed out, the browser keeps them as today
  (`localStorage`).
- Every write carries `expectedRevision`; a stale write is refused with
  `PRESET_REVISION_CONFLICT` and the current revision, and the editor offers
  to keep theirs or take the stored one. Nothing merges silently.
- First signed-in load in a browser whose Custom differs from the default
  template imports it once as a preset named `Browser Custom`; an identical
  stored preset is not duplicated. The browser copy then follows the account.
- Deleting an account deletes its presets
  ([account deletions](../../worker/account-deletions.ts)).

### Project presets (travel with the circuit)

- A Project may carry presets in `netlistPresets: [{presetId, name,
profile}]` and name one in `netlistProcess: {kind: "builtin", id} |
{kind: "preset", presetId}`. Both are optional; an older Project has
  neither and behaves as today.
- Only an explicit action writes them: **Netlist → Save preset to Project**,
  or Agent `set-netlist-process`. Both are one undoable transaction. Selecting
  a Process for the session alone never edits the Project.
- A Project preset is a copy: editing the account preset later does not
  change Projects, and editing a Project preset does not change the account.
  **Save to my presets** copies it back under a new `presetId` when the
  ids collide with different content.
- Publishing to the Gallery publishes `netlistPresets` with the Project; the
  Publish dialog says so when any are present.

### Selection

The Process an export or a placement uses resolves in this order; the first
that applies wins:

1. The explicit request (Netlist panel choice this session, Agent or command
   line `process`).
2. The Project's `netlistProcess`.
3. `inferNetlistProcess` from the Project's transistors (today's rule).
4. The person's selected Process (account, else browser).

- `custom` alone means the person's default preset; with no account and no
  browser preset it is the Custom template.
- A request naming a preset the reader cannot see (not in the Project, not
  theirs) is refused with `UNKNOWN_PROCESS_PRESET`; it never falls back to
  another Process.
- Opening someone else's Project uses its `netlistProcess` and presets, not
  the reader's, so every reader exports the author's netlist.

### Agents, command line and Gallery

- `process` accepts a built-in id, `custom`, `preset:<presetId>`, or an inline
  `{profile}` object (validated as above, never stored).
- A Trusted local task (`canvas-local`) sees only the Project's presets and
  inline profiles; account presets need a task the person approved with their
  account.
- Gallery `/g/<id>/netlist.sp|scs` and `maintenance/netlists` take
  `process=<builtin>|preset:<presetId>`, resolving presets from the entry's
  Project only. Without `process` they print as today.

## Contract

- Account API (signed in, owner only):
  - `GET /api/me/netlist-presets` → `{revision, selected, defaultPresetId,
presets: [{presetId, name, profile, updatedAt}]}`.
  - `PUT /api/me/netlist-presets` with the whole document and
    `expectedRevision` → the new document; 409 `PRESET_REVISION_CONFLICT`;
    422 `INVALID_PROCESS_PRESET` with the validator's message; 413 over the
    limits.
- Project schema: `netlistPresets` and `netlistProcess` added to the
  [model schema](../../packages/model/src/schema.ts) under a new
  `CURRENT_PROJECT_FILE_VERSION`; older readers refuse the newer file version,
  as they do today.
- Agent edit `set-netlist-process {process, preset?}`; read-netlist
  `process` as above. Error codes: `UNKNOWN_PROCESS_PRESET`,
  `INVALID_PROCESS_PRESET`.

## Acceptance criteria

- Two accounts on one browser each see only their own presets and selection
  after signing in; signing out restores the browser copy.
- A preset saved in browser A appears in browser B after reload; concurrent
  edits in both produce one `PRESET_REVISION_CONFLICT`, never a lost edit.
- A Project saved with a preset exports the same netlist byte-for-byte for its
  author, another signed-in reader, a signed-out reader, `canvas-local
netlist` and the Gallery raw route.
- `process: "preset:<unknown>"` is refused everywhere with
  `UNKNOWN_PROCESS_PRESET`; no path falls back.
- A Project without the new fields exports exactly as on `main`, checked over
  the Gallery regression corpus.
