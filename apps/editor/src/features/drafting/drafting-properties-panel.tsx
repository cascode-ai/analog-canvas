import { useMemo } from "react";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { AnnotationPropertyCodeEditor } from "../properties/annotation-property-code-editor";
import {
  annotationPropertyAdapter,
  draftingPropertyValue,
  parseDraftingPropertyCode,
  serializeAnnotationPropertyCode,
} from "../properties/annotation-property-code";
import type { DraftingStackingTarget } from "./drafting-manipulation";

export interface DraftingPropertiesPanelProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  object: DraftingObject;
  grid: number;
  defaultColor: string;
  onApply(object: DraftingObject): { ok: boolean; message?: string };
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
  const format = (next: DraftingObject) =>
    serializeAnnotationPropertyCode(
      draftingPropertyValue({ ...context, object: next }),
    );
  const title =
    object.kind === "text" &&
    (object.polarity === "positive" || object.polarity === "negative")
      ? "Polarity mark"
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
        baseline={format(object)}
        adapter={adapter}
        parse={(source) => parseDraftingPropertyCode(source, context)}
        format={format}
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
                  Background stays behind the circuit. Higher zIndex draws above
                  peers. Fill “auto” is transparent.
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
