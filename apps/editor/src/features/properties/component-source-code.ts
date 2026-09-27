import {
  drawnMagneticNetwork,
  drawnMagneticParameters,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import {
  spellGreekLetters,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  analyzeDesignNetlist,
  printSpiceCellInstances,
  type DesignNetlistInstance,
} from "@icm/netlist";
import type { SymbolResolver } from "@icm/symbols";

type Instance = SchematicDocument["instances"][number];

export interface ComponentSourceCode {
  code: string;
  exact: boolean;
  note: string | null;
}

function exactSpiceCard(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
): string | null {
  const analysis = analyzeDesignNetlist(project, {
    format: "spice",
    rootDocumentId: documentId,
  });
  const cell = analysis.ir?.cells.find(
    (candidate) => candidate.id === documentId,
  );
  const instance = cell?.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!cell || !instance) return null;
  const probe = cell.instances.find(
    (item) =>
      item.id === instance.controlSourceInstanceId && item.terminalCurrentSense,
  );
  const lines = printSpiceCellInstances({
    ...cell,
    instances: probe ? [probe, instance] : [instance],
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function targetFor(project: CircuitProject, instance: Instance): string | null {
  const binding = instance.netlist?.binding;
  switch (binding?.kind) {
    case "model":
      return binding.name;
    case "subcircuit":
      return (
        project.documents.find(
          (document) => document.id === binding.childDocumentId,
        )?.netlist?.name ?? "<subcircuit-model>"
      );
    case "external-subcircuit":
      return (
        project.externalSubcircuitDefinitions.find(
          (definition) => definition.id === binding.definitionId,
        )?.name ?? "<subcircuit-model>"
      );
    case "unresolved-subcircuit":
      return binding.name;
    default:
      return null;
  }
}

function nodeTokens(
  document: SchematicDocument,
  instance: Instance,
  pinNames: readonly string[],
): DesignNetlistInstance["nodes"] {
  const logicalNets = resolveDocumentLogicalNets(document);
  return pinNames.map((pinName) => {
    const baseNet = document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === pinName,
      ),
    );
    const logicalNet = baseNet
      ? logicalNets.byBaseNetId.get(baseNet.id)
      : undefined;
    return {
      pinName,
      netName: logicalNet?.name
        ? spellGreekLetters(logicalNet.name)
        : baseNet
          ? `<unnamed:${pinName}>`
          : `<unconnected:${pinName}>`,
    };
  });
}

function fallbackSpiceCard(
  project: CircuitProject,
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
): ComponentSourceCode {
  const descriptor = deviceDescriptor(instance.symbolId);
  if (descriptor?.deviceClass === "net-marker") {
    return {
      code: `* ${instance.symbolId} is a Net marker; it emits no Instance card`,
      exact: false,
      note: "Connect it to a named Net to affect exported connectivity.",
    };
  }

  const pinNames =
    descriptor?.pinOrder ??
    resolver
      .resolve(instance.symbolId, instance.symbolVariantId)
      ?.definition.pins.map((pin) => pin.name) ??
    [];
  const parameters = Object.entries(instance.netlist?.parameters ?? {})
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, rawValue]) => ({ name, rawValue }));
  for (const parameter of descriptor?.parameters ?? []) {
    if (
      parameter.required &&
      !parameters.some(
        (candidate) =>
          candidate.name.toLowerCase() === parameter.name.toLowerCase(),
      )
    ) {
      parameters.push({
        name: parameter.name,
        rawValue: `<${parameter.name}>`,
      });
    }
  }
  if (
    descriptor &&
    (descriptor.deviceClass === "voltage-source" ||
      descriptor.deviceClass === "current-source") &&
    parameters.length === 0
  ) {
    parameters.push({ name: "dc", rawValue: "<value>" });
  }

  // A T-coil or transformer already has its subcircuit: the library's
  // coupled windings, called with its own values in their declared order.
  const magnetic = descriptor ? drawnMagneticNetwork(descriptor) : null;
  if (magnetic) {
    const order = drawnMagneticParameters(magnetic);
    const rank = (name: string) => {
      const index = order.indexOf(name.toLowerCase());
      return index < 0 ? order.length : index;
    };
    parameters.sort((left, right) => rank(left.name) - rank(right.name));
  }
  const useSubcircuitTemplate =
    !magnetic && (!descriptor || descriptor.targetPolicy === "none");
  const control = instance.netlist?.control;
  const voltageControlled =
    descriptor?.deviceClass === "vcvs" || descriptor?.deviceClass === "vccs";
  const currentControlled =
    descriptor?.deviceClass === "cccs" || descriptor?.deviceClass === "ccvs";
  const controlNetNames = voltageControlled
    ? resolveDocumentLogicalNets(document).byBaseNetId
    : null;
  const controlNodes: DesignNetlistInstance["nodes"] = voltageControlled
    ? (
        [
          [
            "CTRL+",
            control?.kind === "voltage" ? control.positiveNetId : undefined,
          ],
          [
            "CTRL-",
            control?.kind === "voltage" ? control.negativeNetId : undefined,
          ],
        ] as const
      ).map(([pinName, netId]) => ({
        pinName,
        netName: netId
          ? (controlNetNames?.get(netId)?.name ?? `<unconnected:${pinName}>`)
          : `<unconnected:${pinName}>`,
      }))
    : [];
  const controlSensor =
    currentControlled && control?.kind === "current"
      ? document.instances.find(
          (candidate) => candidate.id === control.sensorInstanceId,
        )
      : undefined;
  const preview: DesignNetlistInstance = {
    id: instance.id,
    reference: spellGreekLetters(instance.reference ?? instance.id),
    invocationKind:
      useSubcircuitTemplate || magnetic ? "subcircuit" : "primitive",
    deviceClass:
      useSubcircuitTemplate || magnetic || !descriptor
        ? "hierarchical"
        : descriptor.deviceClass,
    target:
      magnetic?.subcircuit ??
      targetFor(project, instance) ??
      (useSubcircuitTemplate
        ? "<subcircuit-model>"
        : descriptor?.targetPolicy === "required-model"
          ? "<model>"
          : null),
    nodes: [...nodeTokens(document, instance, pinNames), ...controlNodes],
    parameters,
    ...(currentControlled
      ? {
          controlSourceReference:
            control?.kind === "terminal-current"
              ? control.instanceId && control.pinName
                ? `<probe:${document.instances.find((item) => item.id === control.instanceId)?.reference ?? "missing"}.${control.pinName}>`
                : "<select-device-terminal>"
              : controlSensor &&
                  deviceDescriptor(controlSensor.symbolId)?.deviceClass ===
                    "voltage-source"
                ? (controlSensor.reference ?? "<select-voltage-source>")
                : "<select-voltage-source>",
        }
      : {}),
    ...(control?.kind === "terminal-current"
      ? {
          controlCurrentSign:
            control.direction === "out" ? (-1 as const) : (1 as const),
        }
      : {}),
  };
  const code = printSpiceCellInstances({
    id: document.id,
    name: document.netlist?.name ?? "preview",
    ports: [],
    nets: [],
    instances: [preview],
  }).join("\n");
  return {
    code,
    exact: false,
    note: useSubcircuitTemplate
      ? "Subcircuit template — choose a concrete model before export."
      : "Preview uses explicit placeholders for unresolved models or Nets.",
  };
}

/** Exact current SPICE card when exportable; otherwise an honest placeholder template. */
export function componentSourceCode(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  resolver: SymbolResolver,
): ComponentSourceCode {
  const exact = exactSpiceCard(project, documentId, instanceId);
  if (exact) return { code: exact, exact: true, note: null };
  const document = project.documents.find(
    (candidate) => candidate.id === documentId,
  );
  const instance = document?.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!document || !instance) {
    return {
      code: "* Component is no longer available",
      exact: false,
      note: null,
    };
  }
  return fallbackSpiceCard(project, document, instance, resolver);
}
