import {
  findRedundantNetLabelsForPort,
  freePowerRailLabel,
  inheritedPortFormatOverride,
  planCreateCellPin,
  proposePlacementContact,
  removableLabelJunctionIds,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  isSupplyPortSymbol,
  type Annotation,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentStyleProfile,
  resolveEndpointConnection,
  supplyMarkerForSymbol,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { defaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";
import {
  planInitialMosBulkDefault,
  supplyMarkerBodyDomain,
} from "./mos-bulk-defaults";
import { createInsertedInstanceConnectionContext } from "./placement-connectivity";
import { vddPowerLabelAnnotation } from "./vdd-power-label";

/** Shared electrical/display proposal; callers retain their own contact policy. */
export function planPlacedCellPin(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  input: {
    instance: Instance;
    terminalId: string;
    name?: string | undefined;
    netId: string;
    direction: "input" | "output" | "inout" | "passive";
    connectionEdits: readonly SchematicEdit[];
    precedingEdits?: readonly SchematicEdit[];
    styleProfile?: SchematicStyleProfile;
  },
) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Cell not found");
  const supply = isSupplyPortSymbol(input.instance.symbolId);
  const name =
    input.name?.trim() ??
    (supply ? supplyMarkerForSymbol(input.instance.symbolId)?.name : undefined);
  if (!name) throw new Error("A Cell interface marker requires a name");
  const resolved = supply
    ? resolver.resolve(input.instance.symbolId)
    : undefined;
  const retiredLabels = !supply
    ? retiringNetLabels(document, resolver, input, name)
    : undefined;
  const hiddenLabelIds = retiredLabels?.length
    ? new Set(retiredLabels.map((label) => label.id))
    : undefined;
  const inheritedFormat = retiredLabels
    ? inheritedPortFormatOverride(retiredLabels, name)
    : undefined;
  const defaultPortAnnotation = !supply
    ? defaultInstanceDisplayAnnotations(
        withPrecedingDisplay(document, input.precedingEdits, hiddenLabelIds),
        input.instance,
        resolver,
        input.styleProfile ??
          resolveDocumentStyleProfile(document.presentation),
        { formalTerminalId: input.terminalId, formalName: name },
      )[0]
    : undefined;
  const annotation =
    supply && resolved
      ? {
          ...vddPowerLabelAnnotation({
            instance: input.instance,
            resolved,
            netId: input.netId,
            grid: document.presentation.grid,
            name,
          }),
          binding: {
            kind: "cell-terminal-name" as const,
            terminalId: input.terminalId,
          },
        }
      : defaultPortAnnotation &&
          inheritedFormat &&
          defaultPortAnnotation.content === undefined
        ? { ...defaultPortAnnotation, formatOverride: inheritedFormat }
        : defaultPortAnnotation;
  const plan = planCreateCellPin(project, documentId, {
    instance: input.instance,
    ...(!supply ? { signalExpression: name } : {}),
    connectionEdits: [
      ...input.connectionEdits,
      ...(supply
        ? planInitialMosBulkDefault(
            document,
            supplyMarkerBodyDomain(input.instance.symbolId, name) ?? "vdd",
            input.netId,
            input.precedingEdits,
          )
        : []),
    ],
    terminal: {
      id: input.terminalId,
      name,
      netId: input.netId,
      direction: input.direction,
      interfaceInstanceIds: [input.instance.id],
    },
    ...(annotation ? { annotation } : {}),
  });
  const kept = supply ? keptSupplyPin(document, name) : undefined;
  if (!kept) return plan;
  // An earlier marker of the same call took the kept Pin over already; this
  // one joins it by name.
  const taken = input.precedingEdits?.some(
    (edit) =>
      edit.kind === "remove_cell_terminal" && edit.terminalId === kept.pin.id,
  );
  return plan.map((entry) =>
    entry.kind === "transact_document" && entry.documentId === documentId
      ? {
          ...entry,
          edits: [
            ...entry.edits.flatMap((edit): SchematicEdit[] => {
              // The supply keeps the kept Pin's place on the Cell's symbol:
              // a new edge slot would move it, or name the Pin it retires.
              if (edit.kind === "set_cell_symbol_presentation") return [];
              // The marker's Pin stands where the kept one stood among the
              // Cell's Pins, so a netlist's port order stays.
              return !taken &&
                edit.kind === "add_cell_terminal" &&
                edit.terminal.id === input.terminalId
                ? [{ ...edit, index: kept.index }]
                : [edit];
            }),
            ...(taken ? [] : retireKeptSupplyPin(document, kept, input.netId)),
          ],
        }
      : entry,
  );
}

interface KeptSupplyPin {
  label: Annotation;
  pin: NonNullable<SchematicDocument["netlist"]>["terminals"][number];
  index: number;
}

/** The supply's rail label and Pin a body reset or clear-drawing kept. */
function keptSupplyPin(
  document: SchematicDocument,
  name: string,
): KeptSupplyPin | undefined {
  const label = freePowerRailLabel(document, { netName: name, scope: "local" });
  const terminals = document.netlist?.terminals ?? [];
  const index = terminals.findIndex(
    (terminal) => terminal.interfaceAnnotationId === label?.id,
  );
  return label && index >= 0
    ? { label, pin: terminals[index]!, index }
    : undefined;
}

/**
 * A body reset or clear-drawing keeps a rail's VDD label and its Pin for the
 * Cell's callers. A VDD marker placed for that supply takes their place, as a
 * redrawn rail takes the label over (#1410): the supply's Net becomes the
 * marker's, keeping whatever stands on it, and the kept label, its Pin and
 * the Junction it stood on go. The Pin's name stays, so the Cell's symbol and
 * its callers keep the Pin they know.
 */
function retireKeptSupplyPin(
  document: SchematicDocument,
  { label, pin }: KeptSupplyPin,
  markerNetId: string,
): SchematicEdit[] {
  return [
    // A marker dropped on the supply's own Net is on it already.
    ...(pin.netId === markerNetId
      ? []
      : [
          {
            kind: "merge_nets" as const,
            targetNetId: pin.netId,
            sourceNetId: markerNetId,
          },
        ]),
    { kind: "remove_schematic_annotation", annotationId: label.id },
    { kind: "remove_cell_terminal", terminalId: pin.id },
    ...removableLabelJunctionIds(document, [label]).map(
      (junctionId): SchematicEdit => ({
        kind: "remove_junction",
        junctionId,
      }),
    ),
  ];
}

/**
 * Net Labels that committing this scalar Port will retire on its target or
 * physically contacted Base Net, hidden from default display placement so the
 * Port's own formal label does not dodge a label that is about to disappear.
 */
function retiringNetLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input: {
    instance: Instance;
    netId: string;
    precedingEdits?: readonly SchematicEdit[];
  },
  name: string,
): Annotation[] | undefined {
  let targetNetId: string | undefined;
  if (document.nets.some((net) => net.id === input.netId)) {
    targetNetId = input.netId;
  } else if (input.instance.placement) {
    const context = createInsertedInstanceConnectionContext(document, resolver);
    const contact = proposePlacementContact(
      document,
      resolver,
      input.instance,
      context.endpoints,
      { context: context.contactContext, powerMarker: false },
    );
    if (contact.matched && !contact.ambiguous && !contact.rejected) {
      targetNetId = contact.netId;
    } else if (!contact.ambiguous && !contact.rejected) {
      const pinLanding = resolveEndpointConnection(
        { ...document, instances: [...document.instances, input.instance] },
        resolver,
        { kind: "terminal", instanceId: input.instance.id, pinName: "P" },
      )?.gridLanding;
      if (pinLanding) {
        targetNetId = document.junctions.find(
          (junction) =>
            !junction.members &&
            junction.position.x === pinLanding.x &&
            junction.position.y === pinLanding.y,
        )?.netId;
      }
    }
  }
  if (!targetNetId) return undefined;
  const upsertedIds = new Set(
    (input.precedingEdits ?? []).flatMap((edit) =>
      edit.kind === "upsert_schematic_annotation" ? [edit.annotation.id] : [],
    ),
  );
  const retired = findRedundantNetLabelsForPort(
    document,
    targetNetId,
    name,
    upsertedIds,
  );
  return retired.length ? retired : undefined;
}

/**
 * The Cell with the parts and labels earlier edits of the same batch add, so
 * a Pin placed beside another in one call sees that Pin's name and keeps its
 * own clear of it (#1105).
 */
function withPrecedingDisplay(
  document: SchematicDocument,
  edits: readonly SchematicEdit[] | undefined,
  hiddenAnnotationIds?: ReadonlySet<string>,
): SchematicDocument {
  if (!edits?.length && !hiddenAnnotationIds?.size) return document;
  const instances = [...document.instances];
  let annotations = hiddenAnnotationIds?.size
    ? document.annotations.filter(
        (annotation) => !hiddenAnnotationIds.has(annotation.id),
      )
    : [...document.annotations];
  for (const edit of edits ?? [])
    if (edit.kind === "add_instance") instances.push(edit.instance);
    else if (edit.kind === "upsert_schematic_annotation") {
      const index = annotations.findIndex(
        (annotation) => annotation.id === edit.annotation.id,
      );
      if (index >= 0) annotations[index] = edit.annotation;
      else annotations.push(edit.annotation);
    }
  return { ...document, instances, annotations };
}
