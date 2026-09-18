import type { CircuitProject, GridRect } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { normalizeImportedProjectConductors } from "../../document/project-conductor-normalization";
import type { ReplaceProjectOptions } from "../../document/use-project-file-lifecycle";
import {
  createLibraryExampleProject,
  type LibraryProjectExample,
} from "../../examples/library-examples";
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
  const normalizeImportedProject = (imported: CircuitProject): CircuitProject =>
    normalizeImportedProjectConductors(
      imported,
      createProjectSymbolResolver(imported, builtInSymbols),
    ).project;

  const beginProjectImportPlacement = (
    imported: CircuitProject,
    label: string,
  ): boolean => {
    const normalized = normalizeImportedProject(imported);
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

  const openGalleryEntryById = async (
    entryId: string,
    protectCurrentProject = true,
  ): Promise<void> => {
    try {
      const response = await fetchImpl(`/api/gallery/${entryId}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setStatus("This gallery entry is unavailable");
        return;
      }
      const payload = (await response.json()) as GalleryEntryPayload;
      if (!payload.projectText) {
        setStatus("This gallery entry is unavailable");
        return;
      }
      const galleryProject = normalizeImportedProject(
        parseProject(payload.projectText),
      );
      const name = payload.entry?.name ?? galleryProject.name;
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
        });
        setStatus(`Opened gallery circuit: ${name}`);
      };
      if (protectCurrentProject) {
        await guardDirtyReplacement(`Open gallery circuit ${name}`, install);
      } else {
        install();
      }
    } catch {
      setStatus("This gallery entry is unavailable");
    }
  };

  const openLibraryExample = (example: LibraryProjectExample): void => {
    const source = createLibraryExampleProject(example.id);
    if (!source) {
      setStatus(`Example is unavailable: ${example.name}`);
      return;
    }
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
    openLibraryExample,
    insertGalleryEntryById,
  };
}
