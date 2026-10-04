import {
  executeTransaction,
  planRenameCellTerminal,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import { resolveAnnotationText } from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import {
  flattenRichText,
  foldNetName,
  labelTextDocument,
  richTextPresentsIdentifier,
  roleLabelFormat,
} from "@icm/model";
import type {
  Annotation,
  CircuitProject,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/** A selected part that carries a name: a Cell Pin's, or its Reference. */
interface NamedPart {
  instanceId: string;
  name: string;
  terminalId?: string;
  deviceLetter?: string;
}

export interface GroupNamingInput {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  /** The selected parts, the one selected first first. */
  instanceIds: readonly string[];
  name: string;
  /** A part's name label, where it has one. */
  labelFor(
    document: SchematicDocument,
    instanceId: string,
  ): Annotation | undefined;
  /** The name label showing a part's name adds, where it has none. */
  newLabelFor(
    document: SchematicDocument,
    instanceId: string,
  ): Annotation | undefined;
}

export type GroupNamingPlan =
  | {
      ok: true;
      /** This drawing's edits: the holder's rename and label, then aliases. */
      edits: SchematicEdit[];
      /** A Pin holder's rename, which its Cell's callers follow. */
      structure: ProjectStructureEdit[];
      /** Who carries the name in the netlist, by its name before; null when no part can. */
      holder: string | null;
      /** Who shows the name as a display alias, by their own names. */
      aliases: string[];
    }
  | { ok: false; message: string };

/** The name a part's label shows: its display alias, else its own name. */
export function shownPartName(
  label: Annotation | undefined,
  name: string,
): string {
  return label && !label.binding && label.content
    ? richTextPresentsIdentifier(label.content, name)
      ? name
      : flattenRichText(label.content).trim()
    : name;
}

function namedParts(
  document: SchematicDocument,
  instanceIds: readonly string[],
): NamedPart[] {
  return instanceIds.flatMap((instanceId): NamedPart[] => {
    const instance = document.instances.find((item) => item.id === instanceId);
    if (!instance) return [];
    const terminal = document.netlist?.terminals.find((item) =>
      item.interfaceInstanceIds.includes(instanceId),
    );
    if (terminal)
      return [{ instanceId, name: terminal.name, terminalId: terminal.id }];
    if (!instance.reference) return [];
    const deviceLetter = referenceDeviceLetter(instance.symbolId);
    return [
      {
        instanceId,
        name: instance.reference,
        ...(deviceLetter ? { deviceLetter } : {}),
      },
    ];
  });
}

/** The label named again: bound to its part, in the part's standard look. */
function boundLabel(
  label: Annotation,
  part: NamedPart,
  name: string,
): Annotation {
  const {
    binding: _binding,
    content: _content,
    formatOverride: _format,
    ...rest
  } = label;
  const standard = part.terminalId
    ? roleLabelFormat("voltage-node", name)
    : roleLabelFormat(
        "device-reference",
        name,
        part.deviceLetter ? { deviceLetter: part.deviceLetter } : {},
      );
  return {
    ...rest,
    binding: part.terminalId
      ? { kind: "cell-terminal-name", terminalId: part.terminalId }
      : { kind: "instance-reference", instanceId: part.instanceId },
    ...(standard ? { formatOverride: standard } : {}),
  };
}

/**
 * One name for several selected parts. The part that already has it keeps
 * it; otherwise the first selected part that can take it is renamed to it,
 * so exactly one part carries the name in the netlist. Every other part
 * shows it as a display alias, drawn as the named part's label is drawn,
 * and keeps its own name. A name no selected part can take (another part's
 * name, the wrong device letter, a space) is shown by them all as an alias.
 */
export function planGroupNaming(input: GroupNamingInput): GroupNamingPlan {
  const { project, document, resolver, name } = input;
  const parts = namedParts(document, input.instanceIds);
  if (parts.length === 0)
    return { ok: false, message: "None of the selected parts has a name" };
  const trial = (edits: readonly SchematicEdit[]) =>
    edits.length === 0
      ? ({ ok: true, document } as const)
      : executeTransaction(
          document,
          {
            transactionId: "group-name-trial",
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "local" },
            edits: [...edits],
          },
          { symbolResolver: resolver },
        );

  const take = (part: NamedPart) => {
    const rename = part.name !== name;
    let structure: ProjectStructureEdit[] = [];
    let before: SchematicEdit[] = [];
    if (part.terminalId) {
      // A Pin never takes another Pin's name here: that would join them.
      if (
        rename &&
        (!/^\p{L}[\p{L}\p{N}_]*$/u.test(name) ||
          document.netlist?.terminals.some(
            (terminal) =>
              terminal.id !== part.terminalId &&
              foldNetName(terminal.name) === foldNetName(name),
          ))
      )
        return null;
      try {
        structure = rename
          ? planRenameCellTerminal(project, document.id, part.terminalId, name)
          : [];
      } catch {
        return null;
      }
      const own = structure.find(
        (edit) =>
          edit.kind === "transact_document" && edit.documentId === document.id,
      );
      before = own?.kind === "transact_document" ? own.edits : [];
    } else {
      if (rename && !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) return null;
      if (rename)
        before = [
          {
            kind: "set_instance_reference",
            instanceId: part.instanceId,
            reference: name,
          },
        ];
    }
    const renamed = trial(before);
    if (!renamed.ok) return null;
    // Its label shows the name itself again, not an alias it had.
    const label =
      input.labelFor(renamed.document, part.instanceId) ??
      input.newLabelFor(renamed.document, part.instanceId);
    const own: SchematicEdit[] = part.terminalId ? [] : [...before];
    if (label && (!label.binding || !input.labelFor(document, part.instanceId)))
      own.push({
        kind: "upsert_schematic_annotation",
        annotation: label.binding ? label : boundLabel(label, part, name),
      });
    const named = trial(part.terminalId ? [...before, ...own] : own);
    if (!named.ok) return null;
    const shown = input.labelFor(named.document, part.instanceId);
    return {
      part,
      edits: own,
      structure,
      look: shown ? resolveAnnotationText(named.document, shown) : undefined,
    };
  };

  const holding = parts.find((part) => part.name === name);
  let holder: ReturnType<typeof take> = null;
  for (const part of holding ? [holding] : parts) {
    holder = take(part);
    if (holder) break;
  }
  if (holding && !holder)
    return {
      ok: false,
      message: `Could not show ${name} on ${holding.name}`,
    };
  const first = holder?.part ?? parts[0]!;
  const look: RichTextDocument =
    holder?.look ??
    (first.terminalId
      ? roleLabelFormat("voltage-node", name)
      : roleLabelFormat(
          "device-reference",
          name,
          first.deviceLetter ? { deviceLetter: first.deviceLetter } : {},
        )) ??
    labelTextDocument(name, document.presentation);

  const edits: SchematicEdit[] = [...(holder?.edits ?? [])];
  const aliases: string[] = [];
  for (const part of parts) {
    if (part === holder?.part) continue;
    const existing = input.labelFor(document, part.instanceId);
    const label = existing ?? input.newLabelFor(document, part.instanceId);
    if (!label) continue;
    aliases.push(part.name);
    if (
      existing &&
      !existing.binding &&
      JSON.stringify(existing.content) === JSON.stringify(look)
    )
      continue;
    const {
      binding: _binding,
      content: _content,
      formatOverride: _format,
      ...rest
    } = label;
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: { ...rest, content: look },
    });
  }
  return {
    ok: true,
    edits,
    structure: holder?.structure ?? [],
    holder: holder ? holder.part.name : null,
    aliases,
  };
}

/** What the status line says a batch name did. */
export function groupNamingStatus(
  name: string,
  plan: Extract<GroupNamingPlan, { ok: true }>,
): string {
  const aliases = plan.aliases.length
    ? `; ${plan.aliases.join(", ")} ${plan.aliases.length === 1 ? "shows" : "show"} it as a display alias`
    : "";
  if (!plan.holder) return `${name} cannot be a netlist name here${aliases}`;
  return `${
    plan.holder === name
      ? `${name} keeps the name`
      : `${plan.holder} is now ${name}`
  }${aliases}`;
}

/**
 * One part's name label showing `alias` while the part keeps its own name
 * in the netlist, as the Properties display alias does: an op-amp stays X1
 * and is drawn A1. Null, or the part's own name, names it again in its
 * standard look. A hidden label is shown; a part with no label gets one
 * (#1254, the Agent's set-display-alias).
 */
export function planDisplayAlias(input: {
  document: SchematicDocument;
  instanceId: string;
  alias: string | null;
  labelFor: GroupNamingInput["labelFor"];
  newLabelFor: GroupNamingInput["newLabelFor"];
}): { ok: true; edits: SchematicEdit[] } | { ok: false; message: string } {
  const { document, instanceId } = input;
  const [part] = namedParts(document, [instanceId]);
  if (!part)
    return {
      ok: false,
      message: `${instanceId} has no name to show an alias for; give it a reference first`,
    };
  const existing = input.labelFor(document, instanceId);
  const label = existing ?? input.newLabelFor(document, instanceId);
  if (!label) return { ok: false, message: `${part.name} has no name label` };
  const { visible: _visible, ...shown } = label;
  const alias = input.alias?.trim();
  if (!alias || alias === part.name)
    return existing?.binding && existing.visible !== false
      ? { ok: true, edits: [] }
      : {
          ok: true,
          edits: [
            {
              kind: "upsert_schematic_annotation",
              annotation: boundLabel(shown, part, part.name),
            },
          ],
        };
  // Drawn as a name is: A1 reads A₁ like a Reference.
  const look =
    (part.terminalId
      ? roleLabelFormat("voltage-node", alias)
      : roleLabelFormat(
          "device-reference",
          alias,
          part.deviceLetter && alias.startsWith(part.deviceLetter)
            ? { deviceLetter: part.deviceLetter }
            : {},
        )) ?? labelTextDocument(alias, document.presentation);
  const {
    binding: _binding,
    content: _content,
    formatOverride: _format,
    ...rest
  } = shown;
  return {
    ok: true,
    edits: [
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...rest, content: look },
      },
    ],
  };
}
