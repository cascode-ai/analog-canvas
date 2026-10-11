// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// Original author: LXY-freshman. See ../SOURCES.md for exact source and changes.
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  session,
  shell,
} from "electron";
import {
  APP_ORIGIN,
  APP_SCHEME,
  createAppProtocolHandler,
} from "./app-protocol.js";
import { createExportHandler } from "./export-file.js";
import { createProjectFileHandler } from "./project-files.js";
import { createProjectLibrary } from "./project-library.js";
import { decideClose, workspaceCloseState } from "./close-guard.js";
import { createLaunchFileQueue } from "./launch-files.js";
import { createSystemHandler } from "./system-info.js";
import { windowsAssociation } from "./windows-association.js";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import {
  previewMigrationState,
  migratePreviewData,
  startFreshDesktopData,
  assertPreviousPreviewClosed,
} from "./preview-migration.js";

declare const __ICM_DESKTOP_BUILD__: {
  version: string;
  commit: string;
  dirty: boolean;
};

const PRODUCT_NAME = "Analog Canvas Preview";
const launchFiles = createLaunchFileQueue();
launchFiles.enqueue(process.argv);
// Packaged-executable acceptance attaches both debuggers before creating a
// renderer. Explicit executablePath skips Playwright's normal readiness loader.
const driver = globalThis as typeof globalThis & {
  __analogCanvasPreviewDriverReady?: () => void;
};
const driverReady =
  process.env.ICM_PREVIEW_WAIT_FOR_DRIVER === "1"
    ? new Promise<void>((resolve) => {
        driver.__analogCanvasPreviewDriverReady = () => {
          delete driver.__analogCanvasPreviewDriverReady;
          resolve();
        };
      })
    : Promise.resolve();
const auditPath = process.env.ICM_PREVIEW_AUDIT;
function audit(url: string) {
  if (auditPath) appendFileSync(auditPath, `${JSON.stringify({ url })}\n`);
}
// Separate from Web and other desktop installations. Tests supply their own root.
const userData =
  process.env.ICM_PREVIEW_USER_DATA ??
  join(app.getPath("appData"), "Analog Canvas");
const previousUserData =
  process.env.ICM_DESKTOP_LEGACY_DATA ??
  (process.env.ICM_PREVIEW_USER_DATA
    ? null
    : join(app.getPath("appData"), "Analog Canvas Preview"));
let migrationNotice =
  "Application data and project files stay outside the program directory. Previous preview data is preserved.";
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
    icon: app.isPackaged
      ? join(process.resourcesPath, "editor", "icon-192.png")
      : resolve(import.meta.dirname, "../../editor/dist-desktop/icon-192.png"),
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
  window.on("close", (event) => {
    event.preventDefault();
    if (deciding) return;
    deciding = true;
    void decideClose({
      readState: async () =>
        workspaceCloseState(
          await window.webContents.executeJavaScript(
            "window.__analogCanvasDesktop?.state() ?? null",
          ),
        ),
      ask: async (state) => {
        const { response } = await dialog.showMessageBox(window, {
          type: "question",
          title: PRODUCT_NAME,
          message: state
            ? "Save changes before closing?"
            : "The editor is not answering. Close without saving?",
          detail: state
            ? state.dirty.map((tab) => tab.name).join("\n")
            : "Keep the window open to retry. Closing may lose unsaved work.",
          buttons: ["Keep open", "Discard and close", "Save all and close"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return response === 2 ? "save" : response === 1 ? "discard" : "cancel";
      },
      save: async () => {
        const value = (await window.webContents.executeJavaScript(
          "window.__analogCanvasDesktop?.save() ?? { status: 'failed', message: 'The editor stopped answering' }",
        )) as { status?: unknown; message?: unknown } | null;
        return {
          status: typeof value?.status === "string" ? value.status : "failed",
          ...(typeof value?.message === "string"
            ? { message: value.message }
            : {}),
        };
      },
      reportFailure: async (message) => {
        await dialog.showMessageBox(window, {
          type: "warning",
          message: "The window stayed open",
          detail: message,
          buttons: ["OK"],
        });
      },
    })
      .then((decision) => {
        if (decision === "close" && !window.isDestroyed()) window.destroy();
      })
      .catch(() => {})
      .finally(() => {
        deciding = false;
      });
  });
  await window.loadURL(`${APP_ORIGIN}/editor`);
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    launchFiles.enqueue(argv);
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
    void window?.webContents
      .executeJavaScript("window.__analogCanvasDesktop?.openPending()")
      .catch(() => {});
  });
  app
    .whenReady()
    .then(async () => {
      await driverReady;
      const migration = await previewMigrationState(userData, previousUserData);
      if (migration === "pending") {
        await migratePreviewData(
          previousUserData ?? `${userData}-previous`,
          userData,
          assertPreviousPreviewClosed,
        );
        migrationNotice =
          "Completed the interrupted preview data import. The original data is preserved.";
      } else if (migration === "available" && previousUserData) {
        const choice = await dialog.showMessageBox({
          type: "question",
          title: "Previous desktop preview found",
          message:
            "Import the previous preview's settings, recent files and recovery data?",
          detail:
            "Close the previous preview first. Data is copied and checked before use; original project files and previous data are preserved.",
          buttons: [
            "Decide later and exit",
            "Import previous data",
            "Start fresh",
          ],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (choice.response === 0) {
          app.quit();
          return;
        }
        if (choice.response === 1) {
          await migratePreviewData(
            previousUserData,
            userData,
            assertPreviousPreviewClosed,
          );
          migrationNotice =
            "Imported previous preview data. Original data and external project files are preserved.";
        } else await startFreshDesktopData(userData);
      } else if (migration === "none") await startFreshDesktopData(userData);
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
      const library = createProjectLibrary({
        stateDirectory: userData,
        defaultRoot:
          process.env.ICM_DESKTOP_PROJECTS ??
          join(app.getPath("home"), "Analog Canvas", "Projects"),
      });
      const handler = await createAppProtocolHandler({
        editorRoot: app.isPackaged
          ? join(process.resourcesPath, "editor")
          : resolve(import.meta.dirname, "../../editor/dist-desktop"),
        exportFile,
        system: createSystemHandler({
          async info() {
            return {
              ...__ICM_DESKTOP_BUILD__,
              format: CURRENT_PROJECT_FILE_VERSION,
              userData,
              projectRoot: (await library.list()).root,
              packaged: app.isPackaged,
              migration: migrationNotice,
              association: app.isPackaged
                ? await windowsAssociation("read", process.execPath)
                : { enabled: false, otherInstallation: false },
            };
          },
          async association(action) {
            if (!app.isPackaged)
              throw new Error(
                "Use the packaged application to manage its file association",
              );
            const window = BrowserWindow.getAllWindows()[0];
            if (!window) throw new Error("Application window unavailable");
            const result = await dialog.showMessageBox(window, {
              type: "question",
              title: "Windows file association",
              message:
                action === "enable"
                  ? "Register .icproj project files with this installation?"
                  : "Remove this installation's .icproj registration?",
              detail:
                "Other JSON files keep their current application. Windows may ask you to select Analog Canvas when opening a project.",
              buttons: ["Cancel", "Continue"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (result.response !== 1) return { cancelled: true };
            return windowsAssociation(action, process.execPath);
          },
        }),
        projectFile: createProjectFileHandler(
          {
            takeLaunchFile: () => launchFiles.take(),
            async recoverCreation(path, canRetry) {
              const window = BrowserWindow.getAllWindows()[0];
              if (!window) return "cancel";
              const buttons = [
                "Cancel",
                "Choose new destination",
                ...(canRetry ? ["Retry previous destination"] : []),
              ];
              const result = await dialog.showMessageBox(window, {
                type: "warning",
                message: "An earlier save did not finish.",
                detail: `${path}\nChoosing a new destination preserves the earlier folder and all retained files.`,
                buttons,
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              return result.response === 1
                ? "new"
                : result.response === 2
                  ? "retry"
                  : "cancel";
            },
            async confirm(message) {
              const window = BrowserWindow.getAllWindows()[0];
              if (!window) return false;
              return (
                (
                  await dialog.showMessageBox(window, {
                    type: "warning",
                    message,
                    buttons: ["Cancel", "Continue"],
                    defaultId: 0,
                    cancelId: 0,
                    noLink: true,
                  })
                ).response === 1
              );
            },
            async promptDirectory() {
              const window = BrowserWindow.getAllWindows()[0];
              if (!window) return null;
              const result = await dialog.showOpenDialog(window, {
                title: "Choose project directory",
                properties: ["openDirectory", "createDirectory"],
              });
              return result.canceled ? null : (result.filePaths[0] ?? null);
            },
            async reveal(path) {
              shell.showItemInFolder(path);
            },
            async promptOpen() {
              const window = BrowserWindow.getAllWindows()[0];
              if (!window) return null;
              const result = await dialog.showOpenDialog(window, {
                title: "Open Project",
                properties: ["openFile"],
                filters: [
                  {
                    name: "Analog Canvas Project",
                    extensions: ["icproj", "icproj.json", "json"],
                  },
                ],
              });
              return result.canceled ? null : (result.filePaths[0] ?? null);
            },
            async promptSave(name, currentPath) {
              const window = BrowserWindow.getAllWindows()[0];
              if (!window) return null;
              let destination = join(
                currentPath ? dirname(currentPath) : app.getPath("documents"),
                name.replace(/\.icproj\.json$/iu, ".icproj"),
              );
              if (
                currentPath &&
                destination.toLowerCase() === currentPath.toLowerCase()
              )
                destination = destination.replace(
                  /\.icproj$/iu,
                  "-copy.icproj",
                );
              const result = await dialog.showSaveDialog(window, {
                title: "Save Project",
                defaultPath: destination,
                filters: [
                  {
                    name: "Analog Canvas Project",
                    extensions: ["icproj", "icproj.json"],
                  },
                ],
              });
              return result.canceled ? null : (result.filePath ?? null);
            },
          },
          join(userData, "recent-projects.json"),
          library,
        ),
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
