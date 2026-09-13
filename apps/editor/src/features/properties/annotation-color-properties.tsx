import { useMemo } from "react";
import type { Annotation } from "@icm/model";
import { AnnotationPropertyCodeEditor } from "./annotation-property-code-editor";
import {
  annotationPropertyAdapter,
  annotationPropertyValue,
  parseAnnotationPropertyCode,
  serializeAnnotationPropertyCode,
} from "./annotation-property-code";

export function AnnotationColorProperties({
  annotation,
  inheritedColor,
  onApply,
}: {
  annotation: Annotation;
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
  return (
    <section
      className="property-section annotation-text-properties"
      aria-label="Text properties"
    >
      <AnnotationPropertyCodeEditor
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
