import { useRef, useState } from "react";
import { createFormalExportSource } from "@icm/exporters";
import { annotationOwningInstanceId } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { VisualSelection } from "../selection/visual-selection";
import { prepareDocumentFormulaArtifacts } from "../text-editing/formula-artifacts";
import { importChunk } from "../../components/chunk-import";
import { describeExportFailure } from "../editor-shell/editor-export-commands";

export type VisualClipboardFormat = "png" | "svg";

/** Paint ownership only: never grow through a Logical Net or clone circuit data. */
export function visualClipboardObjectIds(
  document: SchematicDocument,
  selection: VisualSelection,
): Set<string> {
  const ids = new Set(Object.values(selection).flat());
  const owners = new Set([
    ...selection.instanceIds,
    ...selection.routeIds,
    ...selection.junctionIds,
  ]);
  for (const annotation of document.annotations) {
    const anchor = annotation.anchor;
    const owner = annotationOwningInstanceId(annotation);
    if (
      (owner !== undefined && owners.has(owner)) ||
      (anchor.kind === "object" && owners.has(anchor.objectId)) ||
      (anchor.kind === "route" && owners.has(anchor.routeId))
    )
      ids.add(annotation.id);
  }
  // A rectangle's label is a drafting child, not an electrical annotation.
  for (const object of document.drafting?.objects ?? []) {
    if (
      object.kind === "text" &&
      object.anchor.kind === "object" &&
      selection.draftingIds.includes(object.anchor.objectId)
    )
      ids.add(object.id);
  }
  for (const marker of document.noConnects) {
    const endpoint = marker.endpoint;
    if (owners.has(endpoint.instanceId)) ids.add(marker.id);
  }
  return ids;
}

export async function createSelectionClipboardBlob(
  format: VisualClipboardFormat,
  document: SchematicDocument,
  selection: VisualSelection,
  resolver: SymbolResolver,
): Promise<Blob> {
  const objectIds = visualClipboardObjectIds(document, selection);
  if (objectIds.size === 0)
    throw new Error("Select visible objects before copying");
  const prepared = await prepareDocumentFormulaArtifacts({
    ...document,
    annotations: document.annotations.filter((item) => objectIds.has(item.id)),
    ...(document.drafting
      ? {
          drafting: {
            ...document.drafting,
            objects: document.drafting.objects.filter((item) =>
              objectIds.has(item.id),
            ),
          },
        }
      : {}),
  });
  try {
    const source = createFormalExportSource(document, resolver, {
      title: document.name + " — selection",
      margin: 10,
      background: "transparent",
      objectIds,
    });
    const svg = new Blob([source.svg], { type: "image/svg+xml" });
    if (svg.size > 16_000_000)
      throw new Error("Selection is too large to copy; select fewer objects");
    if (format === "svg") return svg;
    const { rasterizeFormalSvgInBrowser } = await importChunk(
      "PNG export",
      () => import("@icm/exporters/browser-raster"),
    );
    const png = await rasterizeFormalSvgInBrowser(source, 3, {
      background: "transparent",
    });
    return new Blob([png.bytes as BlobPart], { type: "image/png" });
  } finally {
    prepared.release();
  }
}

/** Call synchronously from the gesture: Blob preparation runs inside ClipboardItem. */
export function writeSelectionClipboard(
  format: VisualClipboardFormat,
  document: SchematicDocument,
  selection: VisualSelection,
  resolver: SymbolResolver,
): Promise<void> {
  if (
    !globalThis.isSecureContext ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    return Promise.reject(
      new Error(
        "Clipboard images are unavailable here. Use HTTPS or localhost and a supported browser",
      ),
    );
  }
  const mime = format === "svg" ? "image/svg+xml" : "image/png";
  if (
    typeof ClipboardItem.supports === "function" &&
    !ClipboardItem.supports(mime)
  ) {
    return Promise.reject(
      new Error(
        format === "svg"
          ? "This browser cannot copy SVG images. Try Copy as PNG"
          : "This browser cannot copy PNG images",
      ),
    );
  }
  // Capture before any await: later document/selection changes cannot change the result.
  const data = createSelectionClipboardBlob(
    format,
    structuredClone(document),
    structuredClone(selection),
    resolver,
  );
  void data.catch(() => {}); // The clipboard may reject before it consumes the Blob promise.
  try {
    return navigator.clipboard.write([new ClipboardItem({ [mime]: data })]);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function useVisualClipboard({
  document,
  selection,
  resolver,
  report,
  onChunkLoadFailure,
}: {
  document: SchematicDocument;
  selection: VisualSelection;
  resolver: SymbolResolver;
  report: (message: string) => void;
  onChunkLoadFailure: (feature: string) => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const copy = (format: VisualClipboardFormat): void => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    report(`Copying selection as ${format.toUpperCase()}`);
    void writeSelectionClipboard(format, document, selection, resolver)
      .then(() => report(`Copied selection as ${format.toUpperCase()}`))
      .catch((error: unknown) => {
        const failure = describeExportFailure(error);
        report(
          error instanceof Error && error.name === "NotAllowedError"
            ? "Clipboard access was denied. Allow clipboard access and try again"
            : `Selection was not copied: ${failure.status}`,
        );
        if (failure.chunkFeature) onChunkLoadFailure(failure.chunkFeature);
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };
  return { busy, copy };
}
