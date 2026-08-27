import type { SchematicEdit } from "@icm/edit-engine";
import { flattenRichText } from "@icm/model";
import { resolveAnnotationText } from "@icm/derived";
import type {
  Annotation,
  AnnotationTextBinding,
  DraftingObject,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";

export type DraftingTextObject = Extract<DraftingObject, { kind: "text" }>;

export type EditableTextTarget =
  | { owner: "annotation"; object: Annotation }
  | { owner: "drafting"; object: DraftingTextObject };

export interface TextEditingSession {
  owner: EditableTextTarget["owner"];
  id: string;
  content: RichTextDocument;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  /** Semantic displays edit their source field, not a copied RichText AST. */
  bound: boolean;
  bindingKind?: AnnotationTextBinding["kind"];
}

export type TextEditingCommitProposal =
  | { kind: "update"; edit: SchematicEdit; id: string }
  | { kind: "delete"; edit: SchematicEdit; id: string }
  | { kind: "unchanged" }
  | { kind: "blocked" };

export function createTextEditingSession(
  target: EditableTextTarget,
  document?: SchematicDocument,
): TextEditingSession {
  if (target.owner === "annotation") {
    const annotation = target.object;
    return {
      owner: "annotation",
      id: annotation.id,
      content: document
        ? resolveAnnotationText(document, annotation)
        : (annotation.content ?? { runs: [] }),
      sizeScale: annotation.sizeScale ?? 1,
      alignment: annotation.alignment,
      bound: annotation.binding !== undefined,
      ...(annotation.binding ? { bindingKind: annotation.binding.kind } : {}),
    };
  }
  return {
    owner: "drafting",
    id: target.object.id,
    content: target.object.content,
    sizeScale: target.object.styleOverride?.sizeScale ?? 1,
    alignment: target.object.alignment,
    bound: false,
  };
}

export function updateTextEditingSession(
  session: TextEditingSession,
  change: Partial<
    Pick<TextEditingSession, "content" | "sizeScale" | "alignment">
  >,
): TextEditingSession {
  return { ...session, ...change };
}

export function resolveTextEditingTarget(
  document: SchematicDocument,
  session: TextEditingSession,
): EditableTextTarget | null {
  if (session.owner === "annotation") {
    const object = document.annotations.find(
      (candidate) => candidate.id === session.id,
    );
    return object ? { owner: "annotation", object } : null;
  }
  const object = document.drafting?.objects.find(
    (candidate): candidate is DraftingTextObject =>
      candidate.id === session.id && candidate.kind === "text",
  );
  return object ? { owner: "drafting", object } : null;
}

export function textDeletionEdit(session: TextEditingSession): SchematicEdit {
  return session.owner === "annotation"
    ? { kind: "remove_schematic_annotation", annotationId: session.id }
    : { kind: "remove_drafting_object", objectId: session.id };
}

function richTextEqual(
  left: RichTextDocument,
  right: RichTextDocument,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Persist the exact rich-text AST and suppress revisions when both that AST
// and its presentation scale are unchanged.
export function proposeTextEditingCommit(
  document: SchematicDocument,
  session: TextEditingSession,
): TextEditingCommitProposal {
  const plainText = flattenRichText(session.content).trim();
  const emptied = !plainText;
  const emptyTarget = emptied
    ? resolveTextEditingTarget(document, session)
    : null;
  // A polarity label survives with its center text removed: the + / − marks
  // are the object, and the text is one deletable part of it. Every other
  // text object is gone once its content is.
  const polarityKeepsObject =
    emptyTarget?.owner === "drafting" &&
    emptyTarget.object.kind === "text" &&
    Boolean(emptyTarget.object.polarity);
  if (emptied && !polarityKeepsObject) {
    return {
      kind: "delete",
      edit: textDeletionEdit(session),
      id: session.id,
    };
  }

  const target = resolveTextEditingTarget(document, session);
  if (!target || target.object.locked) return { kind: "blocked" };

  if (target.owner === "annotation") {
    const annotation = target.object;
    // A binding is an electrical/domain fact, never a second editable text
    // payload. The editor dispatches source edits before reaching this guard.
    if (annotation.binding) return { kind: "blocked" };
    const next = {
      ...annotation,
      content: session.content,
      sizeScale: session.sizeScale,
      alignment: session.alignment,
    };
    if (
      (annotation.sizeScale ?? 1) === next.sizeScale &&
      annotation.alignment === next.alignment &&
      richTextEqual(annotation.content ?? { runs: [] }, next.content)
    ) {
      return { kind: "unchanged" };
    }
    return {
      kind: "update",
      edit: { kind: "upsert_schematic_annotation", annotation: next },
      id: annotation.id,
    };
  }

  const object = target.object;
  const next = {
    ...object,
    // An emptied polarity center persists as the canonical empty document —
    // a lone line break — because bare text runs must carry characters.
    content: emptied
      ? { runs: [{ kind: "line-break" as const }] }
      : session.content,
    alignment: session.alignment,
    styleOverride: {
      ...object.styleOverride,
      sizeScale: session.sizeScale,
    },
  };
  // Sessions normalize an absent scale to 1; compare the same way so an
  // untouched session stays revision-free.
  if (
    (object.styleOverride?.sizeScale ?? 1) === next.styleOverride.sizeScale &&
    object.alignment === next.alignment &&
    richTextEqual(object.content, next.content)
  ) {
    return { kind: "unchanged" };
  }
  return {
    kind: "update",
    edit: { kind: "upsert_drafting_object", object: next },
    id: object.id,
  };
}
