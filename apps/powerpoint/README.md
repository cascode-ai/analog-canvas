# Optional PowerPoint integration

This local Windows add-in launches the offline desktop editor from PowerPoint.
It is opt-in: web deployments and standalone desktop launches do not register
Office components or show a PowerPoint save button.

The slide stores a transparent vector picture and the complete editable
Project, displayed Cell and three earlier saved snapshots. Reopen a saved
presentation, select the picture and choose **Circuit Canvas → Edit circuit**.
Copying the picture retains its Project. See [the user guide](README.html) for
installation, editing, recovery and limitations.

## Build and package

Build on Windows x64 with desktop Microsoft 365 PowerPoint, the Office 15
interop and Extensibility assemblies, and the .NET Framework 4.x C# compiler.
These are checked by `build.ps1`. Use the repository's declared Node and pnpm
versions. There is no additional service, account or TeX dependency.

1. Run `pnpm install --frozen-lockfile`. Install Gitleaks 8.30.1 and set
   `GITLEAKS_BINARY` to its executable if it is not on PATH.
2. Commit the source and open desktop PowerPoint for native acceptance.
3. In PowerShell, run:

   ```powershell
   .\apps\powerpoint\package.ps1 `
     -Output '<new-output-directory>\CircuitCanvas'
   ```

The output ZIP contains the native add-in, per-user installer, complete desktop
runtime, license notices, corresponding source archive and build instructions.
Packaging freshly builds the desktop shell and renderer from the clean commit,
runs packaged desktop and native PowerPoint acceptance, imports the Project
extracted from a saved/reopened presentation into the editor, and scans the
complete distribution before creating the ZIP. A failing gate stops packaging.
Test presentations and profiles stay outside the distribution.
The build scripts never install or register the add-in. Run `install.cmd` from
the extracted folder in Windows File Explorer to opt in, with PowerPoint closed.
`uninstall.cmd` removes only this add-in's registration and retains user data.

For development, `build.ps1 -Output <directory>` builds the native components
without packaging or registering them. The native contract check is:

```powershell
.\apps\powerpoint\test.ps1 -Output '<new-test-output-directory>'
```

It uses a temporary presentation in a running PowerPoint instance and closes
only that test presentation. Its rendered red background demonstrates that
the picture is transparent while intentional white symbol fills stay opaque.

The actual desktop renderer/host acceptance, including acknowledgement failure,
new edits while saving and duplicate Project tabs, runs with:

```powershell
node apps/desktop/scripts/accept-powerpoint-close.mjs `
  '<desktop-output>\Analog-Canvas-Windows-x64\Analog Canvas Preview.exe' `
  apps/powerpoint/empty.icproj.json
```

## Boundaries

The [integration contract](../../docs/specs/powerpoint-local.md) defines Project
ownership, file exchange and storage. This package does not deploy the hosted
application or provide cloud simulation. Windows ARM, 32-bit Office, macOS and
web PowerPoint are unverified or unsupported. Office activation is per user;
enterprise policy may disable unsigned COM add-ins. Keep the installation
folder in place until uninstalling or registering a newer installation.

Existing drawing payloads use the same version-2 format and COM identity as
the earlier local integration. Installing replaces that registration for the
current user, while Projects and histories remain readable.
