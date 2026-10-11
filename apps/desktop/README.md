# Analog Canvas internal desktop preview

Windows x64, unsigned unpacked application. Run `Analog Canvas Preview/Analog Canvas Preview.exe` from the generated folder. Keep that entire folder together.

This README describes the source implementation. Each published ZIP contains
only the features of its recorded commit; see its `ACCEPTANCE.json`.

**Save / Ctrl+S** automatically puts a new project in
`%USERPROFILE%\Analog Canvas\Projects`. **Local projects** provides search,
favorites, recent files, copy, rename, saved-file export, history and recycle /
restore. Choose another default directory without moving existing work. Full
locations are available on hover and via **Show in folder**; window titles show
the project name. Window and executable icons use the website's NMOS icon.

**File → Open Project…** opens `.icproj.json` or `.icproj` files in place.
**Save As…** creates an independent identity and switches after success; the
original last-saved file stays unchanged. Its default is the library, with an
external destination available. **Export → Project File…** retains content
identity and does not change the binding or dirty state. SVG/PNG/PDF remain under
File → Export. SPICE and Spectre previews offer **Save file** through native delivery.

File shows the current location and **Recent Projects**. The recent list survives
restarts; removing an entry only removes the shortcut. If a file moved, use Open
Project to locate it. Each tab owns its file binding, and reopening an already
open file selects that tab. Changing the Project's internal name does not rename
its file. Close a changed tab with Save and close, Close without saving, or Keep
open; closing the window offers to save all changed Projects.

If a file changes outside the editor, Save refuses to overwrite it. Use Save As
to keep your edits in another file, or explicitly close the old tab and reopen
the file. Writes replace the destination atomically after checking its bytes;
this is optimistic conflict detection, not an operating-system-wide write lock.

This preview has no account, Cloud, community, Agent, simulation, external links
or service worker. It retains the shared editor, model, Project schema, embedded
components and simulation source data. The desktop build rejects online
implementation modules in emitted chunks and records `desktop-modules.json`.
Network and navigation are blocked independently in the shell. Bundled fonts
support offline SVG/PNG/PDF output, including math labels.

Changed saves retain three previous versions. History offers comparison, restore
and independent branches; file export does not include history. Back up complete
library directories and user data while the app is closed. Library deletion uses
a recycle area; permanent deletion needs native confirmation. Close an open tab
before changing its saved copy from the library.

The close decision defaults to **Keep open**; cancelled or failed saves keep the
window. Restart restores tabs and unsaved working copies. Bindings are reacquired
only when remembered files still match their acknowledged bytes; otherwise edits
reopen detached with a notice. **Recover Unsaved Work…** retains the shared
bounded recovery UI. Recovery is a safety copy, not a saved project.

Stable user data lives in `%APPDATA%\Analog Canvas`, independently of the ZIP.
On upgrade, close the previous preview and accept the one-time import of its
settings, recent records and recovery. Original data stays in
`%APPDATA%\Analog Canvas Preview`; external files are not moved. Interrupted
imports retry from checked copies, without replacing conflicting current data.

**About** displays version, commit, file format and data locations. It offers
opt-in Windows `.icproj` association and removal for this installation. This
extension is the same canonical JSON, avoiding a global `.json` association.
Cold and running-instance opens are supported. After replacing the ZIP, enable
association in the new installation to update its path. Installers, signing and
automatic updates remain deferred.

## Build and validate

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter "@icm/editor^..." --if-present build
pnpm --filter @icm/editor exec vite build --config vite.desktop.config.ts
pnpm --filter @icm/desktop build:preview
# Commit the source and provenance before assembling the package.
pnpm --filter @icm/desktop package:preview
pnpm --filter @icm/desktop test:preview
# Install Gitleaks 8.30.1; set GITLEAKS_BINARY if it is not on PATH.
pnpm --filter @icm/desktop security:preview
```

The package script writes a new timestamped folder under `output/`, retains Electron's license files, and includes `source.zip`, `LICENSE.md`, the original fork notice and the [source/adaptation inventory](SOURCES.md). `plan/preview-package.json` identifies the latest local package for acceptance. The acceptance script uses an isolated application-data directory, intercepts native dialog choices in the test process, writes real files and relaunches the packaged executable.

The shell is adapted from **LXY-freshman / Schematic Draft** under AGPL-3.0-only. [The retained original notice](upstream-NOTICE.md) describes that historical fork, not the current preview's feature set. See [SOURCES.md](SOURCES.md) for fixed source links and attribution.

## Preview distribution

Download `analog-canvas-desktop-windows-x64.zip` from a **Desktop Preview** entry in [GitHub Releases](https://github.com/cascode-ai/analog-canvas/releases). Extract the whole ZIP, then run `Analog Canvas Preview/Analog Canvas Preview.exe` inside the extracted preview directory. No Node.js, pnpm or developer tools are required. The executable needs its sibling resources; distributing the `.exe` alone will not work. GitHub's automatically generated source archives are source code, not the runnable application.

The [Windows packaging and acceptance workflow](../../.github/workflows/desktop-preview.yml) runs when a preview is released, not on every merge: no merge ships the desktop preview, so the Web merge queue does not package it. It checks the real packaged executable before anything is uploaded.

After merging, run [Desktop preview release](../../.github/workflows/desktop-release.yml) from Actions with the merged commit as `ref`. Keep `publish` off to inspect an unpublished Actions artifact, or enable it to publish the accepted ZIP as a GitHub prerelease. The workflow rejects commits outside `main`, rebuilds and validates the exact selected commit, and uses a `desktop-preview-…` tag that does not match the Web deployment's `v*` tags. It does not replace existing releases or mark the preview as Latest.

The ZIP includes `ACCEPTANCE.json` and `preview.png` from the packaged run,
corresponding source and attribution. Signing, an installer and automatic updates
remain outside this minimum desktop scope.

Before either Actions artifact upload or prerelease publication, the same workflow rejects private/configuration paths and scans runtime files plus nested source for credentials. Successful packages include `SECURITY.json`. Desktop builds do not load local `.env` files or expose `VITE_*` environment values. See the [credential audit and distribution boundary](../../docs/desktop-distribution-security.md) for evidence, scanner limitations and the server-side administrator model.
