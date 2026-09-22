import {
  richTextIdentifier,
  rewriteRichTextIdentifier,
  labelTypography,
  labelTextDocument,
  formatLabelIdentifier,
} from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";
import { flattenRichText, semanticTextDocument } from "@icm/model";
import { resolveAnnotationText, resolveAnnotationName } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type {
  Annotation,
  AnnotationTextBinding,
  DraftingObject,
  RichTextDocument,
  RichTextRun,
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
  /** Object default while editing; authored content records explicit weights. */
  defaultBold?: boolean;
  defaultItalic?: boolean;
  contentEdited?: boolean;
  /** True once the user explicitly changes presentation rather than text. */
  formatEdited?: boolean;
  /** Net/terminal/value displays edit their source; Instance labels edit presentation. */
  bound: boolean;
  bindingKind?: AnnotationTextBinding["kind"];
  /** Route markers are literal single-line fields, not semantic name bindings. */
  plainTextKind?: "route-marker";
  /** Instance whose name or explicit display alias is being edited. */
  visualInstanceId?: string;
  /** False follows/edits the electrical Reference; true owns display text. */
  displayAlias?: boolean;
  /** Symbol body text only: what the Symbol draws with no override. */
  defaultFormula?: string;
}

export type TextEditingCommitProposal =
  | {
      kind: "update";
      edit: SchematicEdit;
      beforeEdits?: SchematicEdit[];
      id: string;
    }
  | { kind: "delete"; edit: SchematicEdit; id: string }
  | { kind: "unchanged" }
  | { kind: "blocked"; message?: string };

// Preserve uniform label styling when replacing all characters. Mixed styles
// remain in the rich-text spans instead of becoming a blanket default.
function uniformTextStyle(
  runs: readonly RichTextRun[],
  style: "bold" | "italic",
  inherited = false,
): boolean {
  return (
    runs.length > 0 &&
    runs.every((run) =>
      run.kind === "span"
        ? uniformTextStyle(
            run.children,
            style,
            inherited || run.style === style,
          )
        : run.kind === "text" && inherited,
    )
  );
}

export function createTextEditingSession(
  target: EditableTextTarget,
  document?: SchematicDocument,
): TextEditingSession {
  if (target.owner === "annotation") {
    const annotation = target.object;
    const anchor = annotation.anchor;
    const content = document
      ? resolveAnnotationText(document, annotation)
      : (annotation.content ?? { runs: [] });
    const automaticTerminalOverride =
      annotation.binding?.kind === "cell-terminal-name" &&
      annotation.formatOverride !== undefined &&
      richTextEqual(
        annotation.formatOverride,
        semanticTextDocument(
          document
            ? resolveAnnotationName(document, annotation)
            : richTextIdentifier(content),
          "formal-port",
        ),
      );
    const instanceId =
      annotation.binding?.kind === "instance-reference"
        ? annotation.binding.instanceId
        : anchor.kind === "object"
          ? anchor.objectId
          : undefined;
    return {
      owner: "annotation",
      id: annotation.id,
      content,
      defaultBold: uniformTextStyle(content.runs, "bold"),
      defaultItalic: uniformTextStyle(content.runs, "italic"),
      sizeScale: annotation.sizeScale ?? 1,
      alignment: annotation.alignment,
      bound:
        annotation.binding !== undefined &&
        annotation.binding.kind !== "instance-reference",
      ...(annotation.binding ? { bindingKind: annotation.binding.kind } : {}),
      ...(annotation.formatOverride && !automaticTerminalOverride
        ? { formatEdited: true }
        : {}),
      ...(annotation.kind === "route-marker"
        ? { plainTextKind: "route-marker" as const }
        : {}),
      ...(annotation.kind === "instance-label" &&
      document?.instances.some(
        (instance) => instance.id === instanceId && instance.reference,
      ) &&
      (!annotation.binding || annotation.binding.kind === "instance-reference")
        ? { visualInstanceId: instanceId!, displayAlias: !annotation.binding }
        : {}),
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
    defaultBold: target.object.styleOverride?.weight !== "normal",
    bound: false,
  };
}

export function updateTextEditingSession(
  session: TextEditingSession,
  change: Partial<
    Pick<TextEditingSession, "content" | "sizeScale" | "alignment">
  >,
): TextEditingSession {
  const formatEdited =
    session.formatEdited ||
    (change.content !== undefined &&
      flattenRichText(change.content) === flattenRichText(session.content) &&
      !richTextEqual(change.content, session.content));
  return {
    ...session,
    ...change,
    ...(change.content ? { contentEdited: true } : {}),
    ...(formatEdited ? { formatEdited: true } : {}),
  };
}

export function resolveTextEditingTarget(
  document: SchematicDocument,
  session: TextEditingSession,
): EditableTextTarget | null {
  if (session.owner === "annotation") {
    const object = document.annotations.find(
      (candidate) => candidate.id === session.id && candidate.visible !== false,
    );
    if (
      object?.binding?.kind === "instance-value" &&
      !flattenRichText(resolveAnnotationText(document, object)).trim()
    )
      return null;
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

// Formula source may spell the same characters as a name; that does not make
// it a name projection. Only styled characters can retain a live binding.
function isNamePresentation(runs: readonly RichTextRun[]): boolean {
  return runs.every(
    (run) =>
      run.kind === "text" ||
      (run.kind === "span" && isNamePresentation(run.children)),
  );
}

// A displayed parameter edits its source, never a disconnected annotation
// string. Keep the optional "L1 =" prefix out of the electrical value.
function proposeInstanceValueCommit(
  document: SchematicDocument,
  annotation: Annotation,
  session: TextEditingSession,
): TextEditingCommitProposal {
  const binding = annotation.binding;
  if (binding?.kind !== "instance-value" || annotation.locked)
    return { kind: "blocked" };
  const instance = document.instances.find(
    (item) => item.id === binding.instanceId,
  );
  if (!instance?.netlist) return { kind: "blocked" };
  const definition = deviceDescriptor(instance.symbolId)?.parameters.find(
    (parameter) =>
      binding.parameter
        ? parameter.name.toLowerCase() === binding.parameter.toLowerCase()
        : parameter.displayRole === "value",
  );
  const parameter = binding.parameter ?? definition?.name;
  const currentText = flattenRichText(
    resolveAnnotationText(document, annotation),
  );
  const editedText = flattenRichText(session.content).trim();
  const beforeEdits: SchematicEdit[] = [];
  if (session.contentEdited && editedText !== currentText.trim()) {
    if (!parameter)
      return {
        kind: "blocked",
        message:
          "Edit compound component values in Properties. Escape cancels these text changes.",
      };
    let value = editedText;
    const assignment = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?![=])([\s\S]*)$/u.exec(
      value,
    );
    if (assignment) {
      if (
        ![parameter, definition?.label].some(
          (name) => name?.toLowerCase() === assignment[1]!.toLowerCase(),
        )
      )
        return {
          kind: "blocked",
          message: `Edit ${definition?.label ?? parameter} using a value or ${definition?.label ?? parameter} = value. Escape cancels.`,
        };
      value = assignment[2]!.trim();
    }
    if (!value)
      return {
        kind: "blocked",
        message: "Enter a parameter value. Escape cancels these text changes.",
      };
    const key =
      Object.keys(instance.netlist.parameters).find(
        (key) => key.toLowerCase() === parameter.toLowerCase(),
      ) ?? parameter;
    if (instance.netlist.parameters[key] !== value)
      beforeEdits.push({
        kind: "patch_instance_netlist_parameters",
        instanceId: instance.id,
        set: { [key]: value },
      });
  }
  if (
    !beforeEdits.length &&
    (annotation.sizeScale ?? 1) === session.sizeScale &&
    annotation.alignment === session.alignment
  )
    return { kind: "unchanged" };
  return {
    kind: "update",
    id: annotation.id,
    beforeEdits,
    edit: {
      kind: "upsert_schematic_annotation",
      annotation: {
        ...annotation,
        sizeScale: session.sizeScale,
        alignment: session.alignment,
      },
    },
  };
}

// Persist the exact rich-text AST and suppress revisions when both that AST
// and its presentation scale are unchanged.
export function proposeTextEditingCommit(
  document: SchematicDocument,
  session: TextEditingSession,
): TextEditingCommitProposal {
  if (
    session.owner === "annotation" &&
    session.bindingKind === "instance-value"
  ) {
    const target = resolveTextEditingTarget(document, session);
    return target?.owner === "annotation"
      ? proposeInstanceValueCommit(document, target.object, session)
      : { kind: "blocked" };
  }
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
  if (emptied && session.visualInstanceId && !session.displayAlias)
    return { kind: "blocked" };
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
    if (
      annotation.binding?.kind === "instance-reference" ||
      session.visualInstanceId
    ) {
      const instanceId =
        annotation.binding?.kind === "instance-reference"
          ? annotation.binding.instanceId
          : session.visualInstanceId;
      const reference = document.instances.find(
        (instance) => instance.id === instanceId,
      )?.reference;
      if (!reference || !instanceId) return { kind: "blocked" };
      const {
        binding: _binding,
        content: _content,
        formatOverride: _format,
        ...rest
      } = annotation;
      const follows = !session.displayAlias;
      const typography = labelTypography(document.presentation);
      const name =
        session.contentEdited &&
        richTextIdentifier(session.content) !==
          richTextIdentifier(resolveAnnotationText(document, annotation))
          ? session.formatEdited
            ? richTextIdentifier(session.content).trim()
            : formatLabelIdentifier(
                richTextIdentifier(session.content).trim(),
                typography,
              )
          : reference;
      if (
        follows &&
        (!isNamePresentation(session.content.runs) ||
          !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name))
      )
        return { kind: "blocked" };
      if (
        follows &&
        document.instances.some(
          (item) =>
            item.id !== instanceId &&
            item.reference?.toLowerCase() === name.toLowerCase(),
        )
      )
        return {
          kind: "blocked",
          message: `Instance name ${name} already exists. Use display alias to show the same text without renaming the device.`,
        };
      const beforeEdits: SchematicEdit[] =
        follows && name !== reference
          ? [{ kind: "set_instance_reference", instanceId, reference: name }]
          : [];
      const defaultContent = labelTextDocument(name, document.presentation);
      const presentation =
        session.contentEdited &&
        (flattenRichText(session.content).includes("_") ||
          (typography.subscriptAfterFirst && !session.formatEdited))
          ? rewriteRichTextIdentifier(session.content, name, {
              underscoreSubscript:
                typography.subscriptAfterFirst ||
                typography.underscoreSubscript,
            })
          : session.content;
      const next: Annotation = {
        ...rest,
        sizeScale: session.sizeScale,
        alignment: session.alignment,
        ...(follows
          ? {
              binding: { kind: "instance-reference" as const, instanceId },
              ...(!richTextEqual(presentation, defaultContent)
                ? { formatOverride: presentation }
                : {}),
            }
          : { content: session.content }),
      };
      if (
        beforeEdits.length === 0 &&
        (annotation.sizeScale ?? 1) === next.sizeScale &&
        annotation.alignment === next.alignment &&
        JSON.stringify(annotation.binding) === JSON.stringify(next.binding) &&
        JSON.stringify(annotation.content) === JSON.stringify(next.content) &&
        JSON.stringify(annotation.formatOverride) ===
          JSON.stringify(next.formatOverride)
      )
        return { kind: "unchanged" };
      return {
        kind: "update",
        id: annotation.id,
        ...(beforeEdits.length ? { beforeEdits } : {}),
        edit: { kind: "upsert_schematic_annotation", annotation: next },
      };
    }
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
      // The DOM reader records effective bold spans and explicit unbold text.
      // Neutralize the object default only after content was actually edited.
      ...(session.contentEdited ? { weight: "normal" as const } : {}),
    },
  };
  // Sessions normalize an absent scale to 1; compare the same way so an
  // untouched session stays revision-free.
  if (
    (object.styleOverride?.sizeScale ?? 1) === next.styleOverride.sizeScale &&
    object.alignment === next.alignment &&
    (object.styleOverride?.weight ?? "bold") ===
      (next.styleOverride.weight ?? "bold") &&
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
