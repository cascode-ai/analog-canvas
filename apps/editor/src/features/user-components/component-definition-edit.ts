import type { CircuitProject, ComponentDefinition, Instance } from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";
import {
  parseSharedDefinition,
  type SharedComponent,
} from "./component-library-contract";
import { planProjectCodeCommit } from "../project-code/project-code";
import type { SymbolInsertRequest } from "../component-insert/component-insert-request";

export function newComponentDefinition(): ComponentDefinition {
  return {
    symbol: {
      schemaVersion: 1,
      id: "custom-component",
      name: "New component",
      viewBox: { x: -40, y: -30, width: 80, height: 60 },
      pins: [
        {
          name: "IN",
          role: "input",
          at: { x: -40, y: 0 },
          direction: "west",
          presentation: {
            visibility: "visible",
            showName: true,
            textSizeScale: 0.5,
          },
        },
        {
          name: "OUT",
          role: "output",
          at: { x: 40, y: 0 },
          direction: "east",
          presentation: {
            visibility: "visible",
            showName: true,
            textSizeScale: 0.5,
          },
        },
      ],
      primitives: [
        {
          kind: "polyline",
          points: [
            { x: -20, y: -20 },
            { x: 20, y: -20 },
            { x: 20, y: 20 },
            { x: -20, y: 20 },
            { x: -20, y: -20 },
          ],
        },
        { kind: "line", from: { x: -40, y: 0 }, to: { x: -20, y: 0 } },
        { kind: "line", from: { x: 20, y: 0 }, to: { x: 40, y: 0 } },
      ],
      variants: [],
    },
    subcircuit: {
      id: "custom-component",
      symbolId: "custom-component",
      target: "custom_block",
      ports: [
        { name: "VDD", supply: "VDD", direction: "inout" },
        { name: "VSS", supply: "VSS", direction: "inout" },
        { name: "IN", pinName: "IN", direction: "input" },
        { name: "OUT", pinName: "OUT", direction: "output" },
      ],
    },
  };
}

export function sharedComponentNetlist(
  definition: ComponentDefinition,
): Instance["netlist"] {
  const electrical = definition.electrical;
  if (!electrical && !definition.subcircuit) return undefined;
  return {
    ...(definition.subcircuit
      ? {
          binding: {
            kind: "unresolved-subcircuit" as const,
            name: definition.subcircuit.target,
          },
        }
      : electrical?.targetPolicy === "builtin"
        ? {
            binding: {
              kind: "primitive" as const,
              deviceClass: electrical.deviceClass,
            },
          }
        : {}),
    parameters: Object.fromEntries(
      (electrical?.parameters ?? []).flatMap((parameter) =>
        parameter.defaultValue === undefined
          ? []
          : [[parameter.name, parameter.defaultValue]],
      ),
    ),
  };
}

export function sharedComponentInsertRequest(
  entry: SharedComponent,
): SymbolInsertRequest {
  return {
    kind: "symbol",
    symbolId: entry.definition.symbol.id,
    symbolName: entry.definition.symbol.name,
    componentDefinition: entry.definition,
    parameters: sharedComponentNetlist(entry.definition)?.parameters ?? {},
    initialRotation: 0,
    showReference: true,
    referenceText: null,
    showValue: false,
  };
}

/** Change one class reference, preserving placement, electrical identity and all peers. */
export function planComponentDefinitionEdit(
  current: CircuitProject,
  documentId: string,
  instanceId: string,
  expectedInstance: Instance,
  definition: ComponentDefinition,
) {
  try {
    const parsed = parseSharedDefinition(definition);
    const candidate = structuredClone(withProjectComponentDefinitions(current));
    const document = candidate.documents.find((item) => item.id === documentId);
    const instance = document?.instances.find((item) => item.id === instanceId);
    if (
      !document ||
      !instance ||
      JSON.stringify(instance) !== JSON.stringify(expectedInstance)
    )
      return {
        ok: false as const,
        message:
          "This instance changed while its definition was being edited. Reopen it before applying.",
      };
    if (
      instance.netlist?.binding?.kind === "subcircuit" ||
      instance.netlist?.binding?.kind === "external-subcircuit"
    )
      return {
        ok: false as const,
        message: "Use Enter Cell to edit a hierarchical circuit",
      };
    const pins = new Set(parsed.symbol.pins.map((pin) => pin.name));
    const connectedPins = document.nets
      .flatMap((net) => net.terminals)
      .filter((terminal) => terminal.instanceId === instanceId);
    if (connectedPins.some((terminal) => !pins.has(terminal.pinName)))
      return {
        ok: false as const,
        message:
          "Disconnect removed pins before changing this component's interface",
      };
    const oldDefinition = candidate.componentDefinitions?.find(
      (item) => item.symbol.id === instance.symbolId,
    );
    const existing = candidate.componentDefinitions?.find(
      (item) => item.symbol.id === parsed.symbol.id,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed))
      return {
        ok: false as const,
        message: "Use a new definition ID to preserve existing instances",
      };
    const compatible =
      oldDefinition?.electrical?.deviceClass ===
        parsed.electrical?.deviceClass &&
      oldDefinition?.subcircuit?.target === parsed.subcircuit?.target;
    if (!compatible) instance.netlist = sharedComponentNetlist(parsed);
    instance.symbolId = parsed.symbol.id;
    if (
      !parsed.symbol.variants.some(
        (variant) => variant.id === instance.symbolVariantId,
      )
    )
      delete instance.symbolVariantId;
    candidate.componentDefinitions = [
      ...(candidate.componentDefinitions ?? []).filter(
        (item) => item.symbol.id !== parsed.symbol.id,
      ),
      parsed,
    ];
    return planProjectCodeCommit(
      current,
      JSON.stringify(candidate),
      documentId,
    );
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
