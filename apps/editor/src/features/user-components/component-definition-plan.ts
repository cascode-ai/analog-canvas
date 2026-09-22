import type { CircuitProject, ComponentDefinition, Instance } from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";
import {
  parseSharedDefinition,
  sharedComponentNetlist,
} from "./component-library-contract";
import { planProjectCodeCommit } from "../project-code/project-code";

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
