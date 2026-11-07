# Optional local PowerPoint integration

Status: `proposed`

Primary owner: desktop PowerPoint integration

Windows desktop PowerPoint can opt into the local editor through a per-user
COM add-in. The hosted editor and standalone desktop remain independent.

Scope: an optional installation and document-storage adapter for the existing
desktop editor. Reuse upstream drawing behavior and canonical exports; do not
introduce a second editor, alternate component model or independent updater.
Keep host entry-point changes limited to launch/save/close integration.

## Rules

- The English ribbon has six illustrated actions: New circuit, Edit circuit,
  Import selected circuit, Export selected circuit, Open history version and Help. Updates are
  received automatically. History lists the selected circuit's previous saves
  with readable timestamps and opens a version without immediately changing
  the slide.
- Installation is explicit, per user and reversible. Building or unpacking
  never registers the add-in. The complete package includes English UI,
  installation instructions, licenses and corresponding source.
- Import opens a selected canonical `.icproj.json` (or `.icproj`) file in the
  existing editor, which owns schema validation and migrations. Saving inserts
  a new editable picture on the captured slide; it never replaces a selected
  picture or writes the source file. Cancel or a rejected import leaves the
  slide unchanged. Files larger than 32 MiB are rejected before loading.
- New/edit/import captures the destination slide and picture. Switching slides or
  presentations does not redirect the saved drawing.
- Saving exports the displayed Cell as transparent SVG and embeds the complete
  canonical Project, displayed Cell and three earlier snapshots in the picture's
  CustomerData. Intentional white artwork remains opaque.
- A reopened or copied picture retains editable data. Updates preserve its
  position, size, rotation and stacking; a stale Project baseline rejects the
  update. Picture-specific animations, hyperlinks, cropping and effects are
  outside the preservation guarantee.
- Only the Project opened by the PowerPoint session may save to that session.
  Duplicate tabs with the same Project identity must be resolved first.
- Explicit saves retain local revision files. The editor reports success only
  after PowerPoint acknowledges embedding the exact sequence. Saving the
  presentation remains a separate user action.
- The editor saves from one header button, **PowerPoint**, and never covers the
  canvas. Its dot is green when the slide shows the drawing on screen, amber
  when it does not, and grey on another tab (clicking says to return to the
  linked tab). Busy shows **Saving…**; each outcome is a notice that fades
  (4 s, failures 8 s).
- The [close contract](powerpoint-close.md) governs editor shutdown. Local
  Ctrl+S and PowerPoint acknowledgement have separate meanings.
- A package has no account or hosted simulation dependency. Uninstalling
  removes only the add-in registration; it keeps presentations and recovery data.

## Contract

The file exchange lives in a generated session directory supplied via
`CIRCUIT_PPT_SESSION`; it does not open a listening network port. The
[session handler](../../apps/desktop/src/powerpoint-session.ts) owns token,
Project and Cell validation, monotonic sequence numbers and atomic result
publication. The [native bridge](../../apps/powerpoint/src/CircuitCanvas.cs)
owns acknowledgements and the version-2 embedded drawing payload.

## Acceptance criteria

- Session tests cover disabled standalone mode, token/Project rejection,
  restart sequencing, backups and acknowledgements.
- Packaged desktop acceptance covers English save and close controls, rejected
  saves, edits during saving, other tabs and duplicate Project tabs.
- Windows native tests cover transparent rendering, retained artwork,
  placement, history, stale-write rejection and editable save/reopen data.
