import {
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  instanceLabelSlotAt,
  objectStyleProfile,
  offsetFromPlacement,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  type InstanceLabelPlacement,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import {
  canonicalInstanceLabelRow,
  canonicalLabelSlot,
  instanceAnnotationSlot,
  valueShownUnderName,
} from "./transaction-instance-annotations.js";

/**
 * A caller's labels, moved from where its Cell's former block put them to
 * the same place on the new block (#1366). A block whose Pins change sides
 * can grow wider or taller: a caller's Cell name stood under the old block
 * while its slot moved five units, and a block widened east over a name an
 * earlier arrangement had put on its east side. A label in one of the
 * former block's default rows takes that row on the new block, as a Signal
 * Flow resize reflows its block's labels; one on a side where an
 * arrangement puts a part's labels takes the same side and row. A label
 * anywhere else, moved by hand or slid along a side, keeps its offset.
 */
export function planInstanceLabelReflow(
  document: SchematicDocument,
  instanceIds: ReadonlySet<string>,
  formerResolver: SymbolResolver,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const documentProfile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const edits: SchematicEdit[] = [];
  for (const annotation of document.annotations) {
    const slot = instanceAnnotationSlot(annotation);
    if (
      !slot ||
      annotation.anchor.kind !== "object" ||
      !instanceIds.has(annotation.anchor.objectId) ||
      annotation.locked ||
      annotation.rotation !== 0
    )
      continue;
    const anchor = annotation.anchor;
    const instance = document.instances.find(
      (item) => item.id === anchor.objectId,
    );
    if (!instance?.placement) continue;
    const former = formerResolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const current = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!former || !current) continue;
    const profile = objectStyleProfile(documentProfile, annotation);
    const sizeScale = annotation.sizeScale ?? 1;
    const position = instance.placement.position;
    const drawn: InstanceLabelPlacement = {
      position: {
        x: position.x + anchor.localOffset.x,
        y: position.y + anchor.localOffset.y,
      },
      alignment: annotation.alignment,
    };
    const parameter =
      annotation.binding?.kind === "instance-value"
        ? annotation.binding.parameter
        : undefined;
    let next: InstanceLabelPlacement | null = null;
    const row = canonicalInstanceLabelRow(
      annotation,
      instance,
      former,
      document,
      position,
      instance.placement,
    );
    if (row !== null)
      next = parameter
        ? defaultInstanceParameterLabelPlacement(
            instance,
            current,
            profile,
            grid,
            parameter,
          )
        : defaultInstanceLabelPlacement(
            instance,
            current,
            profile,
            grid,
            canonicalLabelSlot(
              slot,
              row,
              valueShownUnderName(
                document,
                instance,
                former,
                position,
                instance.placement,
              ),
            ),
            sizeScale,
          );
    else if (!parameter) {
      const found = instanceLabelSlotAt(
        instance,
        former,
        profile,
        grid,
        drawn,
        sizeScale,
      );
      next =
        found &&
        placeUprightInstanceLabel(
          instance,
          current,
          profile,
          { x: 0, y: 0 },
          found.side,
          grid,
          sizeScale,
          found.slot,
        );
    }
    if (!next || offsetFromPlacement(drawn, next)) continue;
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        ...annotation,
        alignment: next.alignment,
        anchor: {
          ...anchor,
          localOffset: {
            x: next.position.x - position.x,
            y: next.position.y - position.y,
          },
          fallbackPosition: next.position,
        },
      },
    });
  }
  return edits;
}
