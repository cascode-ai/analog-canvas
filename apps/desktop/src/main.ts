// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// Original author: LXY-freshman. See ../SOURCES.md for exact source and changes.
import { mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, Menu, protocol, session } from "electron";
import {
  APP_ORIGIN,
  APP_SCHEME,
  createAppProtocolHandler,
} from "./app-protocol.js";
import { createExportHandler } from "./export-file.js";

const PRODUCT_NAME = "Analog Canvas Preview";
const auditPath = process.env.ICM_PREVIEW_AUDIT;
function audit(url: string) {
  if (auditPath) appendFileSync(auditPath, `${JSON.stringify({ url })}\n`);
}
// Separate from Web and other desktop installations. Tests supply their own root.
const userData =
  process.env.ICM_PREVIEW_USER_DATA ??
  join(app.getPath("appData"), "Analog Canvas Preview");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setName(PRODUCT_NAME);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function lockDownNetwork() {
  const current = session.defaultSession;
  current.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      const local =
        details.url.startsWith(`${APP_ORIGIN}/`) ||
        details.url.startsWith(`blob:${APP_ORIGIN}/`) ||
        details.url.startsWith("data:");
      callback({ cancel: !local });
      audit(details.url);
    },
  );
  current.setPermissionRequestHandler((_, permission, callback) =>
    callback(
      permission === "clipboard-read" ||
        permission === "clipboard-sanitized-write",
    ),
  );
  current.setPermissionCheckHandler(
    (_, permission) =>
      permission === "clipboard-read" ||
      permission === "clipboard-sanitized-write",
  );
  current.setSpellCheckerEnabled(false);
}

async function createWindow() {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#1e3d36",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  let deciding = false;
  // Deliberately conservative: does not claim coordinated multi-tab native Save.
  window.on("close", (event) => {
    event.preventDefault();
    if (deciding) return;
    deciding = true;
    void dialog
      .showMessageBox(window, {
        type: "question",
        title: PRODUCT_NAME,
        message: "Have you exported every project you want to keep?",
        detail:
          "This preview exports copies and does not save files in place. Recovery is a safety copy only. Keep the window open to export any remaining work.",
        buttons: ["Keep open", "Close preview"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        deciding = false;
        if (response === 1 && !window.isDestroyed()) window.destroy();
      })
      .catch(() => {
        deciding = false;
      });
  });
  await window.loadURL(`${APP_ORIGIN}/editor`);
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      lockDownNetwork();
      session.defaultSession.on("will-download", (_, item) =>
        item.setSaveDialogOptions({ title: `Export ${item.getFilename()}` }),
      );
      const exportFile = createExportHandler(async (name) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) return null;
        const result = await dialog.showSaveDialog(window, {
          title: "Export a copy",
          defaultPath: join(app.getPath("documents"), name),
        });
        return result.canceled ? null : (result.filePath ?? null);
      });
      const handler = await createAppProtocolHandler({
        editorRoot: app.isPackaged
          ? join(process.resourcesPath, "editor")
          : resolve(import.meta.dirname, "../../editor/dist-desktop"),
        exportFile,
      });
      protocol.handle(APP_SCHEME, (request) => {
        audit(`${request.url}`);
        return handler(request);
      });
      await createWindow();
    })
    .catch((error) => {
      dialog.showErrorBox("Desktop preview could not start", String(error));
      app.exit(1);
    });
  app.on("window-all-closed", () => app.quit());
}
