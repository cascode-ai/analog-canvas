import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
  AgentCommandPlanNote,
} from "@icm/agent-adapter";
import { AgentCommandPlanningError } from "@icm/agent-adapter";
import {
  planSetDeviceModelTarget,
  executeProjectTransaction,
  type ProjectStructureEdit,
  planRoutingTransform,
  translateDraftingObject,
  planInstanceUnplacement,
  planCellReset,
  pinAnchoredPlacement,
  planRouteNet,
  planCreateCell,
  planSetVddConnectionMode,
  planUpdateCellTerminalDirection,
  planUpdateCellPortDirection,
  createHierarchyInstance,
  planPlaceCellInstance,
  planRenameCell,
  planDeleteCell,
  planBindCellParameter,
  planRenameCellParameter,
  planSetCellParameterDefault,
  planRemoveCellParameter,
  planRenameCellTerminal,
  planRemoveCellTerminal,
  planRemoveCellTerminals,
  planSetCellSymbolPins,
  planMoveRouteClearance,
  planCellSelectionDeletion,
  gateRoutingOperationPlan,
  createRoutingOperationPlan,
  planEnsureNamedNet,
  planElectricalMarkerRename,
  proposedStandalonePowerConnection,
  powerConnectionForSymbol,
  proposePowerRailSpan,
  type SchematicEdit,
  type TransformOperation,
  type RoutingOperationPlan,
} from "@icm/edit-engine";
import {
  createCellDocument,
  deriveStableId,
  routeEnd,
  flattenRichText,
  renamedLabelFormat,
  roleLabelFormat,
  projectCellInterface,
  foldNetName,
  labelTextDocument,
  type CircuitProject,
  type Instance,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";
import {
  createReferenceIndex,
  nextReference,
  referenceIssuesForInstance,
  referencePolicyForInstance,
} from "@icm/devices";
import {
  resolveDocumentStyleProfile,
  resolveRouteGeometry,
  resolveDocumentLogicalNets,
  resolveAnnotationName,
  instanceDisplayParameters,
  derivePowerRailComponent,
  netLabelAttachmentForText,
  netLabelBaselineForName,
} from "@icm/derived";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import {
  annotationDragPosition,
  draggedAnnotationAtPosition,
} from "../features/text-editing/annotation-drag-model";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { planDetachedMove } from "../features/selection/detached-move";
import { planSetProperties } from "./property-command";
import { planAddText, planSetText } from "./text-command";
import {
  planSelectionAlignment,
  type EdgeAlignmentMode,
} from "../features/selection/align-selection";
import { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import {
  defaultInstanceDisplayAnnotations,
  instanceLabelAnnotationFor,
  missingDefaultInstanceDisplayAnnotations,
} from "../features/instance-display/default-instance-display";
import { instanceDisplayEdits } from "../features/instance-display/instance-display-edits";
import { planDisplayAlias } from "../features/properties/group-naming";
import {
  arrangeInstanceLabelsReport,
  type LabelLeftInPlace,
} from "../features/instance-display/arrange-instance-labels";
import { withStruckLabelsArranged } from "../features/instance-display/struck-label-arrangement";
import { textbookLabelEdits } from "../features/instance-display/label-preset";
import { netLabelAtClearSpot } from "./net-label-clear-spot";
import { instanceParameterVisibilityEdits } from "../features/instance-display/instance-parameter-display";
import {
  dragNetLabelAttachmentAtPoint,
  netLabelPlacementTargetAtPoint,
} from "../features/wiring/route-interaction-geometry";
import { planPlacedCellPin } from "../features/component-insert/cell-pin-placement";
import {
  planVddRailEdits,
  railSupplyPinEdits,
} from "../features/component-insert/vdd-rail";
import {
  planInitialMosBulkDefault,
  planMosBulkDefaultUpdate,
} from "../features/component-insert/mos-bulk-defaults";
import {
  logicalNetChoiceForNet,
  logicalNetChoices,
} from "../features/logical-net-choices";
import { placedInstanceNetlist } from "../features/component-insert/placed-instance-netlist";

/** What the live editor knows beyond the Project. */
export interface BrowserAgentPlanningContext {
  /** The model a transistor placed now takes, as a GUI placement gets it. */
  processModelTarget?(
    project: CircuitProject,
    symbolId: string,
  ): string | undefined;
  /** The full target a short device name of the Process in hand stands for. */
  processTargetForShortName?(
    project: CircuitProject,
    symbolId: string,
    name: string,
  ): string | undefined;
  /**
   * The placement as one Project transaction with what the Process gives its
   * new parts (a BJT's reviewed subcircuit), as a GUI placement gets it.
   */
  processFill?(
    project: CircuitProject,
    documentId: string,
    edits: readonly SchematicEdit[],
  ): ProjectStructureEdit[] | undefined;
}

/** Check the committed geometry, not just the presence of move edits. */
function checkedJunctionTransform(
  document: SchematicDocument,
  resolver: SymbolResolver,
  plan: RoutingOperationPlan,
  junctionIds: readonly string[],
): readonly SchematicEdit[] {
  const gated = gateRoutingOperationPlan(document, plan, {
    symbolResolver: resolver,
  });
  if (!gated.ok) throw new Error(gated.message);
  for (const edit of plan.edits) {
    if (edit.kind !== "move_junction" || !junctionIds.includes(edit.junctionId))
      continue;
    const moved = gated.evaluated.finalDocument.junctions.find(
      (item) => item.id === edit.junctionId,
    );
    if (
      !moved ||
      moved.position.x !== edit.position.x ||
      moved.position.y !== edit.position.y
    )
      throw new Error(
        `Junction ${edit.junctionId} cannot retain the requested position after conductor normalization`,
      );
  }
  return gated.edits;
}

function projectStructureEditCount(
  edits: readonly ProjectStructureEdit[],
): number {
  return edits.reduce(
    (count, edit) =>
      count + 1 + (edit.kind === "transact_document" ? edit.edits.length : 0),
    0,
  );
}

type DeleteSelection = (AgentAuthoringCommand & {
  kind: "delete-selection";
})["selection"];

/** Selection fields in the order a fitting prefix takes them. */
const DELETE_SELECTION_CLASSES = [
  ["instanceIds", "Instances", "instance", "instances"],
  ["routeIds", "Routes", "route", "routes"],
  ["junctionIds", "Junctions", "junction", "junctions"],
  ["annotationIds", "Annotations", "annotation", "annotations"],
  ["draftingIds", "Drafting", "drafting object", "drafting objects"],
  ["noConnectIds", "NoConnects", "no-connect", "no-connects"],
] as const;

function assertDeleteSelectionFits(
  actionIndex: number,
  expandedEdits: number,
  maxTransactionEdits: number,
  selection: DeleteSelection,
  expansionOf: (selection: DeleteSelection) => number,
): void {
  if (
    !Number.isFinite(maxTransactionEdits) ||
    expandedEdits <= maxTransactionEdits
  )
    return;
  // A prefix of the selection, in class order, is a selection of its own.
  // Each probe plans exactly as the deletion would. The search keeps `low`
  // fitting and `high` not, so its answer fits even where a larger selection
  // happens to plan to fewer edits.
  const ordered = DELETE_SELECTION_CLASSES.flatMap(([field]) =>
    selection[field].map((id) => [field, id] as const),
  );
  const prefix = (count: number): DeleteSelection => {
    const part: DeleteSelection = {
      instanceIds: [],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
      noConnectIds: [],
    };
    for (const [field, id] of ordered.slice(0, count)) part[field].push(id);
    return part;
  };
  const fits = (count: number): boolean => {
    try {
      return expansionOf(prefix(count)) <= maxTransactionEdits;
    } catch {
      return false;
    }
  };
  let low = 0;
  let high = ordered.length;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle;
  }
  const fitting = prefix(low);
  const counts = Object.fromEntries(
    DELETE_SELECTION_CLASSES.flatMap(([field, name]) => [
      [`selected${name}`, selection[field].length],
      [`fitting${name}`, fitting[field].length],
    ]),
  );
  const fittingText = DELETE_SELECTION_CLASSES.flatMap(
    ([field, , one, many]) => {
      const count = fitting[field].length;
      if (count === 0) return [];
      const noun = count === 1 ? one : many;
      return [
        count === selection[field].length
          ? `all ${count} ${noun}`
          : `the first ${count} ${noun}`,
      ];
    },
  ).join(" and ");
  throw new AgentCommandPlanningError(
    actionIndex,
    `Delete selection expands to ${expandedEdits} edits, and one transaction takes at most ${maxTransactionEdits}. ` +
      (low === 0
        ? "Not even its first object fits alone; delete that object's wires first. "
        : `${fittingText[0]!.toUpperCase()}${fittingText.slice(1)} fit: delete them in one call, then refresh and delete what remains (deleting a part also deletes wires that only tapped it). `) +
      "Nothing was deleted.",
    {
      code: "LIMIT_EXCEEDED",
      parameters: { expandedEdits, maxTransactionEdits, ...counts },
    },
  );
}

/**
 * A label preset over the edit limit commits nothing and names the leading
 * parts that fit, each count found by planning those parts as the preset
 * would, so the Agent splits it without guessing. `low` always fits.
 */
function assertLabelPresetFits(
  document: SchematicDocument,
  ids: readonly string[],
  expandedEdits: number,
  maxTransactionEdits: number,
  expansionOf: (ids: readonly string[]) => number,
): void {
  if (expandedEdits <= maxTransactionEdits) return;
  let low = 0;
  let high = ids.length;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (expansionOf(ids.slice(0, middle)) <= maxTransactionEdits) low = middle;
    else high = middle;
  }
  const names = ids
    .slice(0, low)
    .map(
      (id) =>
        document.instances.find((item) => item.id === id)?.reference ?? id,
    );
  throw new AgentCommandPlanningError(
    0,
    `apply-label-preset expands to ${expandedEdits} edits, and one transaction takes at most ${maxTransactionEdits}. ` +
      (low === 0
        ? "Not even its first part fits alone. "
        : `The first ${low} of its ${ids.length} parts fit (${names.join(", ")}): apply it to them in one call and to the rest in another. `) +
      "Nothing was changed.",
    {
      code: "LIMIT_EXCEEDED",
      parameters: {
        expandedEdits,
        maxTransactionEdits,
        selectedParts: ids.length,
        fittingParts: low,
      },
    },
  );
}

/**
 * A part the Agent places is named as a GUI placement names it. A missing
 * Reference takes the next free one. One the netlist would refuse, with
 * another prefix or a name already in use, is rejected with a free name
 * instead of leaving the netlist blocked. `placed` holds the earlier parts
 * of the same batch.
 */
function namedPlacement(
  project: CircuitProject,
  document: SchematicDocument,
  placed: readonly Instance[],
  instance: Instance,
  actionIndex: number,
): Instance {
  const policy = referencePolicyForInstance(instance, project);
  if (policy.kind === "none") return instance;
  const cell = { ...document, instances: [...document.instances, ...placed] };
  const free = nextReference(createReferenceIndex(cell, project), policy)!;
  if (!instance.reference) return { ...instance, reference: free };
  const issue = referenceIssuesForInstance(
    createReferenceIndex(
      { ...cell, instances: [...cell.instances, instance] },
      project,
    ),
    instance.id,
  )[0];
  if (!issue) return instance;
  const parts =
    instance.netlist?.binding?.kind === "subcircuit"
      ? "Cell instances"
      : `${instance.symbolId} parts`;
  throw new AgentCommandPlanningError(
    actionIndex,
    issue.code === "DUPLICATE_REFERENCE"
      ? `${instance.reference} already names ${issue.otherInstanceId}; ${free} is free. Nothing was placed.`
      : `${parts} use the ${policy.prefix} prefix, so ${instance.reference} would block the netlist; ${free} is free, and set-display-alias draws it as ${instance.reference}. Nothing was placed.`,
  );
}

/** No second geometry/model/clipboard implementation: plan exactly as the GUI does. */
export function planBrowserAgentCommand(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  command: AgentAuthoringCommand,
  maxTransactionEdits = Number.POSITIVE_INFINITY,
  context: BrowserAgentPlanningContext = {},
  /**
   * A batch's command: a rail takes its IDs from the batch's own sequence
   * and its place in the batch, not from the draft the batch has advanced,
   * whose revision the next call's commit reaches (#1517).
   */
  batchItem?: { sequence: number; index: number },
): AgentCommandPlan {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Document not found");
  const sequence = document.revision + 1;
  switch (command.kind) {
    case "set-properties":
      return planSetProperties(project, document, resolver, command);
    case "set-text":
      return planSetText(document, command);
    case "add-text":
      return planAddText(command);
    case "arrange-instances": {
      for (const instanceId of command.instanceIds)
        if (!document.instances.some((item) => item.id === instanceId))
          throw new Error(`Instance not found: ${instanceId}`);
      if (new Set(command.instanceIds).size !== command.instanceIds.length)
        throw new Error("instances must be distinct");
      const edits: SchematicEdit[] = [
        {
          kind: "align_instances",
          instanceIds: [...command.instanceIds],
          axis: command.axis,
          ...(command.coordinate !== undefined
            ? { coordinate: command.coordinate }
            : {}),
        },
      ];
      // Lined up by coordinates, as a typed move is: its stretched wires are
      // drawn clear of what they would cross (#1344), and labels they newly
      // strike move clear (#1366).
      return {
        edits: withStruckLabelsArranged(document, resolver, [
          ...edits,
          ...planMoveRouteClearance(
            document,
            resolver,
            command.instanceIds,
            edits,
          ),
        ]),
      };
    }
    case "disconnect-pin": {
      const instance = document.instances.find(
        (item) => item.id === command.instanceId,
      );
      if (!instance)
        throw new Error(`Instance not found: ${command.instanceId}`);
      if (
        command.pinName === "P" &&
        document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(instance.id),
        )
      )
        throw new Error(
          "A formal Cell Pin's P pin cannot be disconnected; use remove-cell-terminal or delete-selection instead",
        );
      // The pin's own menu: Delete connection where wires end on it (a wire
      // cannot keep an end on a pin that left its Net), Disconnect endpoint
      // where none does.
      const endpoint = {
        kind: "terminal" as const,
        instanceId: instance.id,
        pinName: command.pinName,
      };
      const wires = document.routes.filter((route) =>
        [route.start, routeEnd(route)].some(
          (end) =>
            end.kind === "terminal" &&
            end.instanceId === instance.id &&
            end.pinName === command.pinName,
        ),
      );
      const gate = gateRoutingOperationPlan(
        document,
        createRoutingOperationPlan(document, {
          intent: "cut",
          edits: [
            ...wires.map((route): SchematicEdit => ({
              kind: "remove_route_geometry",
              routeId: route.id,
            })),
            { kind: "disconnect_endpoint", endpoint },
          ],
          diagnostics: [],
        }),
        { symbolResolver: resolver },
      );
      if (!gate.ok) throw new Error(gate.message);
      return { edits: [...gate.edits] };
    }
    case "move-junction": {
      const junction = document.junctions.find(
        (item) => item.id === command.junctionId,
      );
      if (!junction)
        throw new Error(`Junction not found: ${command.junctionId}`);
      const plan = planRoutingTransform(
        document,
        resolver,
        { instanceIds: [], routeIds: [], junctionIds: [junction.id] },
        {
          kind: "translate",
          delta: {
            x: command.position.x - junction.position.x,
            y: command.position.y - junction.position.y,
          },
        },
      );
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error) throw new Error(error.message);
      if (!plan.edits.length) return { edits: [] };
      return {
        edits: [
          ...checkedJunctionTransform(document, resolver, plan, [junction.id]),
        ],
      };
    }
    case "arrange-labels": {
      const { edits, leftInPlace } = arrangeInstanceLabelsReport(
        document,
        resolver,
        command.instanceIds,
        command,
      );
      return {
        edits,
        ...(leftInPlace.length
          ? { notes: [labelsLeftInPlaceNote(document, leftInPlace)] }
          : {}),
      };
    }
    case "apply-label-preset": {
      // The parts named, or every placed part of the Cell. Hiding and
      // arranging go as one transaction, so one undo takes back both.
      const ids = command.instanceIds
        ? [...new Set(command.instanceIds)]
        : document.instances.flatMap((item) =>
            item.placement ? [item.id] : [],
          );
      for (const id of ids)
        if (!document.instances.some((item) => item.id === id))
          throw new Error(`Instance not found: ${id}`);
      // textbook is the only preset.
      const plan = (parts: readonly string[]) =>
        textbookLabelEdits(document, resolver, parts);
      const edits = plan(ids);
      assertLabelPresetFits(
        document,
        ids,
        edits.length,
        maxTransactionEdits,
        (parts) => plan(parts).length,
      );
      return { edits };
    }
    case "route-net":
      return planRouteNet(document, resolver, command, maxTransactionEdits);
    case "delete-selection": {
      // GUI selections may contain stale IDs during gestures. An explicit
      // Agent selection is different: silently skipping one would report a
      // successful partial deletion. Validate here, not in the shared planner.
      const collections = {
        instanceIds: document.instances,
        routeIds: document.routes,
        junctionIds: document.junctions,
        annotationIds: document.annotations,
        draftingIds: document.drafting?.objects ?? [],
        noConnectIds: document.noConnects,
      };
      const kinds = new Map<string, string>();
      for (const [field, objects] of Object.entries(collections))
        for (const object of objects) kinds.set(object.id, field);
      for (const field of Object.keys(
        collections,
      ) as (keyof typeof collections)[])
        for (const id of command.selection[field] ?? []) {
          const actual = kinds.get(id);
          if (actual !== field)
            throw new Error(
              `selection.${field}: ${id} ${actual ? `belongs in ${actual}` : "does not exist"}; no objects were deleted`,
            );
        }
      const planDeletion = (
        selection: DeleteSelection,
      ): { size: number; plan: AgentCommandPlan } => {
        const selected = planCellSelectionDeletion(
          document,
          resolver,
          selection,
          sequence,
        );
        if (selected.terminalIds.length) {
          const structureEdits = planRemoveCellTerminals(
            project,
            documentId,
            selected.terminalIds,
            [...selected.routing.edits],
          );
          return {
            size: projectStructureEditCount(structureEdits),
            plan: { structureEdits },
          };
        }
        const gate = gateRoutingOperationPlan(document, selected.routing, {
          symbolResolver: resolver,
        });
        if (!gate.ok) throw new Error(gate.message);
        return { size: gate.edits.length, plan: { edits: [...gate.edits] } };
      };
      const planned = planDeletion(command.selection);
      assertDeleteSelectionFits(
        0,
        planned.size,
        maxTransactionEdits,
        command.selection,
        (selection) => planDeletion(selection).size,
      );
      return planned.plan;
    }
    case "set-port-direction": {
      if (command.target.kind === "terminal")
        return {
          structureEdits: planUpdateCellTerminalDirection(
            project,
            documentId,
            command.target.id,
            command.direction,
          ),
        };
      const target = command.target;
      const ports = projectCellInterface(document.netlist).ports.filter(
        (port) =>
          target.kind === "port"
            ? port.id === target.id
            : foldNetName(port.name) === foldNetName(target.name),
      );
      if (ports.length !== 1)
        throw new Error(
          `Expected one formal Port; matched ${ports.map((port) => port.id).join(", ") || "none"}`,
        );
      return {
        structureEdits: planUpdateCellPortDirection(
          project,
          documentId,
          ports[0]!.id,
          command.direction,
        ),
      };
    }
    case "set-vdd-mode":
      return {
        structureEdits: planSetVddConnectionMode(
          project,
          documentId,
          command.instanceId,
          command.mode,
        ),
      };
    case "set-mos-bulk-default": {
      // As the Cell settings in Properties set it: bodies that followed the
      // old default move to the new one, wired bodies stay (#1520).
      let netId: string | null = null;
      if (command.net !== null) {
        const requested = command.net;
        const matches = [
          ...resolveDocumentLogicalNets(document).byBaseNetId,
        ].filter(
          ([id, net]) =>
            id === requested ||
            net.id === requested ||
            foldNetName(net.name ?? "") === foldNetName(requested),
        );
        if (new Set(matches.map(([, net]) => net.id)).size > 1)
          throw new Error(
            `Several Nets are named ${requested}; give the Net ID instead`,
          );
        const choice = logicalNetChoiceForNet(
          logicalNetChoices(document),
          matches[0]?.[0],
        );
        if (!choice) throw new Error(`Net not found: ${requested}`);
        netId = choice.netId;
      }
      return {
        edits: [...planMosBulkDefaultUpdate(document, command.mos, netId)],
      };
    }
    case "add-power-rail": {
      if (
        (command.start.x === command.end.x) ===
        (command.start.y === command.end.y)
      )
        throw new Error(
          "A Power Rail must be one non-zero horizontal or vertical segment",
        );
      const logical = resolveDocumentLogicalNets(document);
      const named = [...logical.byBaseNetId.entries()].find(
        ([, net]) =>
          foldNetName(net.name ?? "") === foldNetName(command.name ?? "VDD"),
      );
      // A rail of the same supply on the same line, overlapping or touching
      // this one, grows to cover both instead of doubling up with a second
      // label.
      const supplyNetId = command.netId ?? named?.[0];
      const supply = supplyNetId
        ? logical.byBaseNetId.get(supplyNetId)
        : undefined;
      const along = (point: { x: number; y: number }) =>
        command.start.y === command.end.y ? point.x : point.y;
      const across = (point: { x: number; y: number }) =>
        command.start.y === command.end.y ? point.y : point.x;
      for (const route of document.routes) {
        if (
          route.presentation !== "power-rail" ||
          !supply?.baseNetIds.includes(route.netId)
        )
          continue;
        const component = derivePowerRailComponent(document, route.id);
        if (!component || component.endpointJunctionIds.length !== 2) continue;
        const ends = component.endpointJunctionIds.map((id) =>
          document.junctions.find((junction) => junction.id === id)!,
        );
        // Both ends on the new rail's line: the same axis and the same line.
        if (ends.some((end) => across(end.position) !== across(command.start)))
          continue;
        const span = [...ends.map((end) => along(end.position))].sort(
          (left, right) => left - right,
        );
        const asked = [along(command.start), along(command.end)].sort(
          (left, right) => left - right,
        );
        if (asked[1]! < span[0]! || asked[0]! > span[1]!) continue;
        const low = Math.min(span[0]!, asked[0]!);
        const high = Math.max(span[1]!, asked[1]!);
        const point = (value: number) =>
          command.start.y === command.end.y
            ? { x: value, y: command.start.y }
            : { x: command.start.x, y: value };
        return {
          edits: [
            ...proposePowerRailSpan(
              document,
              resolver,
              route.id,
              point(low),
              point(high),
            ).edits,
          ],
        };
      }
      // GUI contact capture is intentional for its gesture. Agent geometry alone
      // is not permission to join other pins: explicit wiring remains explicit.
      const plan = planVddRailEdits(document, {
        instanceId: batchItem
          ? deriveStableId(
              "agent-rail",
              `${documentId}:${batchItem.sequence}`,
              String(batchItem.index),
            )
          : deriveStableId("agent-rail", `${documentId}:${sequence}`),
        start: command.start,
        end: command.end,
        ...((command.netId ?? named?.[0])
          ? { netId: (command.netId ?? named?.[0])! }
          : {}),
        netName: command.name ?? "VDD",
        ...(command.scope ? { scope: command.scope } : {}),
      });
      if (!plan.ok) throw new Error(plan.message);
      return {
        edits: [...plan.edits, ...railSupplyPinEdits(project, document, plan)],
      };
    }
    case "extend-power-rail":
      return {
        edits: [
          ...proposePowerRailSpan(
            document,
            resolver,
            command.routeId,
            command.start,
            command.end,
          ).edits,
        ],
      };
    case "batch": {
      // Plan each command against the preceding private result. Only the final
      // ordinary Project transaction reaches the live controller/history.
      let draft = project;
      const edits: ProjectStructureEdit[] = [];
      let onlyDocument = true;
      const sourceActions: number[] = [];
      for (const [index, item] of command.commands.entries()) {
        try {
          const current = draft.documents.find((d) => d.id === documentId)!;
          const plan = planBrowserAgentCommand(
            draft,
            documentId,
            createProjectSymbolResolver(draft, builtInSymbols),
            item,
            maxTransactionEdits,
            context,
            { sequence, index },
          );
          onlyDocument &&= !("structureEdits" in plan);
          const next: ProjectStructureEdit[] =
            "structureEdits" in plan
              ? [...plan.structureEdits]
              : plan.edits.length
                ? [
                    {
                      kind: "transact_document",
                      documentId,
                      expectedRevision: current.revision,
                      edits: [...plan.edits],
                    },
                  ]
                : [];
          if (!next.length) continue;
          const result = executeProjectTransaction(draft, {
            transactionId: `agent-command-plan-${index}`,
            projectId: draft.id,
            expectedStructureRevision: draft.structureRevision,
            actor: { kind: "agent", id: "command-planner" },
            edits: next,
          });
          if (!result.ok)
            throw new Error(`Batch command ${index}: ${result.error.message}`);
          draft = result.project;
          edits.push(...next);
          sourceActions.push(...next.map(() => index));
        } catch (error) {
          throw new AgentCommandPlanningError(
            index,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return onlyDocument
        ? {
            edits: edits.flatMap((edit) =>
              edit.kind === "transact_document" ? edit.edits : [],
            ),
            sourceActions: edits.flatMap((edit, index) =>
              edit.kind === "transact_document"
                ? edit.edits.map(() => sourceActions[index]!)
                : [],
            ),
          }
        : { structureEdits: edits, sourceActions };
    }
    case "move-annotation": {
      const annotation = document.annotations.find(
        (a) => a.id === command.annotationId,
      );
      if (!annotation) throw new Error("Annotation not found");
      if (annotation.locked) throw new Error("Annotation is locked");
      const routeGeometryRecords = document.routes.flatMap((route) => {
        const geometry = resolveRouteGeometry(document, resolver, route);
        return geometry ? [{ route, geometry }] : [];
      });
      const moved = draggedAnnotationAtPosition(
        { document, resolver, routeGeometryRecords, annotationGrid: 1 },
        annotation,
        command.position,
      );
      return {
        edits: [
          {
            kind: "upsert_schematic_annotation",
            // A label moved to a part's other side reads from its other end.
            annotation: command.alignment
              ? { ...moved, alignment: command.alignment }
              : moved,
          },
        ],
      };
    }
    case "place-components": {
      const edits: SchematicEdit[] = [];
      let changesInterface = false;
      for (const id of Object.keys(command.pinAnchors ?? {})) {
        if (!command.instances.some((item) => item.id === id))
          throw new Error(`Pin anchor targets an unknown new Instance: ${id}`);
      }
      for (const id of Object.keys(command.terminalDirections ?? {})) {
        const index = command.instances.findIndex((item) => item.id === id);
        if (index < 0)
          throw new Error(
            `Terminal direction targets an unknown new Instance: ${id}`,
          );
        if (
          !["port", "port-filled", "vdd-port"].includes(
            command.instances[index]!.symbolId,
          )
        )
          throw new AgentCommandPlanningError(
            index,
            `Terminal direction requires a Cell interface marker: ${id}`,
          );
      }
      for (const id of Object.keys(command.displays ?? {})) {
        const index = command.instances.findIndex((item) => item.id === id);
        if (index < 0)
          throw new Error(`Display targets an unknown new Instance: ${id}`);
        if (
          ["port", "port-filled", "vdd-port", "ground"].includes(
            command.instances[index]!.symbolId,
          )
        )
          throw new AgentCommandPlanningError(
            index,
            `showReference and showValue are for devices; a Cell Pin or ground marker shows its Pin or Net name: ${id}`,
          );
      }
      // Where each placement's edits start, and which placements are Cell
      // Pins, which carry the interface into a Project transaction.
      const starts: number[] = [];
      const pins: boolean[] = [];
      const placed: Instance[] = [];
      for (const [index, source] of command.instances.entries()) {
        starts.push(edits.length);
        pins.push(
          ["port", "port-filled", "vdd-port"].includes(source.symbolId),
        );
        const pinAnchor = command.pinAnchors?.[source.id];
        let instance = source;
        if (pinAnchor) {
          try {
            instance = {
              ...source,
              placement: pinAnchoredPlacement(
                document,
                resolver,
                source,
                pinAnchor,
              ),
            };
          } catch (error) {
            throw new AgentCommandPlanningError(
              index,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        if (!instance.placement)
          throw new Error("New component requires placement");
        // A part lands with its name alone, as a GUI insert does, whatever
        // values the call gives: its value, a MOS's W/L or a resistance,
        // shows from the start only when asked, the given one or else the
        // catalog default (#1435). Nothing appears only to be hidden again.
        const display = command.displays?.[source.id];
        // The catalog defaults and the Process's model, exactly as a GUI
        // placement of the same part in this Project gets them; parameters
        // the Agent gives still win.
        const initialNetlist = placedInstanceNetlist(
          instance.symbolId,
          instance.netlist?.parameters ?? {},
          context.processModelTarget?.(project, instance.symbolId),
        );
        if (initialNetlist)
          instance = {
            ...instance,
            netlist: {
              ...initialNetlist,
              ...instance.netlist,
              parameters: {
                ...initialNetlist.parameters,
                ...instance.netlist?.parameters,
              },
            },
          };
        if (
          instance.symbolId === "port" ||
          instance.symbolId === "port-filled" ||
          instance.symbolId === "vdd-port"
        ) {
          // The compact action's reference names a Cell terminal, not a
          // device. Use the GUI's interface planner and bound name display.
          const { reference, netlist: _netlist, ...port } = instance;
          const terminalId = deriveStableId("terminal", instance.id);
          const netId = deriveStableId("net-cell-pin", instance.id);
          const endpoint = {
            kind: "terminal" as const,
            instanceId: instance.id,
            pinName: "P",
          };
          const plan = planPlacedCellPin(project, documentId, resolver, {
            instance: port,
            terminalId,
            name: reference,
            precedingEdits: edits,
            netId,
            direction:
              command.terminalDirections?.[instance.id] ??
              (instance.symbolId === "vdd-port" ? "inout" : "passive"),
            connectionEdits: [
              {
                kind: "connect_endpoints",
                from: endpoint,
                to: endpoint,
                newNetId: netId,
              },
            ],
          });
          for (const entry of plan) {
            if (
              entry.kind !== "transact_document" ||
              entry.documentId !== documentId
            )
              throw new Error(
                "Cell interface marker placement must target its owning Document",
              );
            edits.push(...entry.edits);
          }
          changesInterface = true;
          continue;
        }
        instance = namedPlacement(project, document, placed, instance, index);
        placed.push(instance);
        const power = proposedStandalonePowerConnection(document, instance);
        if (power.rejected) throw new Error(power.rejected);
        edits.push({ kind: "add_instance", instance }, ...power.edits);
        const supply = powerConnectionForSymbol(instance.symbolId);
        if (supply && power.powerNetId)
          edits.push(
            ...planInitialMosBulkDefault(
              document,
              supply.domain,
              power.powerNetId,
              edits,
            ),
          );
        edits.push(
          ...defaultInstanceDisplayAnnotations(
            document,
            instance,
            resolver,
            resolveDocumentStyleProfile(document.presentation),
            {
              ...(display?.showReference === undefined
                ? {}
                : { showDesignator: display.showReference }),
              showValue: display?.showValue === true,
              clearOfWiring: true,
            },
          ).map((annotation): SchematicEdit => ({
            kind: "upsert_schematic_annotation",
            annotation,
          })),
        );
      }
      // One transaction takes a bounded number of edits, and each placement
      // expands to several (the part, its labels, a Pin's terminal and Net).
      // A batch over the bound commits nothing; it says what it expanded to
      // and how many leading placements fit, so it splits without guessing:
      // an action list is split there by the service itself (#1516).
      const expanded = edits.length + (changesInterface ? 1 : 0);
      if (expanded > maxTransactionEdits) {
        let fitting = 0;
        while (
          fitting < command.instances.length &&
          (starts[fitting + 1] ?? edits.length) +
            (pins.slice(0, fitting + 1).some(Boolean) ? 1 : 0) <=
            maxTransactionEdits
        )
          fitting += 1;
        throw new AgentCommandPlanningError(
          fitting,
          `${command.instances.length} placements expand to ${expanded} edits, and one transaction takes at most ${maxTransactionEdits}. The first ${fitting} fit: place them in one call and the rest in another. Nothing was placed.`,
          {
            code: "LIMIT_EXCEEDED",
            parameters: {
              expandedEdits: expanded,
              maxTransactionEdits,
              fittingPlacements: fitting,
            },
          },
        );
      }
      // A BJT the Process maps to a reviewed subcircuit arrives bound to it,
      // with its definition, exactly as a GUI placement does.
      const filled = context.processFill?.(project, documentId, edits);
      if (filled) return { structureEdits: filled };
      // Keep mixed device/Port batches atomic, including the interface facts.
      return changesInterface
        ? {
            structureEdits: [
              {
                kind: "transact_document",
                documentId,
                expectedRevision: document.revision,
                edits,
              },
            ],
          }
        : { edits };
    }
    case "set-display-alias": {
      const plan = planDisplayAlias({
        document,
        instanceId: command.instanceId,
        alias: command.text,
        labelFor: instanceLabelAnnotationFor,
        newLabelFor: (current, instanceId) =>
          instanceDisplayEdits(current, resolver, [instanceId], {
            showReference: true,
          }).flatMap((edit) =>
            edit.kind === "upsert_schematic_annotation" &&
            edit.annotation.kind === "instance-label"
              ? [edit.annotation]
              : [],
          )[0],
      });
      if (!plan.ok) throw new Error(plan.message);
      return { edits: plan.edits };
    }
    case "set-instance-display": {
      const edits = instanceDisplayEdits(
        document,
        resolver,
        command.instanceIds,
        command,
      );
      if (command.showParameters) {
        const desired = Object.fromEntries(
          Object.entries(command.showParameters).filter(
            (entry): entry is [string, boolean] => entry[1] !== undefined,
          ),
        );
        for (const id of new Set(command.instanceIds)) {
          const instance = document.instances.find((item) => item.id === id);
          if (!instance) throw new Error(`Instance not found: ${id}`);
          const supported = instanceDisplayParameters(instance.symbolId);
          for (const parameter of Object.keys(desired)) {
            if (!supported.some((item) => item.name === parameter))
              throw new Error(
                `Parameter display ${parameter} is not supported by ${instance.symbolId}`,
              );
          }
          edits.push(
            ...instanceParameterVisibilityEdits(
              document,
              instance,
              resolver,
              desired,
            ),
          );
        }
      }
      return { edits };
    }
    case "place-cell": {
      const child = project.documents.find(
        (item) => item.id === command.childDocumentId,
      );
      if (!child?.netlist)
        throw new Error("Cell needs a formal interface before placement");
      // Named as the GUI names a Cell instance: X and the next free number,
      // never the Instance ID, which would block the netlist.
      const { reference: _id, ...unnamed } = createHierarchyInstance(
        command.instanceId,
        child,
        command.placement,
      );
      const instance = namedPlacement(
        project,
        document,
        [],
        command.reference
          ? { ...unnamed, reference: command.reference }
          : unnamed,
        0,
      );
      if (command.pinAnchor)
        instance.placement = pinAnchoredPlacement(
          document,
          resolver,
          instance,
          command.pinAnchor,
        );
      const annotations = defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        resolveDocumentStyleProfile(document.presentation),
        {
          showDesignator: false,
          masterName: child.netlist.name,
          clearOfWiring: true,
        },
      );
      return {
        structureEdits: planPlaceCellInstance(
          project,
          documentId,
          instance,
          annotations,
        ),
      };
    }
    case "place-existing": {
      const instance = document.instances.find(
        (item) => item.id === command.instanceId,
      );
      if (!instance || instance.placement)
        throw new Error("place-existing requires an unplaced Instance");
      // A pin anchor needs only the orientation (#1112).
      const placement = command.pinAnchor
        ? pinAnchoredPlacement(
            document,
            resolver,
            {
              ...instance,
              placement: command.placement ?? {
                position: { x: 0, y: 0 },
                rotation: 0,
                mirror: "none",
              },
            },
            command.pinAnchor,
          )
        : command.placement;
      if (!placement)
        throw new Error("place-existing needs a placement or a pinAnchor");
      const annotations = missingDefaultInstanceDisplayAnnotations(
        document,
        { ...instance, placement },
        resolver,
        resolveDocumentStyleProfile(document.presentation),
      );
      return {
        edits: [
          {
            kind: "place_instance",
            instanceId: instance.id,
            placement,
          },
          ...annotations.map((annotation): SchematicEdit => ({
            kind: "upsert_schematic_annotation",
            annotation,
          })),
        ],
      };
    }
    case "set-net-label": {
      // Plain text, a string or one text run, is a name: the label shows it
      // in its look rather than as bare text (#1521).
      const text: RichTextDocument =
        typeof command.text === "string"
          ? { runs: [{ kind: "text", value: command.text }] }
          : command.text;
      const plainText = text.runs.length === 1 && text.runs[0]?.kind === "text";
      const existing = document.annotations.find(
        (item) => item.id === command.annotationId,
      );
      if (
        existing &&
        existing.kind !== "net-label" &&
        existing.kind !== "power-label"
      )
        throw new Error("The annotation is not a Net Label");
      const logical = resolveDocumentLogicalNets(document);
      const net =
        logical.byId.get(command.netId) ??
        logical.byBaseNetId.get(command.netId);
      if (!net) throw new Error("Net not found");
      const netId = existing?.netId ?? net.baseNetIds[0]!;
      if (!net.baseNetIds.includes(netId))
        throw new Error("Label belongs to another Net");
      if (
        existing?.kind === "power-label" &&
        existing.anchor.kind === "object"
      ) {
        const rename = planElectricalMarkerRename(
          document,
          existing.anchor.objectId,
          flattenRichText(text),
        );
        if (rename.status === "rejected") throw new Error(rename.message);
        const edits = rename.status === "ready" ? [...rename.plan.edits] : [];
        const rebound = edits.find(
          (edit) =>
            edit.kind === "upsert_schematic_annotation" &&
            edit.annotation.id === existing.id,
        );
        return {
          edits: [
            ...edits,
            {
              kind: "upsert_schematic_annotation",
              annotation: {
                ...(rebound?.kind === "upsert_schematic_annotation"
                  ? rebound.annotation
                  : existing),
                // Plain text is a semantic rename. The shared marker planner
                // already preserves/customizes its look; only explicit RichText
                // replaces that format rather than erasing it with bare text.
                ...(plainText ? {} : { formatOverride: text }),
              },
            },
          ],
        };
      }
      const existingClaim = document.connectivityEvidence.find(
        (item) =>
          item.kind === "name-claim" &&
          item.owner.kind === "net-label" &&
          item.owner.annotationId === command.annotationId,
      );
      const name = flattenRichText(text).trim();
      // A relabeled look of its own follows the new name; a label without
      // one takes the role look a new label gets (#1521).
      const labelFormat = plainText
        ? existing?.formatOverride
          ? renamedLabelFormat(
              existing,
              resolveAnnotationName(document, existing),
              name,
              document.presentation,
            )
          : roleLabelFormat(
              net.powerDomain === "none" ? "voltage-node" : "supply",
              name,
            )
        : text;
      const plan = planEnsureNamedNet(document, {
        candidateNetId: netId,
        name,
        evidenceId:
          existingClaim?.id ??
          deriveStableId(
            "connectivity-evidence",
            document.id,
            "net-label",
            netId,
            command.annotationId,
          ),
        owner: { kind: "net-label", annotationId: command.annotationId },
        scope:
          existingClaim?.kind === "name-claim"
            ? existingClaim.scope
            : (net.scope ?? "local"),
        ...(net.powerDomain === "vdd" || net.powerDomain === "ground"
          ? { powerDomain: net.powerDomain }
          : {}),
      });
      if (!plan.ok) throw new Error(plan.message);
      if (!existing && !command.position)
        throw new Error("New Net Label requires position");
      const position =
        command.position ??
        (existing?.anchor.kind === "free"
          ? existing.anchor.position
          : undefined);
      const records = document.routes
        .filter((route) => net.baseNetIds.includes(route.netId))
        .flatMap((route) => {
          const geometry = resolveRouteGeometry(document, resolver, route);
          return geometry ? [{ route, geometry }] : [];
        });
      const attached = position
        ? records
            .flatMap((record) => {
              const attachment = dragNetLabelAttachmentAtPoint(
                [record],
                position,
                record.route.id,
              );
              return attachment
                ? [{ ...attachment, routeId: record.route.id }]
                : [];
            })
            .sort(
              (a, b) =>
                Math.hypot(
                  a.labelPosition.x - position.x,
                  a.labelPosition.y - position.y,
                ) -
                Math.hypot(
                  b.labelPosition.x - position.x,
                  b.labelPosition.y - position.y,
                ),
            )[0]
        : undefined;
      const createdPlacement =
        !existing && position
          ? netLabelPlacementTargetAtPoint(
              records,
              position,
              Number.POSITIVE_INFINITY,
            )
          : null;
      // A new label stands as close over its wire as its text allows, as
      // one placed with the Net Label tool does (#1300).
      const createdGeometry = createdPlacement
        ? records.find(({ route }) => route.id === createdPlacement.routeId)
            ?.geometry
        : undefined;
      const created =
        createdPlacement && createdGeometry
          ? netLabelAttachmentForText(
              createdPlacement.routeAttachment,
              createdPlacement.labelPosition,
              createdPlacement.rotation ?? 0,
              netLabelBaselineForName(name, labelFormat, document.presentation),
              createdGeometry,
            )
          : createdPlacement
            ? {
                attachment: createdPlacement.routeAttachment,
                position: createdPlacement.labelPosition,
              }
            : null;
      const anchor = created
        ? {
            kind: "route" as const,
            ...created.attachment,
            orientation: "horizontal" as const,
            fallbackPosition: created.position,
          }
        : attached
          ? {
              kind: "route" as const,
              routeId: attached.routeId,
              legId: attached.legId,
              t: attached.t,
              normalOffset: attached.normalOffset,
              direction: "forward" as const,
              orientation: "horizontal" as const,
              fallbackPosition: attached.labelPosition,
            }
          : position
            ? { kind: "free" as const, position }
            : existing!.anchor;
      const annotation = {
        ...(existing ?? {
          id: command.annotationId,
          kind:
            net.powerDomain === "none"
              ? ("net-label" as const)
              : ("power-label" as const),
          anchor: { kind: "free" as const, position: command.position! },
          alignment: createdPlacement?.alignment ?? ("middle" as const),
          rotation: 0 as const,
          locked: false,
        }),
        content: undefined,
        netId,
        binding: { kind: "net-name" as const, netId },
        formatOverride: labelFormat,
        anchor,
      };
      return {
        edits: [
          ...plan.edits,
          {
            kind: "upsert_schematic_annotation",
            annotation:
              created && createdGeometry
                ? netLabelAtClearSpot(
                    document,
                    resolver,
                    annotation,
                    labelFormat ??
                      labelTextDocument(name, document.presentation),
                    createdGeometry,
                  )
                : annotation,
          },
        ],
      };
    }
    case "set-model": {
      // The Netlist panel lists a Process's devices by their short names
      // (nfet_01v8 for SKY130's sky130_fd_pr__nfet_01v8); an Agent that
      // copies one means that device, not a new model of the same name.
      const symbolId = document.instances.find(
        (instance) => instance.id === command.instanceId,
      )?.symbolId;
      const model =
        (symbolId &&
          context.processTargetForShortName?.(
            project,
            symbolId,
            command.model,
          )) ||
        command.model;
      return {
        structureEdits: planSetDeviceModelTarget(
          project,
          documentId,
          command.instanceId,
          model,
        ),
      };
    }
    case "create-cell": {
      const child = createCellDocument(
        command.id,
        command.name,
        document.presentation,
      );
      return { structureEdits: planCreateCell(child) };
    }
    case "rename-cell":
      return {
        structureEdits: planRenameCell(project, command.id, command.name),
      };
    case "delete-cell":
      return { structureEdits: planDeleteCell(project, command.id) };
    case "bind-cell-parameter":
      return {
        structureEdits: planBindCellParameter(
          project,
          documentId,
          command.instanceId,
          command.field,
          command.name,
          command.defaultValue,
        ),
      };
    case "rename-cell-parameter":
      return {
        structureEdits: planRenameCellParameter(
          project,
          documentId,
          command.oldName,
          command.newName,
        ),
      };
    case "set-cell-parameter-default":
      return {
        structureEdits: planSetCellParameterDefault(
          project,
          documentId,
          command.name,
          command.defaultValue,
        ),
      };
    case "remove-cell-parameter":
      return {
        structureEdits: planRemoveCellParameter(
          project,
          documentId,
          command.name,
        ),
      };
    case "rename-cell-terminal":
      return {
        structureEdits: planRenameCellTerminal(
          project,
          documentId,
          command.terminalId,
          command.name,
          { mergeExistingPort: command.mergeExistingPort ?? false },
        ),
      };
    case "remove-cell-terminal":
      return {
        structureEdits: planRemoveCellTerminal(
          project,
          documentId,
          command.terminalId,
        ),
      };
    case "set-cell-symbol-pins":
      return {
        structureEdits: planSetCellSymbolPins(
          project,
          documentId,
          command.pins,
        ),
      };
    case "unplace":
      return {
        edits: planInstanceUnplacement(
          document,
          resolver,
          command.instanceIds,
          sequence,
        ),
      };
    case "reset-cell": {
      const plan = planCellReset(project, documentId, command.mode);
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error) throw new Error(error.message);
      return { edits: plan.edits };
    }
    case "copy": {
      const clipboard = captureProjectCopy(
        project,
        document,
        command.selection,
      );
      if (!clipboard) throw new Error("The copy selection is empty");
      const plan = planProjectCopyPlacement(
        project,
        document,
        clipboard,
        command.offset,
        sequence,
      );
      return { structureEdits: plan.edits };
    }
    case "detach-move": {
      const plan = planDetachedMove(
        document,
        resolver,
        new Set(command.instanceIds),
        sequence,
      );
      const moves: SchematicEdit[] = command.instanceIds.map((instanceId) => {
        const instance = document.instances.find(
          (item) => item.id === instanceId,
        );
        if (!instance?.placement)
          throw new Error("Move requires a placed instance");
        return {
          kind: "move_instance",
          instanceId,
          position: {
            x: instance.placement.position.x + command.delta.x,
            y: instance.placement.position.y + command.delta.y,
          },
        };
      });
      return { edits: [...plan.edits, ...moves] };
    }
    case "align":
    case "transform": {
      const styleProfile = resolveDocumentStyleProfile(document.presentation);
      const routeGeometryRecords = document.routes.flatMap((route) => {
        const geometry = resolveRouteGeometry(document, resolver, route);
        return geometry ? [{ route, geometry }] : [];
      });
      const context = {
        document,
        resolver,
        styleProfile,
        routeGeometryRecords,
        annotationGrid: document.presentation.grid,
        selection: command.selection,
      };
      if (command.kind === "align") {
        const modes = {
          "center-x": "h-center",
          "center-y": "v-center",
        } as const;
        const mode =
          command.mode in modes
            ? modes[command.mode as keyof typeof modes]
            : command.mode;
        const plan = planSelectionAlignment(context, mode as EdgeAlignmentMode);
        if (plan.blockingMessage) throw new Error(plan.blockingMessage);
        return { edits: plan.edits };
      }
      const input = command.transform;
      // A mirror about the selection's own axis carries labels and drawing
      // objects with the rest, exactly as the editor's Mirror command does.
      const selectionMirror = input.kind === "mirror" && !input.center;
      if (
        command.selection.annotationIds.length &&
        input.kind !== "translate" &&
        !selectionMirror
      ) {
        throw new Error(
          "Selected annotations support translation and mirroring about the selection here; use upsert_schematic_annotation for explicit rotation or anchor changes.",
        );
      }
      if (
        command.selection.draftingIds.length &&
        input.kind !== "translate" &&
        !(input.kind === "rotate" && !input.center) &&
        !selectionMirror
      ) {
        throw new Error(
          "Drafting objects support translation, in-place 45-degree rotation, and mirroring about the selection here. For other drafting transforms, submit upsert_drafting_object with the desired geometry.",
        );
      }
      const transform: TransformOperation =
        input.kind === "translate"
          ? input
          : input.kind === "rotate"
            ? {
                kind: input.kind,
                degrees: input.degrees,
                ...(input.center ? { center: input.center } : {}),
              }
            : {
                kind: input.kind,
                axis: input.axis,
                ...(input.center ? { center: input.center } : {}),
              };
      if (transform.kind !== "translate" && !transform.center) {
        let edits: SchematicEdit[] = [];
        let message = "";
        const controller = createSelectionTransformController({
          ...context,
          selectedInstanceIds: command.selection.instanceIds,
          transact: (next) => {
            edits.push(...next);
            return { ok: true };
          },
          setStatus: (next) => {
            message = next;
          },
        });
        if (transform.kind === "mirror")
          controller.mirror(
            transform.axis === "y" ? "left-right" : "top-bottom",
          );
        else
          controller.rotate(
            (transform.degrees > 180
              ? transform.degrees - 360
              : transform.degrees) as 45 | -45 | 90 | -90 | 135 | -135 | 180,
          );
        if (!edits.length && message) throw new Error(message);
        return { edits };
      }
      const plan = planRoutingTransform(
        document,
        resolver,
        command.selection,
        transform,
      );
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error) throw new Error(error.message);
      const annotationEdits: SchematicEdit[] = [];
      if (input.kind === "translate") {
        const moving = new Set([
          ...plan.affected.instances,
          ...plan.affected.internalJunctions,
          ...plan.affected.internalRoutes,
          ...command.selection.draftingIds,
        ]);
        for (const id of new Set(command.selection.draftingIds)) {
          const object = document.drafting?.objects.find(
            (item) => item.id === id,
          );
          if (!object) throw new Error(`Drafting object not found: ${id}`);
          if (object.locked)
            throw new Error(`Drafting object is locked: ${id}`);
          const anchors = [
            object.anchor,
            ...(object.kind === "arrow" ? [object.from, object.to] : []),
            ...(object.kind === "leader" || object.kind === "callout"
              ? [object.target]
              : []),
          ];
          for (const anchor of anchors) {
            if (anchor.kind === "free") continue;
            const owner =
              anchor.kind === "object" ? anchor.objectId : anchor.routeId;
            if (!moving.has(owner))
              throw new Error(
                `Drafting object ${id} is attached to ${owner}; move its owner or use upsert_drafting_object for an explicit anchor change`,
              );
          }
          annotationEdits.push({
            kind: "upsert_drafting_object",
            object: translateDraftingObject(
              object,
              input.delta,
              document.presentation.grid,
            ),
          });
        }
        for (const id of new Set(command.selection.annotationIds)) {
          const annotation = document.annotations.find((a) => a.id === id);
          if (!annotation) throw new Error(`Annotation not found: ${id}`);
          if (annotation.locked) throw new Error(`Annotation is locked: ${id}`);
          // Attached displays already follow their selected owner exactly once.
          if (
            annotation.anchor.kind === "object" &&
            (command.selection.instanceIds.includes(
              annotation.anchor.objectId,
            ) ||
              command.selection.junctionIds.includes(
                annotation.anchor.objectId,
              ))
          )
            continue;
          const geometryContext = {
            document,
            resolver,
            routeGeometryRecords,
            annotationGrid: 1,
          };
          const position = annotationDragPosition(geometryContext, annotation);
          annotationEdits.push({
            kind: "upsert_schematic_annotation",
            annotation: draggedAnnotationAtPosition(
              geometryContext,
              annotation,
              { x: position.x + input.delta.x, y: position.y + input.delta.y },
            ),
          });
        }
      }
      const edits = [...plan.edits, ...annotationEdits];
      return {
        edits:
          command.selection.junctionIds.length && edits.length
            ? [
                ...checkedJunctionTransform(
                  document,
                  resolver,
                  { ...plan, edits },
                  command.selection.junctionIds,
                ),
              ]
            : edits,
      };
    }
  }
}

/**
 * What arrange-labels left alone and why, so an arrangement that changed
 * nothing is not a mystery (#1414).
 */
function labelsLeftInPlaceNote(
  document: SchematicDocument,
  left: readonly LabelLeftInPlace[],
): AgentCommandPlanNote {
  const why = {
    locked: "locked",
    rotated: "turned",
    custom: "custom-styled",
    moved: "moved by hand",
  } as const;
  const listed = left.map((label) => {
    const part =
      document.instances.find((item) => item.id === label.instanceId)
        ?.reference ?? label.instanceId;
    return `${part}'s ${label.labelId} (${why[label.reason]})`;
  });
  const hint = left.some((label) => label.reason === "moved")
    ? "; includeManual:true re-places labels moved by hand"
    : "";
  return {
    code: "LABELS_LEFT_IN_PLACE",
    message: `arrange-labels left ${left.length} label${left.length === 1 ? "" : "s"} in place: ${listed.join(", ")}${hint}`,
    objectIds: left.map((label) => label.labelId),
  };
}
