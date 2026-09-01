import {
  boundAnnotationSemanticText,
  flattenRichText,
  rewriteRichTextPlainText,
  RichTextDocumentSchema,
} from "@icm/model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Repair bound format overrides that no longer read as the name they present.
 *
 * #463 retired the rule that capitalized an identifier's leading character.
 * Every override authored before that carries the capital the old compiler
 * produced, so a terminal named `reset` has an override reading `Reset` — and
 * the schema refuses the whole Project, because a bound override must still
 * say the name it decorates.
 *
 * The circuits this hits are already published. A published circuit that will
 * not open is, to its author, a circuit that is gone, so loading repairs the
 * override rather than refusing the file.
 *
 * The repair rewrites only the characters, through the same helper the editor
 * uses, so the author's italic, bold, and subscript survive: the text was
 * wrong, the formatting never was. An override that cannot be reconciled —
 * one whose name has since disappeared — is dropped, and the label falls back
 * to the house style rather than taking the Project down with it.
 *
 * The semantic name comes from `boundAnnotationSemanticText`, the same
 * function the schema checks against. A repair computed any other way would
 * either miss files the check still refuses or claim success on a file that
 * still cannot load.
 *
 * This runs on every load rather than as one numbered migration step. An
 * override is derived from the name it decorates, so the two agreeing is a
 * standing invariant, not a format that changed once: a file written at any
 * version by any client is repaired the same way. It also costs nothing on
 * the overwhelming majority of Projects, where no annotation carries an
 * override at all.
 */
export function repairBoundFormatOverrides(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const project: Record<string, unknown> = { ...raw };
  project.documents = records(project.documents).map((document) => {
    const annotations = records(document.annotations);
    if (annotations.length === 0) return document;
    let changed = false;
    const repaired = annotations.map((annotation) => {
      if (!annotation.formatOverride || !annotation.binding) return annotation;
      const parsed = RichTextDocumentSchema.safeParse(
        annotation.formatOverride,
      );
      if (!parsed.success) return annotation;
      const semantic = boundAnnotationSemanticText(
        document as never,
        annotation as never,
      );
      if (!semantic) return annotation;
      const name = flattenRichText(semantic);
      if (flattenRichText(parsed.data) === name) return annotation;
      changed = true;
      if (!name.trim()) {
        const { formatOverride: _dropped, ...rest } = annotation;
        return rest;
      }
      return {
        ...annotation,
        formatOverride: rewriteRichTextPlainText(parsed.data, name),
      };
    });
    return changed ? { ...document, annotations: repaired } : document;
  });
  return project;
}
