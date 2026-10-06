import {
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  instanceValueRowOffset,
  objectStyleProfile,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import {
  canonicalInstanceLabelRow,
  instanceAnnotationSlot,
  valueShownUnderName,
} from "./transaction-instance-annotations.js";

const SIDES: readonly InstanceLabelSide[] = ["right", "left", "bottom", "top"];

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
    const visible = {
      x: position.x + anchor.localOffset.x,
      y: position.y + anchor.localOffset.y,
    };
    const at = (candidate: InstanceLabelPlacement | null) =>
      candidate !== null &&
      candidate.alignment === annotation.alignment &&
      Math.hypot(
        candidate.position.x - visible.x,
        candidate.position.y - visible.y,
      ) < 0.01;
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
    const valueRow = instanceValueRowOffset(instance.symbolId, profile, grid);
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
            row === 0 ? "reference" : slot,
            sizeScale,
            slot === "reference" &&
              valueShownUnderName(
                document,
                instance,
                former,
                position,
                instance.placement,
              ),
          );
    else if (!parameter)
      search: for (const side of SIDES)
        // A label's row, and above the part a name's place over its value
        // (#1384), which is also where a value stood over its name before.
        for (const [rowOffset, rowsBelow] of [
          [0, 0],
          [valueRow, 0],
          [0, valueRow],
        ] as const) {
          const placed = (symbol: typeof current) =>
            placeUprightInstanceLabel(
              instance,
              symbol,
              profile,
              { x: 0, y: 0 },
              side,
              grid,
              sizeScale,
              rowOffset,
              false,
              rowsBelow,
            );
          if (!at(placed(former))) continue;
          next = placed(current);
          break search;
        }
    if (!next || at(next)) continue;
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
