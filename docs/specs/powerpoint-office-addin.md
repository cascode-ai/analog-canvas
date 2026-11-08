# PowerPoint add-in

Status: `accepted`

Primary owner: `apps/editor/public/office`

The Office.js add-in draws circuits on slides in PowerPoint for Windows, Mac
and the web, and edits them again with the hosted editor. The Windows desktop
integration is [PowerPoint local deployment](powerpoint-local.md).

## Rules

- The site serves the whole add-in: manifest, task pane and the editor at
  `/editor?office=dialog`, so a deploy is its update. The manifest changes only
  for buttons, icons, permissions or requirement sets, and its version then
  increases.
- It needs PowerPointApi 1.5, DialogApi 1.2 and ImageCoercion 1.2; a host
  lacking one is told which.
- The pane opens one editor dialog at a time: New circuit, an example (a
  Gallery circuit saved as a Project file in `public/office/examples/`), or
  Edit for the one selected circuit picture. Double-click stays
  PowerPoint's; the pane names the selected circuit on its Edit button.
- The dialog shows one drawing, in place of its empty starting one: no tabs,
  no Netlist or Project Code, the Reference window closed until opened; the
  header stays. Escape stays the editor's:
  PowerPoint for Mac would close the dialog on it.
- The editor's header **PowerPoint** button places the Cell on screen, with
  the button states and notices of the [desktop editor](powerpoint-local.md).
  A drawing opened from a slide replaces its picture: same left, top and
  width, height following the drawing, inside the slide. Any other drawing
  becomes a new picture on the selected slide, centred at 70% of it. Later
  saves from the dialog replace the picture it placed. The new picture is
  placed and tagged before the old one is deleted.
- The picture is the SVG of the displayed Cell; its tags hold the canonical
  Project; the add-in uploads nothing. Pictures of the desktop add-in
  (CustomerData) are not read.
- Placing a circuit marks the presentation to open the pane wherever the
  add-in is installed. Saving the presentation stays the user's action.

## Contract

- Messages between pane and dialog: [`office-messages.ts`](../../apps/editor/src/app/office-messages.ts),
  JSON sent in chunks of at most 30,000 characters and joined in any order;
  [`taskpane.js`](../../apps/editor/public/office/taskpane.js) speaks the same.
- Picture tags: `AC_FORMAT` = `analog-canvas-office-v1`, `AC_NAME`,
  `AC_DOCUMENT` (the Cell shown), `AC_PROJECT_N` and `AC_PROJECT_0`… (the
  Project text in 30,000-character parts). The picture is named
  `Analog Canvas: <name>`.
- `/office/` is the install page and links the manifest.

## Acceptance criteria

- [`office-messages.test.ts`](../../apps/editor/src/app/office-messages.test.ts):
  messages join across pane and editor in any order, the pane's examples
  open, the manifest loads only site files that exist.
- `scripts/pwa-icons.mjs --check` pins the add-in icons.
- In PowerPoint: circuits placed on several slides, Edit replaces a picture
  in place, a reopened presentation shows the pane.
