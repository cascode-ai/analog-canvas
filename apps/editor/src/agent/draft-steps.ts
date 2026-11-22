import type { AgentCommandPlan } from "@icm/agent-adapter";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import { endpointKey, resolveDocumentLogicalNets } from "@icm/derived";
import {
  projectCellInterface,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
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

/** What differs between two netlists, as the first line added or dropped. */
export function netlistChange(before: string, after: string): string {
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const was = lines(before);
  const now = lines(after);
  const dropped = was.filter((line) => !now.includes(line));
  const added = now.filter((line) => !was.includes(line));
  const what = (line: string) =>
    /^\.global\b/i.test(line)
      ? " (a .global line)"
      : /^\.subckt\b/i.test(line)
        ? " (a Cell's port list)"
        : "";
  if (dropped[0] !== undefined && added[0] !== undefined)
    return `"${dropped[0]}" would read "${added[0]}"${what(added[0]) || what(dropped[0])}`;
  if (added[0] !== undefined)
    return `it would add "${added[0]}"${what(added[0])}`;
  if (dropped[0] !== undefined)
    return `it would lose "${dropped[0]}"${what(dropped[0])}`;
  return "its lines would change order";
}

/**
 * What the netlist says of every Cell, read off the drawing for when it
 * cannot be exported: each pin's Net (name, scope and fellow pins), each
 * Cell Pin in order with its direction and supply role, and the Nets MOS
 * bodies take. Keyed by what it is about, as "amp: RA.1"; `ignored` pins, such as
 * markers drawn or removed, are left out.
 */
export function electricalFacts(
  project: CircuitProject,
  ignored: (key: string) => boolean = () => false,
): Map<string, string> {
  const facts = new Map<string, string>();
  for (const document of project.documents) {
    const cell = document.name || document.id;
    const reference = (instanceId: string) =>
      document.instances.find((item) => item.id === instanceId)?.reference ??
      instanceId;
    const pinName = (key: string) => {
      const [, instanceId = "", pin = ""] = key.split(":");
      return `${reference(instanceId)}.${pin}`;
    };
    const logical = resolveDocumentLogicalNets(document);
    const describe = (netId: string | undefined) => {
      const group = netId ? logical.byBaseNetId.get(netId) : undefined;
      return group
        ? `${group.name ?? "unnamed"} ${group.scope ?? "local"}`
        : "none";
    };
    // A Pin's supply role orders the Cell's ports in its .subckt line.
    const role = (netIds: readonly string[]) =>
      [
        ...new Set(
          netIds.map(
            (netId) => logical.byBaseNetId.get(netId)?.powerDomain ?? "none",
          ),
        ),
      ].join("/");
    for (const group of logical.groups) {
      const pins = document.nets
        .filter((net) => group.baseNetIds.includes(net.id))
        .flatMap((net) =>
          net.terminals.map((pin) => endpointKey({ kind: "terminal", ...pin })),
        )
        .filter((key) => !ignored(key));
      const named = pins.map(pinName).sort();
      for (const key of pins)
        facts.set(
          `${cell}: ${pinName(key)}`,
          `${describe(group.id)} with ${named.filter((other) => other !== pinName(key)).join(", ") || "nothing"}`,
        );
    }
    projectCellInterface(document.netlist).ports.forEach((port, index) =>
      facts.set(
        `${cell}: Cell Pin ${port.name}`,
        `${port.direction}, number ${index + 1}, supply role ${role(port.netIds)}`,
      ),
    );
    for (const [field, netId] of Object.entries(document.mosBulkDefaults ?? {}))
      facts.set(`${cell}: ${field} body default`, describe(netId ?? undefined));
    for (const instance of document.instances)
      if (instance.mosBulkBinding)
        facts.set(
          `${cell}: ${reference(instance.id)} body`,
          describe(instance.mosBulkBinding.netId),
        );
  }
  return facts;
}
