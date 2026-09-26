# Schematic Draft — attribution and licensing

Schematic Draft is an offline desktop build of **Analog Canvas**, an
open-source schematic editor.

- Upstream project: Analog Canvas — https://github.com/cascode-ai/analog-canvas
- Upstream author: cascode-ai
- License: GNU Affero General Public License, version 3 (see `LICENSE.md`)

This build is a modified version of that program. The modifications turn the
hosted web application into a desktop application that runs entirely on one
computer:

- the editor is served from bundled files over a private `app://` scheme
  instead of a web server;
- a Project is an ordinary file on your disk — `.schdraft`, or the portable
  `.icproj.json` interchange form — opened and saved through the native file
  dialogs, wherever you keep it, instead of a cloud account;
- every outbound network request is refused before a connection is made;
- the hosted-only code (accounts, Cloud Projects, Gallery and moderation,
  publishing, usage analytics, the Agent API and its MCP server, and the hosted
  simulation service) is deleted, not merely hidden.

## Your rights under the AGPL

The AGPL gives you the right to obtain, study, modify and redistribute the
complete corresponding source code of this program, including the
modifications listed above. The source tree that produced this build ships
alongside it, under `source\`, and is published at

- https://github.com/LXY-freshman/schematic-draft

If you received a binary without either, the upstream
project above plus this notice describe what changed. The desktop shell is
`apps/desktop/**`; the file open/save surface is
`apps/editor/src/features/editor-shell/**`; the rest of the difference is
deletion, visible as absence.

If you redistribute this program, modified or not, you must pass the same
rights on and keep this notice and `LICENSE.md` intact.

## Bundled third-party software

- Electron and the Chromium runtime it embeds, under their respective licenses
  (`LICENSE` and `LICENSES.chromium.html` in the installation directory).
- The libraries listed in the upstream project's `package.json` files, bundled
  into the editor assets under their own licenses.

The application icon is an original work made for this build and is licensed
under the AGPL-3.0 along with the rest of the program.
