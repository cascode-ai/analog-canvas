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
  annotationPropertyValue,
  parseAnnotationPropertyCode,
  serializeAnnotationPropertyCode,
  type PropertyResult,
} from "./annotation-property-code";
import { annotationPropertyAdapter } from "./annotation-property-code-assists";

/** Where a Net Label's code carries the name it renames its Net to. */
const NAME_FIELD = "netName";

/** An annotation edit, and for a Net Label the name its Net should take. */
interface AnnotationEdit {
  annotation: Annotation;
  name?: string;
}

export function AnnotationColorProperties({
  annotation,
  document,
  resolver,
  inheritedColor,
  onApply,
  onRename,
}: {
  annotation: Annotation;
  document?: SchematicDocument;
  resolver?: SymbolResolver;
  inheritedColor: string;
  onApply(annotation: Annotation): { ok: boolean; message?: string };
  /**
   * Renames a Net Label's Net, as editing the label's text does. Given, the
   * label's `name` in its code is editable; without it `name` stays
   * read-only (2026-10-18: a copied label's name seemed locked).
   */
  onRename?(name: string): { ok: boolean; message?: string };
}) {
  const name = document
    ? flattenRichText(resolveAnnotationText(document, annotation))
    : annotation.content
      ? flattenRichText(annotation.content)
      : annotation.id;
  const renames = Boolean(onRename) && annotation.kind === "net-label";
  const parse = useMemo(
    () =>
      (source: string): PropertyResult<AnnotationEdit> => {
        let code = source;
        let requested: string | undefined;
        if (renames) {
          try {
            const value = JSON.parse(source) as Record<string, unknown>;
            if (NAME_FIELD in value) {
              if (typeof value[NAME_FIELD] !== "string")
                return { ok: false, message: "name must be a string" };
              requested = value[NAME_FIELD];
              delete value[NAME_FIELD];
              code = JSON.stringify(value);
            }
          } catch {
            // The native parse reports the JSON error.
          }
        }
        const parsed = parseAnnotationPropertyCode(code, annotation);
        if (!parsed.ok) return parsed;
        if (requested !== undefined && !requested.trim())
          return { ok: false, message: "A Net Label needs a name" };
        return {
          ok: true,
          value: {
            annotation: parsed.value,
            ...(requested !== undefined ? { name: requested } : {}),
          },
        };
      },
    [annotation, renames],
  );
  const adapter = useMemo(
    () => annotationPropertyAdapter(parse, false),
    [parse],
  );
  const format = ({ annotation: value, name: requested }: AnnotationEdit) => {
    const code = serializeAnnotationPropertyCode(
      annotationPropertyValue(value),
    );
    return renames
      ? JSON.stringify(
          { ...JSON.parse(code), [NAME_FIELD]: requested ?? name },
          null,
          2,
        )
      : code;
  };
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
          name,
          ...(renames ? { namePath: NAME_FIELD } : {}),
          coordinate: [position.x, position.y],
        }}
        baseline={format({ annotation })}
        adapter={adapter}
        parse={parse}
        format={format}
        onApply={({ annotation: next, name: requested }) =>
          // A rename commits on its own, as editing the label's text does;
          // the label it rewrites is then the one the rest edits.
          requested !== undefined && requested.trim() !== name.trim()
            ? (onRename?.(requested.trim()) ?? { ok: false })
            : onApply(next)
        }
        defaultColor={inheritedColor}
        title="Annotation"
      />
    </section>
  );
}
