import type { AgentCommandPlan } from "@icm/agent-adapter";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import { endpointKey, resolveDocumentLogicalNets } from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";

/**
 * A command planned in steps, each committed to a private draft as its own
 * Cell transaction, so the next step plans on what the last one left (its
 * wires normalized, its Junctions swept). The steps go to the editor as one
 * Project transaction: one commit, one undo.
 */
export class DraftSteps {
  readonly structureEdits: ProjectStructureEdit[] = [];

  constructor(
    public project: CircuitProject,
    readonly documentId: string,
    /** What a refusal adds, as "nothing was moved". */
    readonly outcome: string,
  ) {}

  get document(): SchematicDocument {
    return this.project.documents.find((item) => item.id === this.documentId)!;
  }

  /** Commit one step to the draft; a refusal names `step`. */
  apply(plan: AgentCommandPlan | readonly SchematicEdit[], step: string) {
    const isEdits = (value: typeof plan): value is readonly SchematicEdit[] =>
      Array.isArray(value);
    const edits = isEdits(plan)
      ? plan
      : "edits" in plan
        ? plan.edits
        : undefined;
    const next: ProjectStructureEdit[] =
      edits === undefined
        ? [
            ...(plan as { structureEdits: ProjectStructureEdit[] })
              .structureEdits,
          ]
        : edits.length
          ? [
              {
                kind: "transact_document",
                documentId: this.documentId,
                expectedRevision: this.document.revision,
                edits: [...edits],
              },
            ]
          : [];
    if (!next.length) return;
    const result = executeProjectTransaction(this.project, {
      transactionId: `agent-step-${this.structureEdits.length}`,
      projectId: this.project.id,
      expectedStructureRevision: this.project.structureRevision,
      actor: { kind: "agent", id: "command-planner" },
      edits: next,
    });
    if (!result.ok)
      throw new Error(`${step}: ${result.error.message}; ${this.outcome}`);
    this.project = result.project;
    this.structureEdits.push(...next);
  }
}

/** A pin's Net as the netlist sees it: its name, scope and fellow pins. */
export interface PinNet {
  name: string;
  scope: string;
  pins: readonly string[];
}

/** Each pin's Net, by the pin's endpoint key. */
export function netMembership(
  document: SchematicDocument,
): Map<string, PinNet> {
  const terminals = new Map(
    document.nets.map((net) => [
      net.id,
      net.terminals.map((pin) => endpointKey({ kind: "terminal", ...pin })),
    ]),
  );
  const membership = new Map<string, PinNet>();
  for (const group of resolveDocumentLogicalNets(document).groups) {
    const pins = group.baseNetIds
      .flatMap((id) => terminals.get(id) ?? [])
      .sort();
    const net = { name: group.name ?? "", scope: group.scope ?? "", pins };
    for (const pin of pins) membership.set(pin, net);
  }
  return membership;
}

/**
 * The pins whose Net differs between two memberships, as Reference.pin;
 * `ignored` pins, such as new markers', are left out.
 */
export function pinsOnChangedNets(
  document: SchematicDocument,
  before: ReadonlyMap<string, PinNet>,
  after: ReadonlyMap<string, PinNet>,
  ignored: (key: string) => boolean = () => false,
): string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => !ignored(key))
    .sort();
  const identity = (net: PinNet | undefined) =>
    net
      ? `${net.name}|${net.scope}|${net.pins.filter((key) => !ignored(key)).join(",")}`
      : undefined;
  return keys
    .filter((key) => identity(before.get(key)) !== identity(after.get(key)))
    .map((key) => {
      const [, instanceId = "", pinName = ""] = key.split(":");
      const reference =
        document.instances.find((item) => item.id === instanceId)?.reference ??
        instanceId;
      return `${reference}.${pinName}`;
    });
}

/** The Project's SPICE netlist, or undefined while export is blocked. */
export function spiceNetlist(project: CircuitProject): string | undefined {
  const exported = createDesignNetlistExport(project, { format: "spice" });
  return exported.status === "ready" ? exported.file.text : undefined;
}
