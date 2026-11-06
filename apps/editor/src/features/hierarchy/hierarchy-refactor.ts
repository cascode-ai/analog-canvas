// Reshaping the hierarchy: copy a Cell for one instance, switch the Cell an
// instance uses, turn selected parts into a new Cell, and flatten an instance
// back into its parent. Each plan is one Project transaction, so one Undo
// reverts it, and the edit engine validates it like any other edit.
import {
  createHierarchyInstance,
  executeProjectTransaction,
  planCellSelectionDeletion,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveProjectNetNameProjection,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  createCellDocument,
  projectCellInterface,
  type CircuitProject,
  type Instance,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  unplacedCellSymbol,
  type SymbolResolver,
} from "@icm/symbols";

import {
  captureDocumentComposition,
  copySelection,
  type SchematicClipboard,
} from "../clipboard/clipboard";
import {
  clipboardPlacementAnchor,
  orientClipboard,
} from "../clipboard/copy-placement";
import { proposePaste } from "../clipboard/paste-proposal";
import { planPlacedCellPin } from "../component-insert/cell-pin-placement";
import type { PlacementOrientationOperation } from "../../interaction/shortcut-orientation";
import { inferPinDirection, type ChildPortDraft } from "./new-child-cell";
import { cellPlacementIssue } from "./project-structure-commands";

const CELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const LITERAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?[a-z]*$/iu;

type Terminal = { instanceId: string; pinName: string };

/** One instance of a Cell, in the definition that places it. */
export interface CellUse {
  documentId: string;
  instanceId: string;
}

/** A Pin of a Cell made from a selection: one per Net leaving the parts. */
export interface SelectionCellPin extends ChildPortDraft {
  netId: string;
}

function requireCell(project: CircuitProject, id: string): SchematicDocument {
  const cell = project.documents.find((item) => item.id === id);
  if (!cell?.netlist) throw new Error(`Cell not found: ${id}`);
  return cell;
}

function cellInstance(parent: SchematicDocument, instanceId: string) {
  const instance = parent.instances.find((item) => item.id === instanceId);
  const binding = instance?.netlist?.binding;
  if (!instance || binding?.kind !== "subcircuit")
    throw new Error("Choose an instance of a Cell");
  return { instance, childId: binding.childDocumentId };
}

function transactOn(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
): ProjectStructureEdit {
  return {
    kind: "transact_document",
    documentId: document.id,
    expectedRevision: document.revision,
    edits: [...edits],
  };
}

function applyDraft(
  project: CircuitProject,
  edits: readonly ProjectStructureEdit[],
): CircuitProject {
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "hierarchy-refactor-draft",
    actor: { kind: "human", id: "human-local" },
    edits: [...edits],
  });
  if (!result.ok)
    throw new Error(
      result.diagnostics.map((item) => item.message).join("; ") ||
        "The new Cell could not be built",
    );
  return result.project;
}

function pinNames(cell: SchematicDocument): string[] {
  return projectCellInterface(cell.netlist!).ports.map((port) => port.name);
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function freeInstanceId(document: SchematicDocument, base: string): string {
  const taken = new Set(document.instances.map((item) => item.id));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1)
    if (!taken.has(`${base}_${index}`)) return `${base}_${index}`;
}

function nextCellReference(document: SchematicDocument): string {
  const taken = new Set(
    document.instances.flatMap((item) =>
      [item.id, item.reference ?? ""].map((text) => text.toLowerCase()),
    ),
  );
  for (let index = 1; ; index += 1)
    if (!taken.has(`x${index}`)) return `X${index}`;
}

/** A Cell name no Cell uses yet: the name itself, else name_2, name_3, … */
export function freeCellName(project: CircuitProject, base: string): string {
  const taken = new Set(
    project.documents.map((cell) =>
      (cell.netlist?.name ?? cell.name).toLowerCase(),
    ),
  );
  const cleaned = base.replace(/[^A-Za-z0-9_]/gu, "_");
  const stem = (CELL_NAME.test(cleaned) ? cleaned : `cell_${cleaned}`).replace(
    /_\d+$/u,
    "",
  );
  if (!taken.has(stem.toLowerCase())) return stem;
  for (let index = 2; ; index += 1)
    if (!taken.has(`${stem}_${index}`.toLowerCase())) return `${stem}_${index}`;
}

function assertNewCellName(project: CircuitProject, name: string): void {
  if (!CELL_NAME.test(name))
    throw new Error(
      "Cell name must start with a letter or underscore and contain letters, digits or underscores",
    );
  if (
    project.documents.some(
      (cell) => cell.netlist?.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error(`A Cell named ${name} already exists`);
}

/** Every instance of a Cell, in every definition that places it. */
export function cellUses(project: CircuitProject, cellId: string): CellUse[] {
  return project.documents.flatMap((document) =>
    document.instances.flatMap((instance) =>
      instance.netlist?.binding?.kind === "subcircuit" &&
      instance.netlist.binding.childDocumentId === cellId
        ? [{ documentId: document.id, instanceId: instance.id }]
        : [],
    ),
  );
}

/**
 * Bind an instance to another Cell with the same Pins: its symbol and Cell
 * change together, Pin spellings follow the new Cell, and overrides of
 * parameters the new Cell does not declare are dropped.
 */
function rebindEdits(
  instance: Instance,
  from: SchematicDocument,
  to: SchematicDocument,
): SchematicEdit[] {
  const target = new Map(
    pinNames(to).map((name) => [name.toLowerCase(), name]),
  );
  const pinMap = Object.fromEntries(
    pinNames(from).flatMap((name) => {
      const next = target.get(name.toLowerCase());
      return next && next !== name ? [[name, next]] : [];
    }),
  );
  const declared = new Set(
    to.netlist!.formalParameters.map((parameter) =>
      parameter.name.toLowerCase(),
    ),
  );
  const stale = Object.keys(instance.netlist?.parameters ?? {}).filter(
    (name) => !declared.has(name.toLowerCase()),
  );
  return [
    {
      kind: "set_instance_binding",
      instanceId: instance.id,
      binding: { kind: "subcircuit", childDocumentId: to.id },
    },
    {
      kind: "set_instance_symbol",
      instanceId: instance.id,
      symbolId: hierarchicalSymbolId(to.netlist!.name),
      ...(Object.keys(pinMap).length ? { pinMap } : {}),
    },
    ...(stale.length
      ? [
          {
            kind: "patch_instance_netlist_parameters" as const,
            instanceId: instance.id,
            unset: stale,
          },
        ]
      : []),
  ];
}

/**
 * Give one instance its own copy of its Cell, so that it can change without
 * changing the Cell's other uses. The copy calls the same children.
 */
export function planMakeUniqueCell(
  project: CircuitProject,
  parentId: string,
  instanceId: string,
  copyId: string,
  copyName?: string,
): { name: string; sourceName: string; edits: ProjectStructureEdit[] } {
  const parent = requireCell(project, parentId);
  const { instance, childId } = cellInstance(parent, instanceId);
  const source = requireCell(project, childId);
  const name = copyName ?? freeCellName(project, source.netlist!.name);
  assertNewCellName(project, name);
  const copy = structuredClone(source);
  copy.id = copyId;
  copy.name = name;
  copy.netlist!.name = name;
  // The copy is the author's own Cell, not a second import of the source.
  delete copy.sourceBinding;
  delete copy.importReference;
  return {
    name,
    sourceName: source.name,
    edits: [
      { kind: "add_document", document: copy },
      transactOn(parent, rebindEdits(instance, source, copy)),
    ],
  };
}

/** Each Cell an instance could switch to, with the reason it cannot, if any. */
export function replacementCandidates(
  project: CircuitProject,
  uses: readonly CellUse[],
  sourceId: string,
): { cell: SchematicDocument; issue?: string }[] {
  const source = requireCell(project, sourceId);
  const wanted = new Map(
    pinNames(source).map((name) => [name.toLowerCase(), name]),
  );
  const parents = [...new Set(uses.map((use) => use.documentId))];
  return project.documents
    .filter((cell) => cell.id !== sourceId && cell.netlist)
    .map((cell) => {
      const offered = new Map(
        pinNames(cell).map((name) => [name.toLowerCase(), name]),
      );
      const missing = [...wanted].filter(([key]) => !offered.has(key));
      const extra = [...offered].filter(([key]) => !wanted.has(key));
      const cycle = parents
        .map((id) => cellPlacementIssue(project, id, cell.id))
        .find(Boolean);
      const issue =
        cycle ??
        (missing.length || extra.length
          ? `Pins differ: ${[
              ...missing.map(([, name]) => `no ${name}`),
              ...extra.map(([, name]) => `extra ${name}`),
            ].join(", ")}`
          : undefined);
      return issue ? { cell, issue } : { cell };
    });
}

/** Switch instances to another Cell with the same Pins, in one step. */
export function planReplaceCell(
  project: CircuitProject,
  uses: readonly CellUse[],
  replacementId: string,
): ProjectStructureEdit[] {
  const to = requireCell(project, replacementId);
  const byDocument = new Map<string, SchematicEdit[]>();
  for (const use of uses) {
    const parent = requireCell(project, use.documentId);
    const { instance, childId } = cellInstance(parent, use.instanceId);
    if (childId === replacementId) continue;
    const issue = cellPlacementIssue(project, parent.id, replacementId);
    if (issue) throw new Error(issue);
    const edits = byDocument.get(parent.id) ?? [];
    edits.push(...rebindEdits(instance, requireCell(project, childId), to));
    byDocument.set(parent.id, edits);
  }
  return [...byDocument].map(([id, edits]) =>
    transactOn(requireCell(project, id), edits),
  );
}

function selectableParts(
  parent: SchematicDocument,
  instanceIds: readonly string[],
): Set<string> {
  // A Cell's own Pins stay with it; they are its interface, not its parts.
  const pins = new Set(
    parent.netlist?.terminals.flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ) ?? [],
  );
  return new Set(
    instanceIds.filter(
      (id) => !pins.has(id) && parent.instances.some((item) => item.id === id),
    ),
  );
}

/** The Pins a Cell made from these parts needs, named after their Nets. */
export function selectionCellPins(
  project: CircuitProject,
  parentId: string,
  instanceIds: readonly string[],
): SelectionCellPin[] {
  const parent = requireCell(project, parentId);
  const parts = selectableParts(parent, instanceIds);
  const names =
    deriveProjectNetNameProjection(project).byDocumentId.get(parentId);
  const used = new Set<string>();
  return parent.nets.flatMap((net, index) => {
    const inside = net.terminals.some((item) => parts.has(item.instanceId));
    const outside = net.terminals.some((item) => !parts.has(item.instanceId));
    if (!inside || !outside) return [];
    const spelled = (names?.get(net.id)?.preferredSpelling ?? "").replace(
      /[^A-Za-z0-9_]/gu,
      "_",
    );
    const base = /^[A-Za-z_]/u.test(spelled) ? spelled : `n${index + 1}`;
    let name = base;
    for (let count = 2; used.has(name.toLowerCase()); count += 1)
      name = `${base}_${count}`;
    used.add(name.toLowerCase());
    return [{ name, direction: inferPinDirection(name), netId: net.id }];
  });
}

function boundsOf(points: readonly { x: number; y: number }[]) {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function partPositions(parent: SchematicDocument, parts: ReadonlySet<string>) {
  return parent.instances.flatMap((item) =>
    parts.has(item.id) && item.placement ? [item.placement.position] : [],
  );
}

/** Each placed part's box as the canvas draws it, but those in `skip`. */
function partBoxes(
  document: SchematicDocument,
  resolver: SymbolResolver,
  skip: ReadonlySet<string> = new Set(),
): Rect[] {
  return visibleInstanceBounds(document, resolver).flatMap((item) =>
    skip.has(item.id) ? [] : [item.bounds],
  );
}

/**
 * The first candidate offset, snapped, at which `boxes` keep two grid steps
 * from every obstacle; else one that puts them beside all of them, right.
 */
function clearOffset(
  boxes: readonly Rect[],
  obstacles: readonly Rect[],
  candidates: readonly [Point, ...Point[]],
  grid: number,
): Point {
  const gap = 2 * grid;
  const clear = (offset: Point) =>
    boxes.every((box) =>
      obstacles.every(
        (other) =>
          box.x + offset.x >= other.x + other.width + gap ||
          other.x >= box.x + offset.x + box.width + gap ||
          box.y + offset.y >= other.y + other.height + gap ||
          other.y >= box.y + offset.y + box.height + gap,
      ),
    );
  const snapped = candidates.map((point) => ({
    x: snap(point.x, grid),
    y: snap(point.y, grid),
  }));
  const free = snapped.find(clear);
  if (free || !boxes.length || !obstacles.length) return free ?? snapped[0]!;
  const right = Math.max(...obstacles.map((other) => other.x + other.width));
  const left = Math.min(...boxes.map((box) => box.x));
  return {
    x: Math.ceil((right + 2 * gap - left) / grid) * grid,
    y: snapped[0]!.y,
  };
}

/** Parameter names an expression value refers to, as `{2*gain}` does. */
function referencedNames(values: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const [, expression] of value.matchAll(/\{([^{}]*)\}/gu))
      for (const [word] of expression!.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/gu))
        names.add(word.toLowerCase());
  }
  return names;
}

/**
 * Move the selected parts into a new Cell and put an instance of it in their
 * place. Inner Nets and wires move with the parts; each Net that also leaves
 * them becomes a Pin, joined in the parent to the Net it came from. Parent
 * parameters the parts use become the Cell's parameters, passed through.
 */
export function planCellFromSelection(
  project: CircuitProject,
  parentId: string,
  instanceIds: readonly string[],
  childId: string,
  name: string,
  pins: readonly SelectionCellPin[],
  sequence: number,
): { instanceId: string; edits: ProjectStructureEdit[] } {
  assertNewCellName(project, name);
  const parent = requireCell(project, parentId);
  const parts = selectableParts(parent, instanceIds);
  if (!parts.size)
    throw new Error("Select the parts to move into the new Cell");
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const clipboard = copySelection(parent, [...parts], [], undefined, resolver);
  if (!clipboard) throw new Error("Nothing to move into the new Cell");

  // The parts keep their coordinates inside the new Cell.
  let draft: CircuitProject = {
    ...project,
    documents: [
      ...project.documents,
      createCellDocument(childId, name, parent.presentation),
    ],
  };
  const paste = proposePaste(
    requireCell(draft, childId),
    clipboard,
    { x: 0, y: 0 },
    sequence,
    draft,
    createProjectSymbolResolver(draft, builtInSymbols),
  );
  if (paste.errors.length) throw new Error(paste.errors.join("; "));
  const passed = (parent.netlist?.formalParameters ?? []).filter((parameter) =>
    referencedNames(
      clipboard.instances.flatMap((item) =>
        Object.values(item.netlist?.parameters ?? {}),
      ),
    ).has(parameter.name.toLowerCase()),
  );
  draft = applyDraft(draft, [
    transactOn(requireCell(draft, childId), [
      ...paste.edits,
      ...(passed.length
        ? [
            {
              kind: "set_cell_formal_parameters" as const,
              formalParameters: passed.map((parameter) => ({ ...parameter })),
            },
          ]
        : []),
    ]),
  ]);

  // One Pin per leaving Net, beside the parts: outputs right, others left.
  const spots = partPositions(parent, parts);
  const box = boundsOf(spots) ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const grid = parent.presentation.grid;
  const rows = { left: 0, right: 0 };
  for (const pin of pins) {
    const inside = (
      parent.nets.find((net) => net.id === pin.netId)?.terminals ?? []
    )
      .filter((item) => parts.has(item.instanceId))
      .map((item) => ({
        kind: "terminal" as const,
        instanceId: paste.idRemap.instances[item.instanceId] ?? item.instanceId,
        pinName: item.pinName,
      }));
    const first = inside[0];
    if (!first) continue;
    const output = pin.direction === "output";
    const row = output ? rows.right++ : rows.left++;
    const portId = freeInstanceId(requireCell(draft, childId), "pin");
    const port = {
      kind: "terminal" as const,
      instanceId: portId,
      pinName: "P",
    };
    draft = applyDraft(
      draft,
      planPlacedCellPin(
        draft,
        childId,
        createProjectSymbolResolver(draft, builtInSymbols),
        {
          instance: {
            id: portId,
            symbolId: "port",
            placement: {
              position: {
                x: snap(output ? box.maxX + 80 : box.minX - 80, grid),
                y: snap(box.minY + row * 40, grid),
              },
              rotation: output ? 180 : 0,
              mirror: "none",
            },
          },
          terminalId: `terminal-${portId}`,
          name: pin.name,
          netId: `net-${portId}`,
          direction: pin.direction,
          connectionEdits: [
            {
              kind: "connect_endpoints",
              from: port,
              to: first,
              newNetId: `net-${portId}`,
            },
            ...inside.slice(1).map((endpoint) => ({
              kind: "connect_endpoints" as const,
              from: first,
              to: endpoint,
            })),
          ],
        },
      ),
    );
  }
  const child = structuredClone(requireCell(draft, childId));
  const symbol = unplacedCellSymbol(child);
  if (symbol) child.presentation.cellSymbol = symbol;

  // In the parent the parts and their inner wires go; wires that left them
  // stay, still on their Nets, which the new block's Pins join.
  const deletion = planCellSelectionDeletion(
    parent,
    resolver,
    {
      instanceIds: [...parts],
      routeIds: clipboard.routes.map((route) => route.id),
      junctionIds: clipboard.junctions.map((junction) => junction.id),
    },
    sequence + 1,
  );
  const reference = nextCellReference(parent);
  const instance = createHierarchyInstance(
    freeInstanceId(parent, reference),
    child,
    { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    reference,
  );
  // The block takes the parts' place: their centre, else a spot one of them
  // leaves, whichever is clear of the parts that stay.
  instance.placement!.position = clearOffset(
    partBoxes(
      { ...parent, instances: [instance] },
      createProjectSymbolResolver(
        {
          ...draft,
          documents: draft.documents.map((cell) =>
            cell.id === childId ? child : cell,
          ),
        },
        builtInSymbols,
      ),
    ),
    partBoxes(parent, resolver, parts),
    [{ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, ...spots],
    grid,
  );
  instance.netlist!.parameters = Object.fromEntries(
    passed.map((parameter) => [parameter.name, `{${parameter.name}}`]),
  );
  const joins: SchematicEdit[] = pins.flatMap((pin) => {
    const outside = parent.nets
      .find((net) => net.id === pin.netId)
      ?.terminals.find((item) => !parts.has(item.instanceId));
    return outside
      ? [
          {
            kind: "connect_endpoints" as const,
            from: {
              kind: "terminal" as const,
              instanceId: instance.id,
              pinName: pin.name,
            },
            to: { kind: "terminal" as const, ...outside },
          },
        ]
      : [];
  });
  return {
    instanceId: instance.id,
    edits: [
      { kind: "add_document", document: child },
      transactOn(parent, [
        ...deletion.routing.edits,
        { kind: "add_instance", instance },
        ...joins,
      ]),
    ],
  };
}

/** The value each child parameter takes at this instance, without braces. */
function instanceParameterValues(
  child: SchematicDocument,
  instance: Instance,
): Map<string, string> {
  const overrides = instance.netlist?.parameters ?? {};
  const values = new Map<string, string>();
  for (const parameter of child.netlist!.formalParameters) {
    const key = Object.keys(overrides).find(
      (name) => name.toLowerCase() === parameter.name.toLowerCase(),
    );
    const value = (key ? overrides[key] : undefined) ?? parameter.defaultValue;
    if (value !== undefined)
      values.set(
        parameter.name.toLowerCase(),
        String(value)
          .trim()
          .replace(/^\{([\s\S]*)\}$/u, "$1"),
      );
  }
  return values;
}

/** Write a child's parameter references in the parent's terms. */
function substituteParameters(
  value: string,
  values: ReadonlyMap<string, string>,
): string {
  return value.replace(/\{([^{}]*)\}/gu, (whole, expression: string) => {
    const exact = values.get(expression.trim().toLowerCase());
    if (exact !== undefined) return LITERAL.test(exact) ? exact : `{${exact}}`;
    const replaced = expression.replace(
      /\b[A-Za-z_][A-Za-z0-9_]*\b/gu,
      (word) => {
        const bound = values.get(word.toLowerCase());
        return bound === undefined ? word : `(${bound})`;
      },
    );
    return replaced === expression ? whole : `{${replaced}}`;
  });
}

function withParameterValues(
  instance: Instance,
  values: ReadonlyMap<string, string>,
): Instance {
  const parameters = instance.netlist?.parameters;
  if (!parameters || !values.size) return instance;
  return {
    ...instance,
    netlist: {
      ...instance.netlist!,
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          typeof value === "string"
            ? substituteParameters(value, values)
            : value,
        ]),
      ),
    },
  };
}

function orientationOperations(
  placement: Instance["placement"],
): PlacementOrientationOperation[] {
  if (!placement) return [];
  const operations: PlacementOrientationOperation[] = [];
  const turn = ((placement.rotation % 360) + 360) % 360;
  for (let remaining = turn; remaining > 0;) {
    const step = remaining >= 180 ? 180 : remaining >= 90 ? 90 : 45;
    operations.push({ kind: "rotate", deltaDegrees: step });
    remaining -= step;
  }
  if (placement.mirror === "horizontal" || placement.mirror === "both")
    operations.push({ kind: "reflect", direction: "left-right" });
  if (placement.mirror === "vertical" || placement.mirror === "both")
    operations.push({ kind: "reflect", direction: "top-bottom" });
  return operations;
}

/**
 * Replace an instance with its Cell's parts, drawn as the instance was:
 * turned and mirrored like it, centred on it. Each Net that reached one of
 * the Cell's Pins joins the parent Net that Pin was on. Parameter references
 * take the instance's values. The parts arrive connected but unrouted.
 */
export function planFlattenInstance(
  project: CircuitProject,
  parentId: string,
  instanceId: string,
  sequence: number,
): {
  childName: string;
  /** The parts as they are in the parent, to select after flattening. */
  instanceIds: string[];
  edits: ProjectStructureEdit[];
} {
  const parent = requireCell(project, parentId);
  const { instance, childId } = cellInstance(parent, instanceId);
  const child = requireCell(project, childId);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const deletion = planCellSelectionDeletion(
    parent,
    resolver,
    { instanceIds: [instanceId], routeIds: [], junctionIds: [] },
    sequence,
  );
  const composed = captureDocumentComposition(child);
  const pins = new Set(
    child.netlist!.terminals.flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ),
  );
  const parts = (composed?.instances ?? []).filter(
    (item) => !pins.has(item.id),
  );
  if (!composed || !parts.length)
    return {
      childName: child.name,
      instanceIds: [],
      edits: [transactOn(parent, deletion.routing.edits)],
    };
  const kept = new Set(parts.map((item) => item.id));
  const values = instanceParameterValues(child, instance);
  const nets = composed.nets
    .map((net) => ({
      ...net,
      terminals: net.terminals.filter((item) => kept.has(item.instanceId)),
    }))
    .filter((net) => net.terminals.length > 0);
  // Inner Nets keep their source names, prefixed with the instance's
  // reference where the parent already has the name; Pin Nets join the
  // parent's own Nets and take their names.
  const pinNets = new Set(child.netlist!.terminals.map((pin) => pin.netId));
  const keptNets = new Set(nets.map((net) => net.id));
  const taken = new Set(
    [
      ...[
        ...(
          deriveProjectNetNameProjection(project).byDocumentId.get(parent.id) ??
          new Map()
        ).values(),
      ].map((item) => item.preferredSpelling),
      ...parent.connectivityEvidence.map((evidence) =>
        evidence.kind === "net-name-hint" ? evidence.sourceName : undefined,
      ),
    ].flatMap((name) => (name ? [name.toLowerCase()] : [])),
  );
  const prefix = instance.reference ?? instance.id;
  const names = child.connectivityEvidence.flatMap((evidence) => {
    if (
      evidence.kind !== "net-name-hint" ||
      pinNets.has(evidence.netId) ||
      !keptNets.has(evidence.netId)
    )
      return [];
    const base = taken.has(evidence.sourceName.toLowerCase())
      ? `${prefix}_${evidence.sourceName}`
      : evidence.sourceName;
    let name = base;
    for (let count = 2; taken.has(name.toLowerCase()); count += 1)
      name = `${base}_${count}`;
    taken.add(name.toLowerCase());
    return [{ ...evidence, sourceName: name }];
  });
  const { inductorCouplings: _couplings, ...rest } = composed;
  const clipboard: SchematicClipboard = {
    ...rest,
    instances: parts.map((item) => withParameterValues(item, values)),
    cellTerminals: [],
    formalParameters: [],
    nets,
    routes: [],
    junctions: [],
    noConnects: [],
    connectivityEvidence: names,
    layoutGroups: [],
    constraints: [],
    annotations: composed.annotations.filter(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        kept.has(annotation.anchor.objectId),
    ),
  };
  const oriented = orientClipboard(
    clipboard,
    orientationOperations(instance.placement),
  );
  const anchor = clipboardPlacementAnchor(oriented) ?? { x: 0, y: 0 };
  const at = instance.placement?.position ?? anchor;
  // A Cell's drawing is larger than its block: where the block was it may
  // cover the parent's other parts, and then it goes beside them.
  const offset = clearOffset(
    partBoxes({ ...parent, instances: oriented.instances }, resolver),
    partBoxes(parent, resolver, new Set([instanceId])),
    [{ x: at.x - anchor.x, y: at.y - anchor.y }],
    parent.presentation.grid,
  );
  const paste = proposePaste(
    parent,
    oriented,
    offset,
    sequence + 1,
    project,
    resolver,
  );
  if (paste.errors.length) throw new Error(paste.errors.join("; "));
  const joins: SchematicEdit[] = child.netlist!.terminals.flatMap((pin) => {
    const inner: Terminal | undefined = nets.find((net) => net.id === pin.netId)
      ?.terminals[0];
    const outer = parent.nets
      .find((net) =>
        net.terminals.some(
          (item) =>
            item.instanceId === instanceId &&
            item.pinName.toLowerCase() === pin.name.toLowerCase(),
        ),
      )
      ?.terminals.find((item) => item.instanceId !== instanceId);
    return inner && outer
      ? [
          {
            kind: "connect_endpoints" as const,
            from: {
              kind: "terminal" as const,
              instanceId:
                paste.idRemap.instances[inner.instanceId] ?? inner.instanceId,
              pinName: inner.pinName,
            },
            to: { kind: "terminal" as const, ...outer },
          },
        ]
      : [];
  });
  return {
    childName: child.name,
    instanceIds: paste.instanceIds,
    edits: [
      transactOn(parent, [...deletion.routing.edits, ...paste.edits, ...joins]),
    ],
  };
}
