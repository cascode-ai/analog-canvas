import type { CircuitProject, GridRect } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { normalizeImportedProject } from "../../document/project-import-normalization";
import type { ReplaceProjectOptions } from "../../document/use-project-file-lifecycle";
import type { LibraryProjectExample } from "../../examples/library-examples";
import {
  clipboardPlacementAnchor,
  type SchematicClipboard,
} from "../clipboard/clipboard";
import { captureProjectCopy } from "../clipboard/project-copy";

export interface GalleryEntryContext {
  id: string;
  name: string;
  projectId: string;
  ownerUserId: string | null;
  author: string;
  description: string;
  tags: readonly string[];
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
  guardDirtyReplacement,
  beginCopyPlacement,
  cancelAllTransientInteraction,
  setGalleryEntryContext,
  setStatus,
  fetchImpl = fetch,
}: GalleryExampleCommandDependencies) {
  const repairOnOpen = (imported: CircuitProject): CircuitProject =>
    normalizeImportedProject(
      imported,
      createProjectSymbolResolver(imported, builtInSymbols),
    ).project;

  const beginProjectImportPlacement = (
    imported: CircuitProject,
    label: string,
  ): boolean => {
    const normalized = repairOnOpen(imported);
    const importedDocument = normalized.documents.find(
      (candidate) => candidate.id === normalized.topDocumentId,
    );
    if (!importedDocument) return false;
    const clipboard = captureProjectCopy(normalized, importedDocument);
    const anchor = clipboard ? clipboardPlacementAnchor(clipboard) : null;
    if (!clipboard || !anchor) return false;
    try {
      cancelAllTransientInteraction();
      beginCopyPlacement(clipboard, anchor);
    } catch (error) {
      setStatus(
        `Cannot copy ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    setStatus(
      `Place ${label} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
    return true;
  };

  const installGalleryEntry = async (
    entryId: string,
    projectText: string,
    payload: GalleryEntryPayload,
    protectCurrentProject: boolean,
    opened: (name: string) => string,
  ): Promise<void> => {
    const galleryProject = repairOnOpen(parseProject(projectText));
    const name = payload.entry?.name ?? galleryProject.name;
    const sourceDigest = await textDigest(projectText);
    const install = () => {
      replaceActiveProject(galleryProject, defaultViewBox);
      setGalleryEntryContext({
        id: entryId,
        name,
        projectId: galleryProject.id,
        ownerUserId: payload.ownerUserId ?? null,
        author: payload.entry?.author ?? "",
        description: payload.entry?.description ?? "",
        tags: payload.entry?.tags ?? [],
        ...(sourceDigest ? { sourceDigest } : {}),
      });
      setStatus(opened(name));
    };
    if (protectCurrentProject) {
      await guardDirtyReplacement(`Open gallery circuit ${name}`, install);
    } else {
      install();
    }
  };

  const openGalleryEntryById = async (
    entryId: string,
    protectCurrentProject = true,
  ): Promise<void> => {
    try {
      const response = await fetchImpl(`/api/gallery/${entryId}`, {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setStatus("Sign in to open Community Gallery circuits");
        return;
      }
      if (!response.ok) {
        setStatus("This gallery entry is unavailable");
        return;
      }
      const payload = (await response.json()) as GalleryEntryPayload;
      if (!payload.projectText) {
        setStatus("This gallery entry is unavailable");
        return;
      }
      await installGalleryEntry(
        entryId,
        payload.projectText,
        payload,
        protectCurrentProject,
        (name) => `Opened gallery circuit: ${name}`,
      );
    } catch {
      setStatus("This gallery entry is unavailable");
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
    try {
      const response = await fetchImpl(`/api/gallery/${entryId}`, {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setStatus("Sign in to insert Community Gallery circuits");
        return;
      }
      const payload = response.ok
        ? ((await response.json()) as GalleryEntryPayload)
        : null;
      if (!payload?.projectText) {
        setStatus("This gallery entry is unavailable");
        return;
      }
      const imported = parseProject(payload.projectText);
      const label = payload.entry?.name ?? imported.name;
      if (beginProjectImportPlacement(imported, label)) return;
      // An empty scene has no placeable fragment; it can still be opened.
      await openGalleryEntryById(entryId);
    } catch {
      setStatus("This gallery entry is unavailable");
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
