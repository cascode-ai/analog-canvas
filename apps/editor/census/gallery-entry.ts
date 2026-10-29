import { createEmptyProject, type CircuitProject } from "@icm/model";
import { EditorDocumentController } from "../src/document/document-controller";
import { materializeRazaviProjectBulkConnections } from "../src/presentation/razavi-presentation";
import { createGalleryExampleCommands } from "../src/features/editor-shell/gallery-example-commands";
import {
  applyProjectCopyPlacement,
  planProjectCopyPlacement,
  prepareProjectCopy,
} from "../src/features/clipboard/project-copy";
import type { SchematicClipboard } from "../src/features/clipboard/clipboard";

type Failure = { status: "failed"; message: string };
type OpenResult = { status: "opened"; project: CircuitProject } | Failure;
type InsertResult =
  | {
      status: "inserted" | "new-tab" | "opened-empty";
      project: CircuitProject;
      adoptedGrid?: number;
    }
  | Failure;

/**
 * Local IO for the editor's existing Gallery commands. Kept in the harness so
 * an older ref executes its own open/capture/fallback code, not a copied newer
 * product helper. Preparing a placement and committing it remain separate,
 * just as the GUI prepares at Insert and commits at the first canvas click.
 */
async function exercise(projectText: string, operation: "open" | "insert") {
  const target = createEmptyProject("census-target", "Census");
  const document = target.documents[0]!;
  // Keep the comparison target fixed even if a ref changes the editor default.
  document.presentation.grid = 10;
  const controller = new EditorDocumentController(target);
  const host: {
    installed: CircuitProject | null;
    inTab: boolean;
    clipboard: SchematicClipboard | null;
    message: string;
  } = {
    installed: null,
    inTab: false,
    clipboard: null,
    message: "No project was installed",
  };
  const commands = createGalleryExampleCommands({
    defaultViewBox: { x: 0, y: 0, width: 960, height: 640 },
    fetchImpl: async () => Response.json({ projectText }),
    replaceActiveProject: (project) => {
      controller.replaceProject(
        materializeRazaviProjectBulkConnections(project).project,
      );
      host.installed = controller.project;
    },
    openProjectInTab: async (project) => {
      const tab = new EditorDocumentController(
        materializeRazaviProjectBulkConnections(project).project,
      );
      host.installed = tab.project;
      host.inTab = true;
      return true;
    },
    guardDirtyReplacement: async (_intent, perform) => {
      await perform();
    },
    beginCopyPlacement: (clipboard) => {
      prepareProjectCopy(target, document, clipboard);
      host.clipboard = clipboard;
    },
    cancelAllTransientInteraction: () => {},
    setGalleryEntryContext: () => {},
    setDailyOpenLimit: () => {},
    setStatus: (message) => {
      host.message = message;
    },
  });
  if (operation === "open")
    await commands.openGalleryEntryById("census-entry", false);
  else await commands.insertGalleryEntryById("census-entry");
  return { target, document, host };
}

/** Both paths have independent fresh canvases and independent parsed sources. */
export async function exerciseGalleryEntry(projectText: string): Promise<{
  open: OpenResult;
  insert: InsertResult;
}> {
  const opened = await exercise(projectText, "open");
  const open: OpenResult = opened.host.installed
    ? { status: "opened", project: opened.host.installed }
    : { status: "failed", message: opened.host.message };
  const { target, document, host } = await exercise(projectText, "insert");
  let insert: InsertResult;
  if (host.clipboard) {
    try {
      // Click at the captured grab point: preserve source coordinates (offset 0).
      const plan = planProjectCopyPlacement(
        target,
        document,
        host.clipboard,
        { x: 0, y: 0 },
        1,
      );
      const project = applyProjectCopyPlacement(plan);
      insert = {
        status: "inserted",
        project,
        ...(plan.adoptedGrid ? { adoptedGrid: plan.adoptedGrid } : {}),
      };
    } catch (error) {
      insert = {
        status: "failed",
        message: `Placement commit: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else if (host.installed) {
    insert = {
      status: host.inTab ? "new-tab" : "opened-empty",
      project: host.installed,
    };
  } else insert = { status: "failed", message: host.message };
  return { open, insert };
}
