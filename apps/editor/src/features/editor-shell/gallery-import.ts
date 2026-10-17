import { draftingCoverColor, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { normalizeImportedProject } from "../../document/project-import-normalization";
import { clipboardPlacementAnchor } from "../clipboard/copy-placement";
import { captureProjectCopy } from "../clipboard/project-copy";

/**
 * GUI and Agent insert the same normalized drawing with the same grab point.
 * A white mask an older entry still holds is left out: drafting in the
 * sheet's own color may not be created, so keeping it refused the whole
 * insertion (2026-10-17). One that a label anchors to stays.
 */
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
  const anchored = new Set(
    document.annotations.flatMap((annotation) =>
      annotation.anchor.kind === "object" ? [annotation.anchor.objectId] : [],
    ),
  );
  const covers = (document.drafting?.objects ?? []).filter(
    (object) => draftingCoverColor(object) && !anchored.has(object.id),
  );
  if (document.drafting && covers.length)
    document.drafting.objects = document.drafting.objects.filter(
      (object) => !covers.includes(object),
    );
  const clipboard = captureProjectCopy(normalized, document);
  const anchor = clipboard ? clipboardPlacementAnchor(clipboard) : null;
  return clipboard && anchor
    ? { clipboard, anchor, sourceDocumentId, coversLeftOut: covers.length }
    : null;
}
