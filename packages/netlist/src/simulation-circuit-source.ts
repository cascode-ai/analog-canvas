import type { CircuitProject, SimulationCircuitBinding } from "@icm/model";
import {
  deviceDescriptor,
  reviewedExternalDeviceBindings,
  sky130MicrometresToProjectLength,
  type DeviceParameterDefinition,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";
import {
  printSpiceWithLocations,
  type PrintedSpiceParameter,
  type PrintedSpiceInstance,
} from "./printers.js";
import type { NetlistDiagnostic } from "./ir.js";

export interface EditableCircuitParameter extends PrintedSpiceParameter {
  descriptor: DeviceParameterDefinition;
  originalValue: string;
  conversion: "identity" | "sky130-micrometres";
  documentRevision: number;
}
export interface GeneratedCircuitSource {
  binding: SimulationCircuitBinding;
  text: string;
  parameters: EditableCircuitParameter[];
  instances: PrintedSpiceInstance[];
  reachedDocuments: { id: string; revision: number }[];
}

/** Editable Circuit view uses persisted values, never a prepared variable/Batch projection. */
export function generateCircuitSource(
  project: CircuitProject,
  binding: SimulationCircuitBinding,
):
  | { ok: true; source: GeneratedCircuitSource; warnings: NetlistDiagnostic[] }
  | { ok: false; diagnostics: NetlistDiagnostic[] } {
  const analysis = analyzeDesignNetlistForAuthoring(project, {
    format: "spice",
    rootDocumentId: binding.documentId,
  });
  if (
    !analysis.ir ||
    !analysis.ir.cells.some((cell) => cell.id === binding.documentId)
  )
    return { ok: false, diagnostics: analysis.diagnostics };
  const ir = analysis.ir;
  // These deliberately non-numeric slots exist only in the editing projection.
  // Never invent an electrical default or persist generated text as circuit authority.
  for (const cell of ir.cells) {
    for (const card of cell.instances) {
      const instance = project.documents
        .find((d) => d.id === cell.id)
        ?.instances.find((i) => i.id === card.id);
      if (!instance?.netlist) continue;
      const reviewed = reviewedExternalDeviceBindings.find(
        (item) => item.id === card.reviewedExternalBindingId,
      );
      const definitions =
        reviewed?.parameters ??
        deviceDescriptor(instance.symbolId)?.parameters ??
        [];
      for (const definition of definitions) {
        if (
          definition.editor === "select" ||
          definition.authoringVisibility === "compatibility"
        )
          continue;
        const present = card.parameters.find(
          (p) => p.name.toLowerCase() === definition.name.toLowerCase(),
        );
        const original = Object.entries(instance.netlist.parameters).find(
          ([name]) => name.toLowerCase() === definition.name.toLowerCase(),
        );
        if (!present && !definition.required && !original) continue;
        if (present?.rawValue.trim()) continue;
        const rawValue = original?.[1].trim() || `<${definition.name}>`;
        if (present) present.rawValue = rawValue;
        else
          card.parameters.push({
            name: original?.[0] ?? definition.name,
            rawValue,
          });
      }
    }
  }
  const printed = printSpiceWithLocations(ir, binding.emission === "top-level");
  const parameters = printed.parameters.flatMap(
    (span): EditableCircuitParameter[] => {
      const document = project.documents.find((d) => d.id === span.documentId)!;
      const instance = document.instances.find((i) => i.id === span.instanceId);
      const generated = ir.cells
        .find((c) => c.id === span.documentId)
        ?.instances.find((i) => i.id === span.instanceId);
      if (!instance?.netlist || !generated) return [];
      const originalName = Object.keys(instance.netlist.parameters).find(
        (name) => name.toLowerCase() === span.parameter.toLowerCase(),
      );
      const reviewed = reviewedExternalDeviceBindings.find(
        (item) => item.id === generated.reviewedExternalBindingId,
      );
      const descriptor = (
        reviewed?.parameters ?? deviceDescriptor(instance.symbolId)?.parameters
      )?.find((p) => p.name.toLowerCase() === span.parameter.toLowerCase());
      if (
        !descriptor ||
        descriptor.editor === "select" ||
        descriptor.authoringVisibility === "compatibility"
      )
        return [];
      const conversion =
        reviewed?.parameters.find((p) => p.name === descriptor.name)
          ?.targetUnit === "micrometre"
          ? "sky130-micrometres"
          : "identity";
      return [
        {
          ...span,
          parameter: originalName ?? descriptor.name,
          descriptor,
          conversion,
          originalValue: originalName
            ? instance.netlist.parameters[originalName]!
            : "",
          documentRevision: document.revision,
        },
      ];
    },
  );
  return {
    ok: true,
    source: {
      binding: { ...binding },
      text: printed.text,
      parameters,
      instances: printed.instances,
      reachedDocuments: ir.cells.map((cell) => ({
        id: cell.id,
        revision: project.documents.find((d) => d.id === cell.id)!.revision,
      })),
    },
    warnings: analysis.diagnostics,
  };
}

export interface CircuitParameterChange {
  documentId: string;
  expectedRevision: number;
  instanceId: string;
  parameter: string;
  value: string;
}
/** Plan exact parameter-only changes. The service checks the generation digest and commits typed edits atomically. */
export function planCircuitSourceEdit(
  source: GeneratedCircuitSource,
  nextText: string,
):
  | { ok: true; changes: CircuitParameterChange[] }
  | { ok: false; code: string; message: string } {
  const fail = (code: string, message: string) => ({
    ok: false as const,
    code,
    message,
  });
  const spans = [...source.parameters].sort(
    (a, b) => a.startOffset - b.startOffset,
  );
  const changes = new Map<string, CircuitParameterChange>();
  let originalOffset = 0;
  let nextOffset = 0;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!;
    const fixed = source.text.slice(originalOffset, span.startOffset);
    if (!nextText.startsWith(fixed, nextOffset))
      return fail(
        "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
        "Only highlighted numeric parameters can change; edit topology, references and model identity on Canvas",
      );
    nextOffset += fixed.length;
    const nextStart = spans[index + 1]?.startOffset ?? source.text.length;
    const after = source.text.slice(span.endOffset, nextStart);
    if (!after)
      return fail(
        "SIMULATION_PARAMETER_MAPPING",
        "Adjacent parameter spans have no reversible boundary",
      );
    const end = nextText.indexOf(after, nextOffset);
    if (end < 0)
      return fail(
        "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
        "The edited text changes a protected Circuit boundary",
      );
    const raw = nextText.slice(nextOffset, end);
    const key = JSON.stringify([
      span.documentId,
      span.instanceId,
      span.parameter,
    ]);
    // Preserve repeated-appearance agreement without validating untouched slots.
    if (raw === span.rawValue) {
      const prior = changes.get(key);
      if (prior && prior.value !== span.originalValue)
        return fail(
          "SIMULATION_PARAMETER_CONFLICT",
          `Repeated appearances of ${span.parameter} must agree`,
        );
      changes.set(key, {
        documentId: span.documentId,
        expectedRevision: span.documentRevision,
        instanceId: span.instanceId,
        parameter: span.parameter,
        value: span.originalValue,
      });
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
    const number = parseSpiceNumber(raw);
    if (!number || !Number.isFinite(number.value) || /\s/u.test(raw))
      return fail(
        "SIMULATION_PARAMETER_INVALID",
        `Finish the numeric value for ${span.descriptor.label} before applying`,
      );
    if (
      ["width", "length", "multiplier", "finger-count"].includes(
        span.descriptor.displayRole,
      ) &&
      number.value <= 0
    )
      return fail(
        "SIMULATION_PARAMETER_INVALID",
        `${span.descriptor.label} must be positive`,
      );
    if (
      span.descriptor.displayRole === "finger-count" &&
      !Number.isInteger(number.value)
    )
      return fail(
        "SIMULATION_PARAMETER_INVALID",
        "Finger count must be an integer",
      );
    let value = raw;
    try {
      if (span.conversion === "sky130-micrometres")
        value = sky130MicrometresToProjectLength(raw);
    } catch (error) {
      return fail(
        "SIMULATION_PARAMETER_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    const prior = changes.get(key);
    if (prior && prior.value !== value)
      return fail(
        "SIMULATION_PARAMETER_CONFLICT",
        `Repeated appearances of ${span.parameter} must agree`,
      );
    changes.set(key, {
      documentId: span.documentId,
      expectedRevision: span.documentRevision,
      instanceId: span.instanceId,
      parameter: span.parameter,
      value,
    });
    originalOffset = span.endOffset;
    nextOffset = end;
  }
  if (nextText.slice(nextOffset) !== source.text.slice(originalOffset))
    return fail(
      "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
      "The edited text changes protected Circuit content",
    );
  return {
    ok: true,
    changes: [...changes.values()].filter(
      (change) =>
        spans.find(
          (s) =>
            s.documentId === change.documentId &&
            s.instanceId === change.instanceId &&
            s.parameter === change.parameter,
        )!.originalValue !== change.value,
    ),
  };
}
