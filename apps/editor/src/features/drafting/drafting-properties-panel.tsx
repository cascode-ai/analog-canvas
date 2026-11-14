import { useMemo } from "react";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import { flattenRichText } from "@icm/model";
import { resolveVisualAnchor } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { AnnotationPropertyCodeEditor } from "../properties/annotation-property-code-editor";
import {
  draftingPropertyValue,
  parseDraftingPropertyCode,
  serializeAnnotationPropertyCode,
  type DraftingPropertyEdit,
} from "../properties/annotation-property-code";
import { annotationPropertyAdapter } from "../properties/annotation-property-code-assists";
import { isClosedPolyline } from "./drafting-polyline";
import type { DraftingStackingTarget } from "./drafting-manipulation";

export interface DraftingPropertiesPanelProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  object: DraftingObject;
  grid: number;
  defaultColor: string;
  onApply(edit: DraftingPropertyEdit): { ok: boolean; message?: string };
  onStackingChange(target: DraftingStackingTarget): void;
  onToggleLock(): void;
}

export function DraftingPropertiesPanel({
  document,
  resolver,
  object,
  grid,
  defaultColor,
  onApply,
  onStackingChange,
  onToggleLock,
}: DraftingPropertiesPanelProps) {
  const context = useMemo(
    () => ({ document, resolver, object, grid }),
    [document, resolver, object, grid],
  );
  const closed = object.kind === "rectangle" || object.kind === "circle";
  const adapter = useMemo(
    () =>
      annotationPropertyAdapter(
        (source) => parseDraftingPropertyCode(source, context),
        closed,
        closed
          ? "Border"
          : object.kind === "text" || object.kind === "callout"
            ? "Text"
            : "Stroke",
      ),
    [context, closed],
  );
  const baseline = serializeAnnotationPropertyCode(
    draftingPropertyValue(context),
  );
  const position = resolveVisualAnchor(
    document,
    resolver,
    object.anchor,
  ).position;
  const title =
    object.kind === "text" &&
    (object.polarity === "positive" || object.polarity === "negative")
      ? "Polarity mark"
      : object.kind === "arrow" && object.waypoints?.length
        ? isClosedPolyline(object)
          ? "Polygon"
          : "Polyline"
        : object.kind
            .replaceAll("-", " ")
            .replace(/^./u, (letter) => letter.toUpperCase());
  return (
    <section
      className="property-section"
      aria-label="Drawing properties"
      data-testid="drafting-properties"
    >
      <AnnotationPropertyCodeEditor
        item={{
          type:
            object.kind === "floating-symbol" ? object.symbolId : object.kind,
          name:
            "content" in object ? flattenRichText(object.content) : object.id,
          coordinate: [position.x, position.y],
        }}
        baseline={baseline}
        adapter={adapter}
        parse={(source) => parseDraftingPropertyCode(source, context)}
        format={({ object, layer }) =>
          serializeAnnotationPropertyCode(
            draftingPropertyValue({ ...context, object }, layer),
          )
        }
        onApply={onApply}
        defaultColor={defaultColor}
        title={title}
        actions={
          <>
            {closed && (
              <div className="drawing-stacking-control">
                <div>
                  <button
                    type="button"
                    disabled={object.locked}
                    onClick={() => onStackingChange("front")}
                  >
                    Bring to front
                  </button>
                  <button
                    type="button"
                    disabled={object.locked}
                    onClick={() => onStackingChange("back")}
                  >
                    Send to back
                  </button>
                </div>
                <small>
                  Layer shows which side of the circuit this shape is on. Fill
                  “auto” is transparent.
                </small>
              </div>
            )}
            <button type="button" onClick={onToggleLock}>
              {object.locked ? "Unlock" : "Lock"}
            </button>
          </>
        }
      />
    </section>
  );
}
