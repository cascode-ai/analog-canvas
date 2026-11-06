# PowerPoint editor close

Status: `accepted`

Primary owner: desktop PowerPoint integration

The local PowerPoint integration keeps editable circuit data attached to the
slide picture. This contract covers closing its editor window.

## Rules

- In a PowerPoint-launched session, saving on window close updates the linked
  PowerPoint drawing and waits for acknowledgement before closing. Other open
  projects retain native local saving.
- A successful PowerPoint button save clears the linked drawing's close prompt
  for that exact project snapshot and displayed Cell, even if its local file is
  still dirty. Native Ctrl+S alone does not acknowledge a PowerPoint update.
- Failure, missing acknowledgement, or newer edits keep the window open.
- The close dialog labels the PowerPoint destination in English. Choosing not
  to update PowerPoint cancels pending saves before closing and retains local
  recovery revisions. A cancelled session cannot publish or apply later saves.
  Cancellation and result application share an exclusive cross-process gate,
  covering result reads through durable acknowledgement. An in-flight or
  interrupted apply, failed cancellation write, or incompatible add-in keeps
  the editor open; locks are never stolen. An update already acknowledged by
  PowerPoint is explicitly reported as retained, not undone.
- PowerPoint must still save the presentation file. The editor does not save
  or close the user's presentation automatically.
- Standalone editor launches retain the native close dialog and saving path.

## Acceptance criteria

[PowerPoint close tests](../../apps/editor/src/app/powerpoint-close.test.ts)
cover acknowledged snapshots, failure, edits during saving, changed Cells,
and other project tabs. Packaged desktop acceptance must exercise the button
and window-close paths with the actual renderer and file exchange, including
timeout then discard then delayed receiver, and cancellation during an apply.
