import type {
  CircuitProject,
  SimulationCircuitBinding,
  SimulationSourceInput,
} from "@icm/model";
import {
  deviceDescriptor,
  parameterExpressionBody,
  reviewedExternalDeviceBindings,
  sky130MicrometresToProjectLength,
  type DeviceParameterDefinition,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import {
  analyzeDesignNetlistForAuthoring,
  SIMULATION_DECK_GROUND,
} from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";
import { printSpiceWithLocations } from "./printers.js";
import { parseNgspiceSourceParameters } from "./simulation-ngspice-source-parameters.js";
import { inspectVacaskSource } from "./vacask-source.js";
import { vacaskValueToProject } from "./vacask-values.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import type {
  PrintedNetlistParameter,
  PrintedNetlistInstance,
} from "./printed-netlist.js";
import type { NetlistDiagnostic } from "./ir.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import { parseEditableSourceParameters } from "./simulation-source-parameters.js";

interface EditableSourceBody {
  documentId: string;
  instanceId: string;
  documentRevision: number;
  startOffset: number;
  endOffset: number;
  rawValue: string;
  sourceParameters: Record<string, string>;
}

export interface EditableCircuitParameter extends PrintedNetlistParameter {
  descriptor: DeviceParameterDefinition;
  originalValue: string;
  conversion: "identity" | "sky130-micrometres";
  documentRevision: number;
}
export interface GeneratedCircuitSource {
  engine?: "ngspice" | "vacask";
  binding: SimulationCircuitBinding;
  text: string;
  parameters: EditableCircuitParameter[];
  sourceBodies?: EditableSourceBody[];
  instances: PrintedNetlistInstance[];
  reachedDocuments: { id: string; revision: number }[];
}

/** Editable Circuit view uses persisted values, never a prepared variable/Batch projection. */
export function generateCircuitSource(
  project: CircuitProject,
  binding: SimulationCircuitBinding,
  input?: SimulationSourceInput,
  engine: "ngspice" | "vacask" = "vacask",
):
  | { ok: true; source: GeneratedCircuitSource; warnings: NetlistDiagnostic[] }
  | { ok: false; diagnostics: NetlistDiagnostic[] } {
  const analysis = analyzeDesignNetlistForAuthoring(project, {
    format: "spice",
    rootDocumentId: binding.documentId,
    ...SIMULATION_DECK_GROUND,
    rootAsTopLevel: binding.emission === "top-level",
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
      // Strict extraction refuses missing targets before printing. Authoring
      // intentionally retains those cards, so supply a visibly unresolved,
      // protected token in this projection only, never an electrical default.
      if (
        !card.target &&
        ["mos", "diode", "bjt", "switch", "hierarchical"].includes(
          card.deviceClass,
        )
      )
        card.target =
          card.invocationKind === "subcircuit" ? "<subcircuit>" : "<model>";
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
  let printed =
    engine === "ngspice"
      ? {
          ok: true as const,
          ...printSpiceWithLocations(ir, binding.emission === "top-level"),
        }
      : printVacaskWithLocations(ir, binding.emission === "top-level", {
          authoring: true,
        });
  if (input && engine === "vacask") {
    // A runnable experiment uses the EXACT compiled file, including primitive
    // name allocation and ownership across bindings. Incomplete experiments
    // retain the non-executable authoring projection so their values stay editable.
    const compiled = compileSourceSimulation(project, {
      version: 4,
      id: "circuit-preview",
      name: "Circuit preview",
      input,
    });
    const file = compiled.ok
      ? compiled.generated.find(
          (f) => f.bindingId === binding.id && f.path === binding.path,
        )
      : undefined;
    if (file)
      printed = {
        ok: true,
        text: file.text,
        parameters: file.parameters,
        instances: file.instances,
      };
  }
  if (!printed.ok)
    return {
      ok: false,
      diagnostics: [...analysis.diagnostics, ...printed.diagnostics],
    };
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
      engine,
      binding: { ...binding },
      text: printed.text,
      parameters,
      sourceBodies: printed.instances.flatMap((span): EditableSourceBody[] => {
        const cell = ir.cells.find((cell) => cell.id === span.documentId)!;
        const card = cell.instances.find((card) => card.id === span.instanceId);
        // Derived current sensors have no editable Canvas source body.
        if (!card) return [];
        if (
          !["voltage-source", "current-source"].includes(card.deviceClass) ||
          normalizeIndependentSource(card.parameters).extraParameters.length
        )
          return [];
        const text = printed.text.slice(span.startOffset, span.endOffset);
        const tokens = inspectVacaskSource("card", text).statements[0]?.tokens;
        const close =
          tokens?.findIndex((t) => t.kind === "symbol" && t.value === ")") ??
          -1;
        const master =
          engine === "ngspice"
            ? { end: /^\S+[ \t]+\S+[ \t]+\S+/u.exec(text)?.[0].length ?? 0 }
            : close < 0
              ? undefined
              : tokens?.[close + 1];
        if (!master) return [];
        const document = project.documents.find(
          (d) => d.id === span.documentId,
        )!;
        const instance = document.instances.find(
          (i) => i.id === span.instanceId,
        )!;
        return [
          {
            ...span,
            startOffset: span.startOffset + master.end,
            rawValue: text.slice(master.end),
            documentRevision: document.revision,
            sourceParameters: { ...instance.netlist!.parameters },
          },
        ];
      }),
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
  unset?: true;
}
/** Plan exact parameter-only changes. The service checks the generation digest and commits typed edits atomically. */
export function planCircuitSourceEdit(
  source: GeneratedCircuitSource,
  nextText: string,
):
  | { ok: true; changes: CircuitParameterChange[] }
  | {
      ok: false;
      code: string;
      message: string;
      range?: { from: number; to: number };
    } {
  const parseParameters =
    source.engine === "ngspice"
      ? parseNgspiceSourceParameters
      : parseEditableSourceParameters;
  let parameterRange: { from: number; to: number } | undefined;
  const fail = (code: string, message: string) => ({
    ok: false as const,
    code,
    message,
    ...(code === "SIMULATION_PARAMETER_INVALID" && parameterRange
      ? { range: parameterRange }
      : {}),
  });
  const bodies = source.sourceBodies ?? [];
  const spans = [
    ...source.parameters.filter(
      (p) =>
        !bodies.some(
          (body) =>
            p.startOffset >= body.startOffset && p.endOffset <= body.endOffset,
        ),
    ),
    ...bodies,
  ].sort((a, b) => a.startOffset - b.startOffset);
  const changes = new Map<string, CircuitParameterChange>();
  const sourceAppearances = new Map<string, string>();
  let invalid: ReturnType<typeof fail> | undefined;
  let originalOffset = 0;
  let nextOffset = 0;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!;
    const fixed = source.text.slice(originalOffset, span.startOffset);
    if (!nextText.startsWith(fixed, nextOffset))
      return fail(
        "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
        "Only highlighted parameter values or expressions can change; edit topology, references and model identity on Canvas",
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
    parameterRange = { from: nextOffset, to: end };
    if ("sourceParameters" in span) {
      if (raw && !/^\s/u.test(raw))
        return fail(
          "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
          "Keep source nodes separate from their parameter clauses.",
        );
      const identity = JSON.stringify([span.documentId, span.instanceId]);
      const priorText = sourceAppearances.get(identity);
      if (priorText !== undefined && priorText !== raw)
        return fail(
          "SIMULATION_PARAMETER_CONFLICT",
          "Repeated appearances of a source must agree.",
        );
      sourceAppearances.set(identity, raw);
      if (raw !== span.rawValue) {
        const parsed = parseParameters(raw);
        if (!parsed.ok)
          invalid ??= fail("SIMULATION_PARAMETER_INVALID", parsed.message);
        else {
          const previous = parseParameters(span.rawValue);
          const names = new Set([
            ...Object.keys(
              previous.ok ? previous.parameters : span.sourceParameters,
            ),
            ...Object.keys(parsed.parameters),
          ]);
          for (const name of names) {
            const originalName =
              Object.keys(span.sourceParameters).find(
                (key) => key.toLowerCase() === name.toLowerCase(),
              ) ?? name;
            const value = parsed.parameters[name];
            if (span.sourceParameters[originalName] === value) continue;
            const key = JSON.stringify([
              span.documentId,
              span.instanceId,
              originalName,
            ]);
            const change: CircuitParameterChange = {
              documentId: span.documentId,
              expectedRevision: span.documentRevision,
              instanceId: span.instanceId,
              parameter: originalName,
              value: value ?? "",
              ...(value === undefined ? { unset: true as const } : {}),
            };
            const prior = changes.get(key);
            if (
              prior &&
              (prior.value !== change.value || prior.unset !== change.unset)
            )
              return fail(
                "SIMULATION_PARAMETER_CONFLICT",
                `Repeated appearances of ${originalName} must agree`,
              );
            changes.set(key, change);
          }
        }
      }
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
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
    let projectValue: string;
    try {
      projectValue =
        source.engine === "ngspice" ? raw : vacaskValueToProject(raw);
    } catch (error) {
      invalid ??= fail(
        "SIMULATION_PARAMETER_INVALID",
        error instanceof Error ? error.message : String(error),
      );
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
    const number = parseSpiceNumber(projectValue);
    const expression = parameterExpressionBody(projectValue);
    if (
      expression === undefined &&
      (!number || !Number.isFinite(number.value) || /\s/u.test(raw))
    ) {
      invalid ??= fail(
        "SIMULATION_PARAMETER_INVALID",
        `Finish the native number or parenthesized expression for ${span.descriptor.label} before applying`,
      );
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
    if (
      ["width", "length", "multiplier", "finger-count"].includes(
        span.descriptor.displayRole,
      ) &&
      number &&
      number.value <= 0
    ) {
      invalid ??= fail(
        "SIMULATION_PARAMETER_INVALID",
        `${span.descriptor.label} must be positive`,
      );
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
    if (
      span.descriptor.displayRole === "finger-count" &&
      number &&
      !Number.isInteger(number.value)
    ) {
      invalid ??= fail(
        "SIMULATION_PARAMETER_INVALID",
        "Finger count must be an integer",
      );
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
    }
    let value = projectValue;
    try {
      if (span.conversion === "sky130-micrometres") {
        if (
          number &&
          !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw.trim())
        )
          throw Error(
            "Reviewed SKY130 geometry uses plain micrometre numbers, not an SI-suffixed value.",
          );
        value = sky130MicrometresToProjectLength(projectValue);
      }
    } catch (error) {
      invalid ??= fail(
        "SIMULATION_PARAMETER_INVALID",
        error instanceof Error ? error.message : String(error),
      );
      originalOffset = span.endOffset;
      nextOffset = end;
      continue;
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
  if (invalid) return invalid;
  return {
    ok: true,
    changes: [...changes.values()].filter(
      (change) =>
        !source.parameters.some(
          (s) =>
            s.documentId === change.documentId &&
            s.instanceId === change.instanceId &&
            s.parameter === change.parameter &&
            s.originalValue === change.value &&
            !change.unset,
        ),
    ),
  };
}
