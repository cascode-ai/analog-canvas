import {
  richTextIdentifier,
  rewriteRichTextIdentifier,
  labelTypography,
  labelTextDocument,
  formatPresentingName,
  isRoleLabelFormat,
  labelRole,
  roleLabelFormat,
  type LabelRole,
} from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";
import {
  flattenRichText,
  normalizeRichText,
  semanticTextDocument,
} from "@icm/model";
import {
  signalFlowBodyTextDocument,
  signalFlowFormulaSource,
} from "@icm/symbols";
import type { SymbolFormulaPresentation } from "@icm/symbols";
import { resolveAnnotationText, resolveAnnotationName } from "@icm/derived";
import {
  createReferenceIndex,
  deviceDescriptor,
  referenceIssuesForInstance,
} from "@icm/devices";
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
   * integrator's transfer function, the letter in a lettered op-amp. It edits
   * like any label: `presentation` is where the Symbol draws it and what it
   * says by default, and the Instance keeps the text and the author's look.
   */
  | {
      owner: "instance-formula";
      object: Instance;
      presentation: SymbolFormulaPresentation;
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
  /** Symbol body text only: where and what the Symbol draws by default. */
  formulaPresentation?: SymbolFormulaPresentation;
}

export type TextEditingCommitProposal =
  | {
      kind: "update";
      edit: SchematicEdit;
      beforeEdits?: SchematicEdit[];
      id: string;
      /** The Reference a label kept when its text became a display alias. */
      aliasFor?: string;
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

/**
 * The role and name of a label that still shows its stored standard look
 * (V_DD, M₁, V_inp), or undefined once the author has restyled it or for a
 * label without a role.
 */
export function roleLabelDefault(
  document: SchematicDocument,
  annotation: Annotation,
): { role: LabelRole; name: string } | undefined {
  const role = labelRole(annotation);
  if (!role || !annotation.formatOverride) return undefined;
  const name = resolveAnnotationName(document, annotation).trim();
  return isRoleLabelFormat(annotation.formatOverride, role, name)
    ? { role, name }
    : undefined;
}

/**
 * The format an edited role label keeps: its standard look regenerated for
 * the new name after a plain text edit, or the author's own formatting once
 * restyled. Undefined when the label is not showing a standard look.
 */
export function editedRoleLabelFormat(
  document: SchematicDocument,
  annotation: Annotation,
  session: TextEditingSession,
  name: string,
): { format: RichTextDocument | undefined } | undefined {
  const current = roleLabelDefault(document, annotation);
  if (!current) return undefined;
  return {
    format:
      session.formatEdited && flattenRichText(session.content) === name
        ? session.content
        : roleLabelFormat(current.role, name),
  };
}

/**
 * Apply the change between two visible spellings of a label to the name it
 * shows. Characters the old look hid, such as an underscore before a
 * subscript or a trailing `_bar` under an overbar, stay where they were.
 */
export function spliceVisibleEdit(
  name: string,
  before: string,
  after: string,
): string {
  const nameCharacters = [...name];
  const beforeCharacters = [...before];
  const afterCharacters = [...after];
  const positions: number[] = [];
  let cursor = 0;
  for (const character of beforeCharacters) {
    while (
      cursor < nameCharacters.length &&
      nameCharacters[cursor] !== character
    )
      cursor += 1;
    if (cursor >= nameCharacters.length) return after;
    positions.push(cursor);
    cursor += 1;
  }
  let prefix = 0;
  while (
    prefix < beforeCharacters.length &&
    prefix < afterCharacters.length &&
    beforeCharacters[prefix] === afterCharacters[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < beforeCharacters.length - prefix &&
    suffix < afterCharacters.length - prefix &&
    beforeCharacters[beforeCharacters.length - 1 - suffix] ===
      afterCharacters[afterCharacters.length - 1 - suffix]
  )
    suffix += 1;
  const replacedEnd = beforeCharacters.length - suffix;
  // A replacement spans its first to last visible character; a pure
  // insertion lands before the next visible character, or after the last.
  const start =
    prefix < replacedEnd || prefix < beforeCharacters.length
      ? positions[prefix]!
      : prefix > 0
        ? positions[prefix - 1]! + 1
        : 0;
  const end = prefix < replacedEnd ? positions[replacedEnd - 1]! + 1 : start;
  return [
    ...nameCharacters.slice(0, start),
    ...afterCharacters.slice(prefix, afterCharacters.length - suffix),
    ...nameCharacters.slice(end),
  ].join("");
}

/**
 * The name an edited bound label now spells, for an Instance, Net or Cell
 * terminal alike. Changed characters rename exactly as typed: nothing is
 * inserted, removed or re-cased. A styling-only edit (subscript, slant,
 * overbar) never renames. Each owner still commits the name through its own
 * electrical transaction boundary.
 */
export function editedBoundAnnotationName(
  document: SchematicDocument,
  annotation: Annotation,
  session: TextEditingSession,
  currentName: string,
): string {
  if (!session.contentEdited) return currentName;
  const before = flattenRichText(resolveAnnotationText(document, annotation));
  const after = flattenRichText(session.content);
  if (after === before) return currentName;
  return spliceVisibleEdit(currentName, before, after).trim();
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
    // A standard look stored at placement (V_DD, M₁) is a default, not the
    // author's styling: editing starts from it the way it starts from a name.
    const automaticRoleFormat =
      document !== undefined &&
      roleLabelDefault(document, annotation) !== undefined;
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
      ...(annotation.formatOverride &&
      !automaticTerminalOverride &&
      !automaticRoleFormat
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
    // Opens on the text exactly as it draws — the author's look, or the
    // Symbol's own — so the editor shows what the canvas shows.
    const content = (document &&
      signalFlowBodyTextDocument(
        target.presentation,
        target.object.signalFlowParameters,
        document.presentation,
      )) ?? {
      runs: [
        {
          kind: "text",
          value:
            target.object.signalFlowParameters?.formula ??
            target.presentation.defaultFormula,
        },
      ],
    };
    return {
      owner: "instance-formula",
      id: target.object.id,
      content,
      defaultBold: uniformTextStyle(content.runs, "bold"),
      defaultItalic: uniformTextStyle(content.runs, "italic"),
      sizeScale: 1,
      alignment: "middle",
      bound: true,
      formulaPresentation: target.presentation,
      // A stored look is the author's, and keeps being edited as one.
      ...(target.object.signalFlowParameters?.formula &&
      target.object.signalFlowParameters.formulaFormat
        ? { formatEdited: true }
        : {}),
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
    return object && session.formulaPresentation
      ? {
          owner: "instance-formula",
          object,
          presentation: session.formulaPresentation,
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
  if (session.contentEdited && !editedText) {
    return {
      kind: "delete",
      edit: textDeletionEdit(session),
      id: session.id,
    };
  }
  const beforeEdits: SchematicEdit[] = [];
  let showValue = binding.showValue;
  if (session.contentEdited && editedText !== currentText.trim()) {
    if (!parameter)
      return {
        kind: "blocked",
        message:
          "Edit compound component values in Properties. Escape cancels these text changes.",
      };
    const label = definition?.label ?? parameter;
    const labelOnly =
      binding.parameter !== undefined &&
      [parameter, label].some(
        (name) => name?.toLowerCase() === editedText.toLowerCase(),
      );
    let value = editedText;
    const assignment = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?![=])([\s\S]*)$/u.exec(
      value,
    );
    if (labelOnly) {
      showValue = false;
    } else if (assignment) {
      if (
        ![parameter, label].some(
          (name) => name?.toLowerCase() === assignment[1]!.toLowerCase(),
        )
      )
        return {
          kind: "blocked",
          message: `Edit ${definition?.label ?? parameter} using a value or ${definition?.label ?? parameter} = value. Escape cancels.`,
        };
      value = assignment[2]!.trim();
      showValue = undefined;
    } else {
      showValue = undefined;
    }
    if (!labelOnly && !value)
      return {
        kind: "blocked",
        message: "Enter a parameter value. Escape cancels these text changes.",
      };
    if (!labelOnly) {
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
  }
  const nextBinding = {
    ...binding,
    ...(showValue === false ? { showValue: false as const } : {}),
  };
  if (showValue !== false) delete nextBinding.showValue;
  if (
    !beforeEdits.length &&
    JSON.stringify(binding) === JSON.stringify(nextBinding) &&
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
        binding: nextBinding,
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
    const presentation = session.formulaPresentation;
    if (!instance || !presentation) return { kind: "blocked" };
    const content = normalizeRichText(session.content);
    const drawn = (formula?: string): RichTextDocument | undefined => {
      const look = signalFlowBodyTextDocument(
        presentation,
        formula ? { formula } : undefined,
        document.presentation,
      );
      return look && normalizeRichText(look);
    };
    // Typed text is source, as a label's name is: slant and weight come from
    // the Symbol's look and scripts or a fraction are spelled `^`, `_`, `/`,
    // so the drawing's label rules keep applying. Only a look the author set
    // with a formatting command is stored beside the text.
    const source = signalFlowFormulaSource(content)?.trim();
    const plainLook = source ? drawn(source) : undefined;
    const keepsOwnLook =
      source !== undefined &&
      (!session.formatEdited ||
        (plainLook !== undefined && richTextEqual(content, plainLook)));
    const ownDefault = drawn();
    // The Symbol's own text in its own look is not an override: storing it
    // would freeze a copy of a default the Symbol is allowed to change.
    const isDefault =
      !flattenRichText(content).trim() ||
      (ownDefault !== undefined && richTextEqual(content, ownDefault)) ||
      (keepsOwnLook && source === presentation.defaultFormula);
    const nextFormula = isDefault
      ? undefined
      : keepsOwnLook
        ? source
        : flattenRichText(content).trim();
    const nextFormat = isDefault || keepsOwnLook ? undefined : content;
    const current = instance.signalFlowParameters;
    // Edited in place, so unchanged parameters keep their order and compare equal.
    const parameters = { ...current };
    if (nextFormula) parameters.formula = nextFormula;
    else delete parameters.formula;
    if (nextFormat) parameters.formulaFormat = nextFormat;
    else delete parameters.formulaFormat;
    if (JSON.stringify(parameters) === JSON.stringify(current ?? {}))
      return { kind: "unchanged" };
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
      const typography = labelTypography(document.presentation);
      const name = editedBoundAnnotationName(
        document,
        annotation,
        session,
        reference,
      );
      // Text that cannot be this part's netlist name — a Greek letter, a
      // space, another part's name, the wrong device letter — is shown as a
      // display alias: the label keeps what was typed and the netlist keeps
      // the Reference. An unchanged name always stays the part's name.
      const namable =
        isNamePresentation(session.content.runs) &&
        (name === reference ||
          (/^[A-Za-z][A-Za-z0-9_]*$/u.test(name) &&
            referenceIssuesForInstance(
              createReferenceIndex({
                ...document,
                instances: document.instances.map((item) =>
                  item.id === instanceId ? { ...item, reference: name } : item,
                ),
              }),
              instanceId,
            ).length === 0));
      const automaticAlias = !session.displayAlias && !namable;
      const follows = !session.displayAlias && namable;
      const beforeEdits: SchematicEdit[] =
        follows && name !== reference
          ? [{ kind: "set_instance_reference", instanceId, reference: name }]
          : [];
      const defaultContent = labelTextDocument(name, document.presentation);
      const roleFormat = follows
        ? editedRoleLabelFormat(document, annotation, session, name)
        : undefined;
      const styled = roleFormat
        ? (roleFormat.format ?? defaultContent)
        : session.contentEdited &&
            (flattenRichText(session.content).includes("_") ||
              (typography.subscriptAfterFirst && !session.formatEdited))
          ? rewriteRichTextIdentifier(session.content, name, {
              underscoreSubscript:
                typography.subscriptAfterFirst ||
                typography.underscoreSubscript,
            })
          : session.content;
      const presentation = formatPresentingName(styled, name);
      // An alias typed as a name, without a look of its own, is drawn the
      // way a name is (Φ2 as Φ over a subscript 2), so a drawing's labels
      // keep one look.
      const aliasContent =
        automaticAlias && !session.formatEdited
          ? (roleLabelFormat(
              "device-reference",
              flattenRichText(session.content).trim(),
            ) ?? session.content)
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
          : { content: aliasContent }),
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
        ...(automaticAlias ? { aliasFor: reference } : {}),
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
