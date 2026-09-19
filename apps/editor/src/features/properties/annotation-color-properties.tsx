import { useMemo } from "react";
import {
  flattenRichText,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import { resolveAnnotationText, resolveVisualAnchor } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { AnnotationPropertyCodeEditor } from "./annotation-property-code-editor";
import {
  annotationPropertyAdapter,
  annotationPropertyValue,
  parseAnnotationPropertyCode,
  serializeAnnotationPropertyCode,
} from "./annotation-property-code";

export function AnnotationColorProperties({
  annotation,
  document,
  resolver,
  inheritedColor,
  onApply,
}: {
  annotation: Annotation;
  document?: SchematicDocument;
  resolver?: SymbolResolver;
  inheritedColor: string;
  onApply(annotation: Annotation): { ok: boolean; message?: string };
}) {
  const adapter = useMemo(
    () =>
      annotationPropertyAdapter(
        (source) => parseAnnotationPropertyCode(source, annotation),
        false,
      ),
    [annotation],
  );
  const format = (value: Annotation) =>
    serializeAnnotationPropertyCode(annotationPropertyValue(value));
  const position =
    document && resolver
      ? resolveVisualAnchor(document, resolver, annotation.anchor).position
      : annotation.anchor.kind === "free"
        ? annotation.anchor.position
        : annotation.anchor.fallbackPosition;
  return (
    <section
      className="property-section annotation-text-properties"
      aria-label="Text properties"
    >
      <AnnotationPropertyCodeEditor
        item={{
          type: annotation.kind,
          name: document
            ? flattenRichText(resolveAnnotationText(document, annotation))
            : annotation.content
              ? flattenRichText(annotation.content)
              : annotation.id,
          coordinate: [position.x, position.y],
        }}
        baseline={format(annotation)}
        adapter={adapter}
        parse={(source) => parseAnnotationPropertyCode(source, annotation)}
        format={format}
        onApply={onApply}
        defaultColor={inheritedColor}
        title="Annotation"
      />
    </section>
  );
}
