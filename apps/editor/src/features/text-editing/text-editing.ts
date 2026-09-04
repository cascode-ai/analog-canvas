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

type Instance = SchematicDocument["instances"][number];

export type EditableTextTarget =
  | { owner: "annotation"; object: Annotation }
  | { owner: "drafting"; object: DraftingTextObject }
  /**
   * The text a Symbol draws inside its own body — a DAC's "DAC", an
   * integrator's transfer function, the letter in a lettered op-amp. It is a
   * plain string in the Symbol's own compact script syntax (`z^-1`, `1/(1-z)`),
   * not a RichText document, and `defaultFormula` is what the Symbol draws
   * when the Instance overrides nothing.
   */
  | {
      owner: "instance-formula";
      object: Instance;
      defaultFormula: string;
    };

export interface TextEditingSession {
  owner: EditableTextTarget["owner"];
  id: string;
  content: RichTextDocument;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  /** Semantic displays edit their source field, not a copied RichText AST. */
  bound: boolean;
  bindingKind?: AnnotationTextBinding["kind"];
  /** Symbol body text only: what the Symbol draws with no override. */
  defaultFormula?: string;
}

/**
 * A Reference edit the prefix policy refused, held while the person decides
 * whether the typed text should become attached literal text instead.
 */
export interface ReferenceLabelOffer {
  readonly annotationId: string;
  /** The typed text, as plain characters. */
  readonly text: string;
  /** The Reference that stays, and is printed by the netlist. */
  readonly reference: string;
  /** The prefix the component's Reference has to start with. */
  readonly prefix: string;
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
  if (target.owner === "instance-formula") {
    // Carried as one text run so the canvas overlay can host it unchanged.
    // The overlay shows this as a plain source field, with no rich-text or
    // formula affordances, because the field cannot store them.
    const value =
      target.object.signalFlowParameters?.formula ?? target.defaultFormula;
    return {
      owner: "instance-formula",
      id: target.object.id,
      content: { runs: [{ kind: "text", value }] },
      sizeScale: 1,
      alignment: "middle",
      bound: true,
      defaultFormula: target.defaultFormula,
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
  if (session.owner === "instance-formula") {
    const object = document.instances.find(
      (candidate) => candidate.id === session.id,
    );
    return object
      ? {
          owner: "instance-formula",
          object,
          defaultFormula: session.defaultFormula ?? "",
        }
      : null;
  }
  const object = document.drafting?.objects.find(
    (candidate): candidate is DraftingTextObject =>
      candidate.id === session.id && candidate.kind === "text",
  );
  return object ? { owner: "drafting", object } : null;
}

export function textDeletionEdit(session: TextEditingSession): SchematicEdit {
  if (session.owner === "annotation")
    return { kind: "remove_schematic_annotation", annotationId: session.id };
  // Emptying a Symbol's body text drops back to what the Symbol draws; the
  // Instance itself is not a text object and is not deleted with its label.
  if (session.owner === "instance-formula")
    return {
      kind: "set_instance_signal_flow_parameters",
      instanceId: session.id,
      parameters: null,
    };
  return { kind: "remove_drafting_object", objectId: session.id };
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
  if (session.owner === "instance-formula") {
    const instance = document.instances.find(
      (candidate) => candidate.id === session.id,
    );
    if (!instance) return { kind: "blocked" };
    const edited = flattenRichText(session.content).trim();
    const current = instance.signalFlowParameters?.formula;
    // Typing the Symbol's own default back is not an override: storing it
    // would freeze a copy of a default the Symbol is allowed to change. The
    // Properties panel reads the same rule, so the two surfaces agree.
    const nextFormula =
      edited && edited !== session.defaultFormula ? edited : undefined;
    if (nextFormula === current) return { kind: "unchanged" };
    const rest = { ...instance.signalFlowParameters };
    delete rest.formula;
    const parameters = {
      ...rest,
      ...(nextFormula ? { formula: nextFormula } : {}),
    };
    return {
      kind: "update",
      id: session.id,
      edit: {
        kind: "set_instance_signal_flow_parameters",
        instanceId: session.id,
        parameters: Object.keys(parameters).length > 0 ? parameters : null,
      },
    };
  }
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
  // Symbol body text returned above; what remains carries a lock of its own.
  if (!target || target.owner === "instance-formula")
    return { kind: "blocked" };
  if (target.object.locked) return { kind: "blocked" };

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
