import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  InstanceNetlistBinding,
  SchematicDocument,
} from "@icm/model";
import { projectCellInterface } from "@icm/model";

export interface FormalInterfaceTerminal {
  readonly id: string;
  readonly name: string;
  readonly direction: "input" | "output" | "inout" | "passive";
}

export interface FormalInterfaceParameter {
  readonly name: string;
  readonly defaultValue?: string;
}

/** The one consumer-facing grammar for internal and external subcircuits. */
export interface FormalSubcircuitInterface {
  readonly kind: "internal" | "external";
  readonly definitionId: string;
  readonly name: string;
  readonly terminals: readonly FormalInterfaceTerminal[];
  readonly formalParameters: readonly FormalInterfaceParameter[];
}

function internalInterface(
  document: SchematicDocument,
): FormalSubcircuitInterface | null {
  if (!document.netlist) return null;
  const projection = projectCellInterface(document.netlist);
  return {
    kind: "internal",
    definitionId: document.id,
    name: document.netlist.name,
    terminals: projection.ports.map((port) => ({
      id: port.id,
      name: port.name,
      direction: port.direction,
    })),
    formalParameters: document.netlist.formalParameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: parameter.defaultValue }),
    })),
  };
}

function externalInterface(
  definition: ExternalSubcircuitDefinition,
): FormalSubcircuitInterface {
  return {
    kind: "external",
    definitionId: definition.id,
    name: definition.name,
    terminals: definition.terminals.map((terminal) => ({
      id: terminal.id,
      name: terminal.name,
      direction: terminal.direction,
    })),
    formalParameters: definition.formalParameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: parameter.defaultValue }),
    })),
  };
}

export function resolveFormalSubcircuitInterface(
  project: CircuitProject,
  binding: InstanceNetlistBinding | undefined,
): FormalSubcircuitInterface | null {
  if (binding?.kind === "subcircuit") {
    const child = project.documents.find(
      (document) => document.id === binding.childDocumentId,
    );
    return child ? internalInterface(child) : null;
  }
  if (binding?.kind === "external-subcircuit") {
    const definition = project.externalSubcircuitDefinitions.find(
      (item) => item.id === binding.definitionId,
    );
    return definition ? externalInterface(definition) : null;
  }
  return null;
}

export function formalInterfaceForDocument(
  document: SchematicDocument,
): FormalSubcircuitInterface | null {
  return internalInterface(document);
}
