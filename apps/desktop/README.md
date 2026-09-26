# Analog Canvas internal desktop preview

Windows x64, unsigned unpacked application. Run `Analog Canvas Preview/Analog Canvas Preview.exe` from the generated folder. Keep that entire folder together.

Draw a circuit, then use **File → Export Project File…** (or Ctrl+S). Choose a destination and wait for **Exported**. Close the application, start it again, and use **File → Import → Project File…** or **Open file in new tab** to open that copy. SVG/PNG/PDF exports are available through File → Export.

This preview has no account, Cloud, community, Agent, simulation, external links or service worker. It retains the current editor and Project schema. Some dormant online implementation remains in shared editor chunks; this is not completion of build-time module separation. Network and navigation are blocked independently in the shell.

There is **no native in-place Save**, automatic file association, installer, update mechanism or coordinated multi-tab Save-on-close. Export every tab you need before closing. The close reminder defaults to **Keep open**. Local recovery is a safety copy, not a saved file. After restarting, use **File → Recover Unsaved Work…** to inspect retained copies; automatic reopening of all tabs across application launches is not promised. Data is stored separately under the user's `Analog Canvas Preview` application-data directory.

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
```

The package script writes a new timestamped folder under `output/`, retains Electron's license files, and includes `source.zip`, `LICENSE.md`, the original fork notice and the [source/adaptation inventory](SOURCES.md). `plan/preview-package.json` identifies the latest local package for acceptance. The acceptance script uses an isolated application-data directory, intercepts native dialog choices in the test process, writes real files and relaunches the packaged executable.

The shell is adapted from **LXY-freshman / Schematic Draft** under AGPL-3.0-only. [The retained original notice](upstream-NOTICE.md) describes that historical fork, not the current preview's feature set. See [SOURCES.md](SOURCES.md) for fixed source links and attribution.

## Preview distribution

Download `analog-canvas-desktop-windows-x64.zip` from a **Desktop Preview** entry in [GitHub Releases](https://github.com/cascode-ai/analog-canvas/releases). Extract the whole ZIP, then run `Analog Canvas Preview/Analog Canvas Preview.exe` inside the extracted preview directory. No Node.js, pnpm or developer tools are required. The executable needs its sibling resources; distributing the `.exe` alone will not work. GitHub's automatically generated source archives are source code, not the runnable application.

The merge queue runs the [Windows packaging and acceptance workflow](../../.github/workflows/desktop-preview.yml) alongside the existing core suite. The required **Core contracts** check fails if either fails. This checks the real packaged executable without publishing it. Queue artifacts are temporary review downloads.

After merging, run [Desktop preview release](../../.github/workflows/desktop-release.yml) from Actions with the merged commit as `ref`. Keep `publish` off to inspect an unpublished Actions artifact, or enable it to publish the accepted ZIP as a GitHub prerelease. The workflow rejects commits outside `main`, rebuilds and validates the exact selected commit, and uses a `desktop-preview-…` tag that does not match the Web deployment's `v*` tags. It does not replace existing releases or mark the preview as Latest.

The ZIP includes `ACCEPTANCE.json` and `preview.png` from the packaged run, corresponding source and attribution. This distribution step does not add signing, an installer or native Save semantics; the preview limitations above still apply.
