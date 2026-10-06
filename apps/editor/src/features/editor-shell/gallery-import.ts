import type { CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { normalizeImportedProject } from "../../document/project-import-normalization";
import { clipboardPlacementAnchor } from "../clipboard/clipboard";
import { captureProjectCopy } from "../clipboard/project-copy";

/** GUI and Agent insert the same normalized drawing with the same grab point. */
export function captureGalleryDrawing(
  imported: CircuitProject,
  sourceDocumentId = imported.topDocumentId,
) {
  const normalized = normalizeImportedProject(
    imported,
    createProjectSymbolResolver(imported, builtInSymbols),
  ).project;
  const document = normalized.documents.find(
    (item) => item.id === sourceDocumentId,
  );
  if (!document)
    throw new Error("The source Cell does not exist in this Gallery entry");
  const clipboard = captureProjectCopy(normalized, document);
  const anchor = clipboard ? clipboardPlacementAnchor(clipboard) : null;
  return clipboard && anchor ? { clipboard, anchor, sourceDocumentId } : null;
}
