import {
  executeProjectTransaction,
  planCreateCell,
  planPlaceCellInstance,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  createCellDocument,
  type Annotation,
  type CellPortDirection,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import { cellPinNameRole } from "@icm/spice";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planPlacedCellPin } from "../component-insert/cell-pin-placement";

export interface ChildPortDraft {
  name: string;
  direction: CellPortDirection;
}

/**
 * A first guess from a new Pin's name, read as the SPICE importer reads
 * imported Pins: supplies and grounds are passive, outputs are outputs and
 * everything else is an input. The author can change it at once.
 */
export function inferPinDirection(name: string): ChildPortDraft["direction"] {
  const role = cellPinNameRole(name);
  if (role === "supply" || role === "ground") return "passive";
  return role === "output" ? "output" : "input";
}

/**
 * A Cell's name is its SPICE subcircuit name. The editor asks for one that
 * exports unchanged; an Agent's or an import's other names export
 * normalized, with a warning.
 */
export const CELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Why `name` cannot name a Cell of this Project, new or renamed; undefined
 * when it can. `exceptId` is the Cell being renamed.
 */
export function cellNameIssue(
  project: CircuitProject,
  name: string,
  exceptId?: string,
): string | undefined {
  if (!CELL_NAME.test(name))
    return "Use letters, digits and _, starting with a letter or _";
  const folded = name.toLowerCase();
  if (
    project.documents.some(
      (cell) =>
        cell.id !== exceptId &&
        (cell.netlist?.name ?? cell.name).toLowerCase() === folded,
    )
  )
    return `A Cell named ${name} already exists`;
  return project.externalSubcircuitDefinitions.some(
    (definition) => definition.name.toLowerCase() === folded,
  )
    ? `An external circuit is named ${name}`
    : undefined;
}

/**
 * Add the Pin names typed or pasted as one string (separated by spaces,
 * commas or semicolons). A name already present, in any case, is skipped.
 */
export function addChildPortNames(
  ports: readonly ChildPortDraft[],
  text: string,
): { ports: ChildPortDraft[]; skipped: string[] } {
  const next = [...ports];
  const skipped: string[] = [];
  for (const name of text.split(/[\s,;]+/u).filter(Boolean)) {
    if (next.some((port) => port.name.toLowerCase() === name.toLowerCase()))
      skipped.push(name);
    else next.push({ name, direction: inferPinDirection(name) });
  }
  return { ports: next, skipped };
}

/** Build an isolated draft with the same Pin planner used by canvas placement. */
export function createChildCellDraft(
  project: CircuitProject,
  parentId: string,
  id: string,
  name: string,
  ports: readonly ChildPortDraft[],
): SchematicDocument {
  const parent = project.documents.find((cell) => cell.id === parentId);
  if (!parent) throw new Error("Parent Cell no longer exists");
  const issue = cellNameIssue(project, name);
  if (issue) throw new Error(issue);
  if (ports.length > 64)
    throw new Error("Create up to 64 initial Ports; add more in the Cell");
  if (
    new Set(ports.map((port) => port.name.trim().toLowerCase())).size !==
    ports.length
  )
    throw new Error("Initial Port names must be distinct");
  let draftProject = {
    ...project,
    documents: [
      ...project.documents,
      createCellDocument(id, name, parent.presentation),
    ],
  };
  for (const [index, port] of ports.entries()) {
    const instanceId = `port-${index + 1}`;
    const endpoint = { kind: "terminal" as const, instanceId, pinName: "P" };
    const output = port.direction === "output";
    const edits = planPlacedCellPin(
      draftProject,
      id,
      createProjectSymbolResolver(draftProject, builtInSymbols),
      {
        instance: {
          id: instanceId,
          symbolId: "port",
          placement: {
            position: { x: output ? 120 : -120, y: index * 40 },
            rotation: output ? 180 : 0,
            mirror: "none",
          },
        },
        terminalId: `terminal-${index + 1}`,
        name: port.name,
        netId: `net-${index + 1}`,
        direction: port.direction,
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: endpoint,
            to: endpoint,
            newNetId: `net-${index + 1}`,
          },
        ],
      },
    );
    const result = executeProjectTransaction(draftProject, {
      projectId: project.id,
      expectedStructureRevision: draftProject.structureRevision,
      transactionId: `draft-port-${index}`,
      actor: { kind: "human", id: "human-local" },
      edits,
    });
    if (!result.ok)
      throw new Error(
        result.diagnostics.map((item) => item.message).join("; "),
      );
    draftProject = result.project;
  }
  return draftProject.documents.find((cell) => cell.id === id)!;
}

export function planChildCellPlacement(
  project: CircuitProject,
  parentId: string,
  child: SchematicDocument,
  instance: Instance,
  annotations: readonly Annotation[] = [],
): ProjectStructureEdit[] {
  if (
    project.documents.some(
      (cell) =>
        cell.id === child.id ||
        cell.netlist?.name.toLowerCase() === child.netlist?.name.toLowerCase(),
    )
  )
    throw new Error(
      "This Cell was created while placing. Start a new child again.",
    );
  const projected = { ...project, documents: [...project.documents, child] };
  return [
    ...planCreateCell(child),
    ...planPlaceCellInstance(projected, parentId, instance, annotations),
  ];
}
