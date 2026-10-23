import type { CircuitProject, GridRect } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { normalizeImportedProject } from "../../document/project-import-normalization";
import type { ReplaceProjectOptions } from "../../document/use-project-file-lifecycle";
import type { LibraryProjectExample } from "../../examples/library-examples";
import type { SchematicClipboard } from "../clipboard/clipboard";
import {
  dailyOpenLimit,
  type GalleryDailyOpenLimit,
} from "../../gallery-client";
import { GRID_INCOMPATIBLE } from "../clipboard/paste-proposal";
import { OFFLINE_FAILURE, requestFailureOf } from "../../request-failure";
import { captureGalleryDrawing } from "./gallery-import";

export interface GalleryEntryContext {
  id: string;
  name: string;
  projectId: string;
  ownerUserId: string | null;
  author: string;
  description: string;
  tags: readonly string[];
  /** The entry's AI mark; the update dialog starts from it. */
  aiGenerated?: boolean;
  /**
   * SHA-256 of the stored text this copy was opened from, so a later visit
   * can tell whether the Gallery has changed the entry since.
   */
  sourceDigest?: string;
}

interface GalleryEntryPayload {
  entry?: {
    name?: string;
    author?: string;
    description?: string;
    tags?: string[];
    aiGenerated?: boolean;
  };
  ownerUserId?: string | null;
  projectText?: string;
}

export interface GalleryExampleCommandDependencies {
  defaultViewBox: GridRect;
  prepareLibraryExample?: (project: CircuitProject) => CircuitProject;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox?: GridRect,
    options?: ReplaceProjectOptions,
  ) => unknown;
  openProjectInTab?: (
    project: CircuitProject,
    viewBox: GridRect,
    context: GalleryEntryContext,
  ) => Promise<boolean>;
  guardDirtyReplacement: (
    intent: string,
    perform: () => void | Promise<void>,
  ) => Promise<void>;
  beginCopyPlacement: (
    clipboard: SchematicClipboard,
    anchor: { x: number; y: number },
  ) => void;
  cancelAllTransientInteraction: () => void;
  setGalleryEntryContext: (context: GalleryEntryContext) => void;
  setStatus: (status: string) => void;
  /**
   * The card saying the account has opened its share of Gallery circuits for
   * the day; null clears one an earlier attempt left.
   */
  setDailyOpenLimit: (limit: GalleryDailyOpenLimit | null) => void;
  fetchImpl?: typeof fetch;
}

async function textDigest(text: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Owns Gallery and bundled-example project loading decisions. React keeps the
 * panel/dialog state, while this facade owns fetch/parse, guarded replacement,
 * and the single-Document import-to-clipboard boundary.
 */
export function createGalleryExampleCommands({
  defaultViewBox,
  prepareLibraryExample = (project) => project,
  replaceActiveProject,
  openProjectInTab,
  guardDirtyReplacement,
  beginCopyPlacement,
  cancelAllTransientInteraction,
  setGalleryEntryContext,
  setStatus,
  setDailyOpenLimit,
  fetchImpl = fetch,
}: GalleryExampleCommandDependencies) {
  const repairOnOpen = (imported: CircuitProject): CircuitProject =>
    normalizeImportedProject(
      imported,
      createProjectSymbolResolver(imported, builtInSymbols),
    ).project;

  /**
   * Starts placing `imported`: "placing", "none" when it has nothing to
   * place, or the grid a drawing on a finer grid than this canvas cannot be
   * placed on.
   */
  const startProjectImportPlacement = (
    imported: CircuitProject,
    label: string,
  ): "placing" | "none" | { targetGrid: number } => {
    const drawing = captureGalleryDrawing(imported);
    if (!drawing) return "none";
    try {
      cancelAllTransientInteraction();
      beginCopyPlacement(drawing.clipboard, drawing.anchor);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const grid = message.includes(GRID_INCOMPATIBLE)
        ? /target grid (\d+)/u.exec(message)?.[1]
        : undefined;
      if (grid) return { targetGrid: Number(grid) };
      setStatus(`Cannot copy ${label}: ${message}`);
      return "placing";
    }
    setStatus(
      `Place ${label} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels${
        drawing.coversLeftOut
          ? ` · left out ${drawing.coversLeftOut} white mask${drawing.coversLeftOut === 1 ? "" : "s"}`
          : ""
      }`,
    );
    return "placing";
  };

  const beginProjectImportPlacement = (
    imported: CircuitProject,
    label: string,
  ): boolean => {
    const placement = startProjectImportPlacement(imported, label);
    if (typeof placement === "object")
      setStatus(
        `Cannot copy ${label}: it is drawn off this canvas's grid ${placement.targetGrid}`,
      );
    return placement !== "none";
  };

  const installGalleryEntry = async (
    entryId: string,
    projectText: string,
    payload: GalleryEntryPayload,
    protectCurrentProject: boolean,
    opened: (name: string) => string,
    inTab = false,
  ): Promise<void> => {
    const galleryProject = repairOnOpen(parseProject(projectText));
    const name = payload.entry?.name ?? galleryProject.name;
    const sourceDigest = await textDigest(projectText);
    const context: GalleryEntryContext = {
      id: entryId,
      name,
      projectId: galleryProject.id,
      ownerUserId: payload.ownerUserId ?? null,
      author: payload.entry?.author ?? "",
      description: payload.entry?.description ?? "",
      tags: payload.entry?.tags ?? [],
      aiGenerated: payload.entry?.aiGenerated === true,
      ...(sourceDigest ? { sourceDigest } : {}),
    };
    if (inTab) {
      if (!openProjectInTab) {
        setStatus("Project tabs are unavailable; the current circuit was kept");
        return;
      }
      if (await openProjectInTab(galleryProject, defaultViewBox, context)) {
        setStatus(opened(name));
      }
      return;
    }
    const install = () => {
      replaceActiveProject(galleryProject, defaultViewBox);
      setGalleryEntryContext(context);
      setStatus(opened(name));
    };
    if (protectCurrentProject) {
      await guardDirtyReplacement(`Open gallery circuit ${name}`, install);
    } else {
      install();
    }
  };

  /**
   * The entry's stored text, or null once the status line (or the daily
   * limit card) says why it could not be read.
   */
  const readGalleryEntry = async (
    entryId: string,
    signInStatus: string,
  ): Promise<(GalleryEntryPayload & { projectText: string }) | null> => {
    let response: Response;
    try {
      response = await fetchImpl(`/api/gallery/${entryId}`, {
        credentials: "same-origin",
      });
    } catch {
      setStatus(OFFLINE_FAILURE.message);
      return null;
    }
    if (response.status === 401) {
      setStatus(signInStatus);
      return null;
    }
    const limited = await dailyOpenLimit(response);
    if (limited) {
      setDailyOpenLimit(limited);
      return null;
    }
    if (!response.ok) {
      const failure = await requestFailureOf(response);
      setStatus(
        failure.failure === "not-found"
          ? "This gallery entry is unavailable"
          : failure.message,
      );
      return null;
    }
    const payload = (await response
      .json()
      .catch(() => null)) as GalleryEntryPayload | null;
    if (!payload?.projectText) {
      setStatus("This gallery entry is unavailable");
      return null;
    }
    return { ...payload, projectText: payload.projectText };
  };

  /** A circuit that arrived but could not be opened says what is wrong. */
  const unopenable = (error: unknown) =>
    setStatus(
      `This gallery entry could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    );

  const openGalleryEntryById = async (
    entryId: string,
    protectCurrentProject = true,
    inTab = false,
  ): Promise<void> => {
    if (import.meta.env?.ICM_DESKTOP) return;
    setDailyOpenLimit(null);
    const payload = await readGalleryEntry(
      entryId,
      "Sign in to open Community Gallery circuits",
    );
    if (!payload) return;
    try {
      await installGalleryEntry(
        entryId,
        payload.projectText,
        payload,
        protectCurrentProject,
        (name) => `Opened gallery circuit: ${name}`,
        inTab,
      );
    } catch (error) {
      unopenable(error);
    }
  };

  /**
   * A Gallery link opens what the Gallery holds now. When a browser tab comes
   * back to a link it had open, its saved copy returns instead; the caller
   * passes that copy's entry only while it is untouched, and it is replaced
   * when the entry's stored text has changed since it was opened. Anything
   * that fails keeps the copy.
   */
  const refreshGalleryEntry = async (
    context: GalleryEntryContext,
  ): Promise<void> => {
    if (import.meta.env?.ICM_DESKTOP) return;
    try {
      const response = await fetchImpl(`/api/gallery/${context.id}`, {
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as GalleryEntryPayload;
      if (!payload.projectText) return;
      if (
        context.sourceDigest !== undefined &&
        context.sourceDigest === (await textDigest(payload.projectText))
      )
        return;
      await installGalleryEntry(
        context.id,
        payload.projectText,
        payload,
        true,
        (name) => `Opened the current Gallery version of ${name}`,
      );
    } catch {
      // The copy in hand stays.
    }
  };

  const openLibraryExample = (example: LibraryProjectExample): void => {
    const source = structuredClone(example.project);
    const exampleProject = prepareLibraryExample(source);
    if (beginProjectImportPlacement(exampleProject, example.name)) return;
    void guardDirtyReplacement(`Open ${example.name} example`, () => {
      replaceActiveProject(exampleProject);
      setStatus(`Opened example: ${example.name}`);
    });
  };

  const insertGalleryEntryById = async (entryId: string): Promise<void> => {
    if (import.meta.env?.ICM_DESKTOP) return;
    setDailyOpenLimit(null);
    const payload = await readGalleryEntry(
      entryId,
      "Sign in to insert Community Gallery circuits",
    );
    if (!payload) return;
    try {
      const imported = parseProject(payload.projectText);
      const label = payload.entry?.name ?? imported.name;
      const placement = startProjectImportPlacement(imported, label);
      if (placement === "placing") return;
      if (typeof placement === "object") {
        // A drawing on a finer grid has parts off this canvas's grid, and a
        // placement never moves electrical geometry to fit: it opens beside
        // the canvas instead of failing at the click (2026-10-17).
        const sourceGrid = imported.documents.find(
          (document) => document.id === imported.topDocumentId,
        )?.presentation.grid;
        await openGalleryEntryById(entryId, true, true);
        setStatus(
          `${label} is drawn on grid ${sourceGrid ?? "?"}, finer than this canvas's grid ${placement.targetGrid}, so it cannot be placed here; it opened in a new tab`,
        );
        return;
      }
      // An empty scene has no placeable fragment; it can still be opened.
      await openGalleryEntryById(entryId);
    } catch (error) {
      unopenable(error);
    }
  };

  return {
    beginProjectImportPlacement,
    openGalleryEntryById,
    refreshGalleryEntry,
    openLibraryExample,
    insertGalleryEntryById,
  };
}
