# Getting Started with v0.1

## Run from source

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open the displayed loopback URL. Open **File** and use **Import SPICE** to
select one `.cir`, `.sp`, or `.spi` entry plus its local include files.
Imported instances begin unplaced so that the user can decide the presentation.
A normal launch starts with a genuinely empty `New Circuit` Document for
palette-first manual authoring; no Project file needs to be opened first.

## Edit and connect

- Use **+ Component** to search the categorized built-in library, choose a
  symbol by its inline preview, and click the canvas to place it. The
  **Placement Tray** keeps imported or returned Instances without deleting
  their netlist facts: drag one to the canvas, select **Place…** for a cursor
  placement, or use **Place all** for a deterministic starter grid. **Return
  to tray** is reversible through Undo and is distinct from permanent Delete.
- Click to select, `Shift`/`Ctrl`-click to extend the selection, or drag blank
  canvas to box-select. Dragging one selected instance moves the whole
  selection atomically.
- Internal wires and Junctions move with a selected component group; only
  wires leaving the group stretch. Press `Ctrl+C` and `Ctrl+V`, or use the
  **Edit** menu, to duplicate the selected group and its internal wiring.
- Use **Wire** or press `W`, then choose two pins, Junctions, or route segments.
  Passing across a conductor remains a Crossing; ending on one creates a
  Junction automatically. An exact multi-route intersection is rejected as
  ambiguous instead of silently merging Nets.
- While wiring, click blank canvas to fix bends; double-click blank canvas or
  press `Enter` to finish at any grid point. `Backspace` removes the latest
  uncommitted bend and `Escape` cancels the session.
- Select any route segment to expose its movement handle. Drag the handle
  perpendicular to that segment to stretch adjacent geometry without rerouting
  the rest of the wire. Use the contextual
  **Remove route geometry** action to keep logical membership while deleting
  only the drawn route.
- Right-click an endpoint for the distinct **Disconnect endpoint** and
  **Delete connection** actions.
- `Delete` on a connected component now removes the component while preserving
  its wires as dangling Junction endpoints at the former pin positions.
- Select an instance to edit its displayed name. Select a wire Route to add an
  electrical Net label; assigning the same name to another Net explicitly
  connects those Nets. Use **More / Add text** for non-electrical notes. Label
  handles may be dragged near their owner, while plain text moves freely.
- Press `R` to rotate, `F` to fit, `X` to reverse a selected current arrow,
  `Ctrl+Z` to undo, and `Ctrl+Y` or `Ctrl+Shift+Z` to redo. Shortcuts do not
  fire while typing in a field.
- Use `Ctrl`+mouse wheel to zoom around the cursor and middle-button drag to
  pan. View changes do not increment the Document revision.

## Save and recover

**File / Save Project** creates a canonical `.icproj.json` formal Project
file. In browsers without an explicitly authorised file handle, this is a
download; keep the downloaded file as your authoritative Project. Edits also
stage an origin-local recovery copy. A recovery copy is not a formal save and
can be lost if browser site data is cleared. On a later start the File menu
offers recovery choices; recovery never silently replaces a formal file.

Use **File / Open Project** to validate and reopen a formal Project file.
Opening an invalid or future-version file leaves the current Document
unchanged. The old manual snapshot buttons have been removed; recovery is
automatic infrastructure.

SPICE files are import inputs, not embedded source attachments. Saving an
imported Project preserves the editable schematic and source provenance, but
does not preserve `.spi`, `.lib`, or `.inc` contents; keep those original files
when you need to import them again.

## Export

The **File** menu exports SVG, PNG, and PDF containing only formal schematic
layers. PNG uses 3x raster scale. PDF contains that same high-resolution raster
on a page matching the SVG viewBox.

For an electrical design netlist, choose **Netlist / Check Report** first, or press **Check and Save** in the toolbar to check the circuit and keep a copy on your account's shelf.
The dialog reports every blocking electrical fact and, when valid, previews
the deterministic structural SPICE or Spectre text. Use either the dialog's
download button or **File / SPICE netlist** and **File / Spectre netlist** to
download it. These files contain structure only: they do not add PDK includes,
models, corners, stimuli, analyses, or simulator options.

File-menu export opens the preflight dialog before downloading when warnings
need review. An explicitly marked NoConnect is shown as a generated floating
node such as `NC0001`; an unmarked open pin remains a blocking error.

## Portable release

Build the versioned bundle and start it with Node 24:

```powershell
pnpm release:package
node output/release/interactive-circuit-maker-v0.1.0/start.mjs
```

Open `http://127.0.0.1:4173`. Chromium can install the app from its browser
install action. The server accepts only loopback connections.

## Deployment

The editor is served by the Cloudflare Worker in `worker/`, which
`.github/workflows/cloudflare.yml` deploys on every push to `main`. That
Worker is the only public deployment: it hosts the built editor and the
gallery, account, and Agent-session endpoints behind it.

A downloaded `.icproj.json` file remains the authoritative copy of your work.
The browser recovery copy is specific to one browser profile and may disappear
when site data is cleared, and publishing to the gallery is a deliberate,
separate act rather than a backup.

Before a public release, verify opening, refreshing, importing and exporting,
browser recovery, and PWA installation at the deployed URL.
