// Calls to subcircuits: a hierarchy Cell, or an external subcircuit with the
// size and substrate checks of a reviewed PDK device.
import {
  circuitComponentTerminals,
  foldNetName,
  projectCellInterface,
  routeEndpoints,
} from "@icm/model";
import { drawnSupplyNet, namesNegativeSupply } from "@icm/derived";
import type {
  ComponentDefinition,
  ExternalSubcircuitDefinition,
  Instance,
  SchematicDocument,
} from "@icm/model";
import {
  projectLengthToSky130Micrometres,
  resolveReviewedExternalBinding,
  reviewedSize,
  reviewedSizeModelled,
  reviewedSizeOutOfRange,
  type ReviewedExternalDeviceBinding,
  type ReviewedSize,
  type ReviewedSizeOutOfRange,
} from "@icm/devices";
import type { DesignNetlistInstance, NetlistDiagnostic } from "./ir.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  isIdentifier,
  compareText,
  diagnostic,
} from "./extract-common.js";
import { type CellNetContext, terminalNetName } from "./extract-nets.js";
import {
  addsGroundPin,
  groundPinName,
  groundPortIndex,
} from "./extract-ground-pin.js";

export function extractHierarchyInstance(
  document: SchematicDocument,
  instance: Instance,
  documentsById: Map<string, SchematicDocument>,
  cellNameByDocumentId: ReadonlyMap<string, string>,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  const binding = netlist?.binding;
  if (!netlist || binding?.kind !== "subcircuit") return null;
  if (!isIdentifier(instance.reference!)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_INSTANCE_REFERENCE",
      `Instance reference is outside the portable identifier subset: ${instance.reference!}`,
      [instance.id],
    );
  }
  for (const parameter of Object.keys(netlist.parameters)) {
    if (!isIdentifier(parameter)) {
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_PARAMETER_NAME",
        `Parameter name is outside the portable identifier subset: ${parameter}`,
        [instance.id],
      );
    }
  }
  const child = documentsById.get(binding.childDocumentId);
  if (!child?.netlist) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_CHILD_INTERFACE",
      `Hierarchy instance ${instance.reference!} has no resolved child netlist interface`,
      [instance.id, binding.childDocumentId],
    );
    return null;
  }
  validateFormalParameterOverrides(
    document,
    instance,
    child.netlist.formalParameters,
    diagnostics,
  );
  // Callers and definitions share the authored interface, including its order.
  const childPorts = projectCellInterface(child.netlist).ports;
  const nodes = childPorts.map((port) => {
    const netName = terminalNetName(
      document,
      instance,
      port.name,
      context,
      diagnostics,
    );
    // Strict extraction rejects the accompanying error. Authoring keeps an
    // explicit non-executable slot rather than shifting positional arguments.
    return {
      pinName: port.name,
      netName: netName ?? `<unconnected:${port.name}>`,
    };
  });
  // The child's ground pin is not in its authored interface; both sides
  // derive it from the Documents, so the call carries this Cell's own ground
  // node at the position the child's definition puts it.
  if (options.groundPin === "pin" && addsGroundPin(child, documentsById)) {
    const callerGround = context.nameByAuthoredName.get(foldNetName("0"));
    if (callerGround) {
      nodes.splice(
        groundPortIndex(
          child,
          childPorts.map((port) => ({ id: port.netIds[0]!, name: port.name })),
        ),
        0,
        { pinName: groundPinName(child).name, netName: callerGround },
      );
    }
  }
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target: cellNameByDocumentId.get(child.id) ?? child.netlist.name,
    nodes,
    parameters: Object.entries(netlist.parameters)
      .sort(([a], [b]) => compareText(a, b))
      .map(([name, rawValue]) => ({ name, rawValue })),
  };
}

function validateFormalParameterOverrides(
  document: SchematicDocument,
  instance: Instance,
  formalParameters: readonly {
    name: string;
    defaultValue?: string | undefined;
  }[],
  diagnostics: NetlistDiagnostic[],
  options: { allowAdditional?: boolean } = {},
): void {
  const parameters = instance.netlist?.parameters ?? {};
  const formalByFoldedName = new Map(
    formalParameters.map((parameter) => [
      parameter.name.toLowerCase(),
      parameter,
    ]),
  );
  for (const name of Object.keys(parameters)) {
    if (options.allowAdditional || formalByFoldedName.has(name.toLowerCase()))
      continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNKNOWN_SUBCIRCUIT_PARAMETER",
      `Instance ${instance.reference ?? instance.id} sets unknown formal parameter ${name}`,
      [instance.id],
    );
  }
  for (const formal of formalParameters) {
    if (
      formal.defaultValue !== undefined ||
      Object.keys(parameters).some(
        (name) => name.toLowerCase() === formal.name.toLowerCase(),
      )
    ) {
      continue;
    }
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_REQUIRED_SUBCIRCUIT_PARAMETER",
      `Instance ${instance.reference ?? instance.id} must override formal parameter ${formal.name}`,
      [instance.id],
    );
  }
}

export function extractExternalSubcircuitInstance(
  document: SchematicDocument,
  instance: Instance,
  definition: ExternalSubcircuitDefinition | undefined,
  component: ComponentDefinition | undefined,
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  if (!netlist || netlist.binding?.kind !== "external-subcircuit") return null;
  if (!definition) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_EXTERNAL_SUBCIRCUIT_INTERFACE",
      `External subcircuit definition ${netlist.binding.definitionId} is unavailable`,
      [instance.id, netlist.binding.definitionId],
    );
    return null;
  }
  if (!isIdentifier(instance.reference!) || !isIdentifier(definition.name)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_SUBCIRCUIT_IDENTIFIER",
      `External subcircuit ${instance.reference!} or target ${definition.name} is outside the portable identifier subset`,
      [instance.id, definition.id],
    );
  }
  validateFormalParameterOverrides(
    document,
    instance,
    definition.formalParameters,
    diagnostics,
    { allowAdditional: true },
  );
  const reviewed = definition.implementation
    ? undefined
    : resolveReviewedExternalBinding(
        definition.name,
        definition.terminals.map((terminal) => terminal.name),
        instance.symbolId,
      );
  const terminalBindings = component?.circuitBinding
    ? circuitComponentTerminals(component, definition)
    : reviewed
      ? reviewed.terminals
      : definition.terminals.map((terminal) => ({
          targetName: terminal.name,
          pinName: terminal.name,
          interaction: "canvas" as const,
        }));
  const allowedPins = new Set(
    terminalBindings.map((terminal) => terminal.pinName.toLowerCase()),
  );
  const referencedPins = new Set<string>();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      if (terminal.instanceId === instance.id)
        referencedPins.add(terminal.pinName);
    }
  }
  for (const route of document.routes) {
    for (const endpoint of routeEndpoints(route)) {
      if (endpoint.kind === "terminal" && endpoint.instanceId === instance.id) {
        referencedPins.add(endpoint.pinName);
        const propertyTerminal = terminalBindings.find(
          (terminal) =>
            terminal.pinName === endpoint.pinName &&
            terminal.interaction === "property",
        );
        if (propertyTerminal) {
          diagnostic(
            diagnostics,
            document.id,
            "PROPERTY_TERMINAL_ON_CANVAS",
            `Property-only terminal ${instance.reference!}.${endpoint.pinName} cannot be a Route endpoint`,
            [instance.id, route.id],
          );
        }
      }
    }
  }
  for (const pinName of referencedPins) {
    if (allowedPins.has(pinName.toLowerCase())) continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNKNOWN_EXTERNAL_SUBCIRCUIT_PIN",
      `External subcircuit ${instance.reference!} references unknown formal terminal ${pinName}`,
      [instance.id, definition.id],
    );
  }
  for (const noConnect of document.noConnects) {
    if (noConnect.endpoint.instanceId !== instance.id) continue;
    const propertyTerminal = terminalBindings.find(
      (terminal) =>
        terminal.pinName === noConnect.endpoint.pinName &&
        terminal.interaction === "property",
    );
    if (propertyTerminal) {
      diagnostic(
        diagnostics,
        document.id,
        "PROPERTY_TERMINAL_NO_CONNECT",
        `Property-only terminal ${instance.reference!}.${noConnect.endpoint.pinName} requires an existing Net selection`,
        [instance.id, noConnect.id],
      );
    }
  }
  // A standard cell's rail with no Net chosen reads the Cell's one drawn
  // supply of its domain, as an unbound gate does; a Cell that drew none took
  // the conventional supply before extraction (#1450).
  const railsAsked = new Set<string>();
  const railNetName = (rail: "VDD" | "VSS") => {
    const drawn = drawnSupplyNet(
      document,
      rail === "VDD" ? "vdd" : "ground",
      context.logicalNets,
    );
    const drawnName = drawn ? context.nameByNetId.get(drawn.id) : undefined;
    if (!drawnName && !railsAsked.has(rail)) {
      railsAsked.add(rail);
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_BLOCK_SUPPLY",
        `Analog Block ${instance.reference!} has no unambiguous ${rail} Net; select one in Properties or draw a unique ${rail === "VDD" ? "positive supply" : "ground"}`,
        [instance.id],
      );
    }
    return drawnName ?? null;
  };
  const nodes = terminalBindings.map((terminal) => {
    const rail = "supply" in terminal ? terminal.supply : undefined;
    const netName =
      rail &&
      !context.netByTerminal.has(`${instance.id}\u0000${terminal.pinName}`)
        ? railNetName(rail)
        : terminalNetName(
            document,
            instance,
            terminal.pinName,
            context,
            diagnostics,
          );
    return {
      pinName: terminal.targetName,
      ...(terminal.targetName !== terminal.pinName
        ? { canvasPinName: terminal.pinName }
        : {}),
      netName: netName ?? `<unconnected:${terminal.targetName}>`,
    };
  });
  if (reviewed)
    reportSubstrateTerminals(
      document,
      instance,
      reviewed,
      nodes,
      context,
      diagnostics,
    );
  const parameters = Object.entries(netlist.parameters);
  const projectedParameters = reviewed
    ? [
        ...(reviewed.fixedParameters ?? []).map(({ name, value }) => ({
          name,
          rawValue: value,
        })),
        ...reviewed.parameters
          .toSorted((left, right) => left.spiceOrder - right.spiceOrder)
          .flatMap((parameter) => {
            const entry = parameters.find(
              ([name]) => name.toLowerCase() === parameter.name.toLowerCase(),
            );
            if (!entry) return [];
            let rawValue = entry[1];
            if (parameter.targetUnit === "micrometre") {
              try {
                rawValue = projectLengthToSky130Micrometres(rawValue);
              } catch (error) {
                diagnostic(
                  diagnostics,
                  document.id,
                  "INVALID_REVIEWED_GEOMETRY",
                  error instanceof Error ? error.message : String(error),
                  [instance.id],
                );
                return [];
              }
            }
            return [{ name: parameter.name, rawValue }];
          }),
        ...parameters
          .filter(
            ([name]) =>
              ![
                ...reviewed.parameters,
                ...(reviewed.fixedParameters ?? []),
              ].some(
                (parameter) =>
                  parameter.name.toLowerCase() === name.toLowerCase(),
              ),
          )
          .sort(([a], [b]) => compareText(a, b))
          .map(([name, rawValue]) => ({ name, rawValue })),
      ]
    : parameters
        .sort(([a], [b]) => compareText(a, b))
        .map(([name, rawValue]) => ({ name, rawValue }));
  // A device its library models only at a few sizes runs at no other (#1483).
  if (
    reviewed?.modelledSizes &&
    reviewedSizeModelled(reviewed, netlist.parameters) === false
  ) {
    const size = reviewedSize(reviewed, netlist.parameters);
    const shown = (value: ReviewedSize | undefined) =>
      value?.metres === undefined
        ? (value?.text ?? "its default")
        : micrometres(value.metres);
    diagnostic(
      diagnostics,
      document.id,
      "REVIEWED_SIZE_UNMODELLED",
      `${instance.reference!} is W ${shown(size.width)}, L ${shown(size.length)}, a size ${definition.name} has no model for: its library models it only at ${reviewed.modelledSizes.description}, so the simulation stops at this line. Give it one of those sizes.`,
      [instance.id],
      "warning",
    );
  }
  // A size the PDK does not make, or one a unit slip left in metres (#1474).
  // The part exports as drawn: which size was meant is the author's to say.
  for (const found of reviewed
    ? reviewedSizeOutOfRange(reviewed, netlist.parameters)
    : [])
    diagnostic(
      diagnostics,
      document.id,
      "REVIEWED_SIZE_OUT_OF_RANGE",
      sizeOutOfRangeMessage(instance.reference!, definition.name, found),
      [instance.id],
      "warning",
      found.parameter,
    );
  return {
    id: instance.id,
    reference: instance.reference!,
    invocationKind: "subcircuit",
    ...(reviewed ? { reviewedExternalBindingId: reviewed.id } : {}),
    deviceClass: "hierarchical",
    target: definition.name,
    nodes,
    parameters: projectedParameters,
  };
}

const micrometres = (metres: number) =>
  `${Number((metres / 1e-6).toPrecision(6))} µm`;

/** What REVIEWED_SIZE_OUT_OF_RANGE says of one size (#1474). */
function sizeOutOfRangeMessage(
  reference: string,
  master: string,
  found: ReviewedSizeOutOfRange,
): string {
  const label = found.role === "width" ? "W" : "L";
  if (found.bound === "slip") {
    const text = found.text.trim();
    const bare = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(text);
    return `${reference} has ${label} ${text}, which is ${found.fingers > 1 ? `${micrometres(found.metres / found.fingers)} per finger` : micrometres(found.metres)}: over ${found.limit / 1e-3} mm, larger than ${master} is made, so its unit is likely missing or wrong.${bare ? ` A size without a unit is in metres; write ${text}u if you mean ${text} µm.` : ""}`;
  }
  const size =
    found.fingers === 1
      ? micrometres(found.metres)
      : `${micrometres(found.metres)} over ${found.fingers} fingers, ${micrometres(found.metres / found.fingers)} each`;
  if (found.bound === "maximum")
    return `${reference} has ${label} ${size}, above the ${micrometres(found.limit)} longest length ${master} runs at on Production's simulator, so a simulation stops at this line.`;
  return `${reference} has ${label} ${size}, below the ${micrometres(found.limit)} minimum ${found.role === "width" ? "width per finger" : "length"} of ${master}. Its PDK has no model that ${found.role === "width" ? "narrow" : "short"}, so a simulation stops at this line.`;
}

/** A Net named as a Cell's ground or substrate: GND, AGND, SUB, VSUB. */
const GROUND_OR_SUBSTRATE_NAME = /^[ad]?(?:gnd|v?sub)[a-z0-9_]*$/iu;

/**
 * A Net named as a Cell's lowest supply: ground or substrate by name, or a
 * negative rail by the same rule the Process reads (VSS, AVSS, VEE, VNEG), so
 * a substrate bound to the Cell's negative supply is never reported here.
 */
const namesLowestSupply = (name: string) =>
  GROUND_OR_SUBSTRATE_NAME.test(name) || namesNegativeSupply(name);

/**
 * A terminal the PDK ties to the p-substrate belongs on ground or the lowest
 * supply (#1314). A SKY130 vertical PNP's collector is the substrate: drawn
 * as a current-mirror load, it exported ready, verified clean, and a run put
 * the mirror's output at 0.93 V where the textbook mirror sits near
 * VDD - V_EB. The same holds for a substrate property terminal bound to a
 * signal Net.
 */
function reportSubstrateTerminals(
  document: SchematicDocument,
  instance: Instance,
  reviewed: ReviewedExternalDeviceBinding,
  nodes: readonly { pinName: string; netName: string }[],
  context: CellNetContext,
  diagnostics: NetlistDiagnostic[],
): void {
  const ground = context.nameByAuthoredName.get(foldNetName("0")) ?? "0";
  for (const terminal of reviewed.terminals) {
    if (terminal.role !== "substrate") continue;
    const node = nodes.find((item) => item.pinName === terminal.targetName);
    if (
      !node ||
      node.netName.startsWith("<unconnected:") ||
      node.netName === ground ||
      node.netName === "0" ||
      namesLowestSupply(node.netName)
    )
      continue;
    const reference = instance.reference ?? instance.id;
    diagnostic(
      diagnostics,
      document.id,
      "PDK_SUBSTRATE_TERMINAL",
      reviewed.symbolId === "pnp" && terminal.pinName === "C"
        ? `${reference}'s collector is the p-substrate of ${reviewed.masterName} and belongs on ground or the lowest supply; it is on ${node.netName}. Use it as a diode, or with its collector grounded`
        : `${reference}.${terminal.pinName} is the p-substrate of ${reviewed.masterName} and belongs on ground or the lowest supply; it is on ${node.netName}`,
      [instance.id],
      "warning",
    );
  }
}
