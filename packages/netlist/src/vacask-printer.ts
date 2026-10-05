import { directObjectLocator } from "@icm/derived";
import {
  parameterExpressionBody,
  builtInModelContract,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
import { expressionIsStructurallyValid, parseSpiceNumber } from "@icm/spice";
import type {
  DesignNetlistIR,
  DesignNetlistInstance,
  NetlistDiagnostic,
} from "./ir.js";
import type {
  PrintedNetlistInstance,
  PrintedNetlistParameter,
} from "./printed-netlist.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import { nativeBehavioralModel } from "./native-generated-models.js";
import { switchBehavioralDefinition } from "./ideal-switch-model.js";

const RESERVED = new Set(
  "include section endsection load model global ground subckt ends parameters control endc analysis sweep embed save".split(
    " ",
  ),
);
const FUNCTIONS = new Set(
  "abs sqrt exp ln log log10 sin cos tan asin acos atan atan2 sinh cosh tanh floor ceil min max pow".split(
    " ",
  ),
);
const PRIMITIVES = {
  resistor: { module: "resistor", value: "r", file: "resistor.osdi" },
  capacitor: { module: "capacitor", value: "c", file: "capacitor.osdi" },
  inductor: { module: "inductor", value: "l", file: "inductor.osdi" },
  "voltage-source": { module: "vsource", file: null },
  "current-source": { module: "isource", file: null },
  vcvs: { module: "vcvs", file: null },
  vccs: { module: "vccs", file: null },
  cccs: { module: "cccs", file: null },
  ccvs: { module: "ccvs", file: null },
} as const;

class ProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Native identifiers are case-sensitive; quoting does not rename an electrical node. */
export function vacaskIdentifier(name: string): string {
  if (!name || /\s/u.test(name))
    throw new ProjectionError(
      "VACASK_INVALID_IDENTIFIER",
      `Cannot represent identifier ${JSON.stringify(name)} in native VACASK.`,
    );
  if (
    name === "0" ||
    (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) && !RESERVED.has(name))
  )
    return name;
  return `'${name.replaceAll("'", "''")}'`;
}

/** Translate project scalar syntax, not arbitrary authored simulation programs. */
export function vacaskProjectValue(
  raw: string,
  parameterNames: ReadonlyMap<string, string> = new Map(),
): string {
  const number = parseSpiceNumber(raw);
  if (number) {
    if (!Number.isFinite(number.value))
      throw new ProjectionError(
        "VACASK_NONFINITE_PARAMETER",
        `Non-finite project value: ${raw}`,
      );
    // Integer tokens can be narrowed to 32 bits when native behavioral
    // parameters reach OSDI/Verilog-A. Keep large electrical values real.
    return Number.isInteger(number.value) && Math.abs(number.value) > 2147483647
      ? number.value.toExponential()
      : String(number.value);
  }
  const body = parameterExpressionBody(raw) ?? raw.trim();
  if (!expressionIsStructurallyValid(body))
    throw new ProjectionError(
      "VACASK_UNSUPPORTED_PARAMETER",
      `Project expression cannot be projected safely to VACASK: ${raw}`,
    );
  let rest = body;
  const output: string[] = [];
  while (rest) {
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) {
      // Do not concatenate separate lexical tokens (e.g. "1 k" into "1k").
      // Newlines in a scalar must not become circuit statements either.
      output.push(" ");
      rest = rest.slice(whitespace[0].length);
      continue;
    }
    const literal =
      /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpfa])?[a-z]*/iu.exec(
        rest,
      );
    if (literal) {
      output.push(vacaskProjectValue(literal[0]));
      rest = rest.slice(literal[0].length);
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest);
    if (identifier) {
      const name = identifier[0];
      rest = rest.slice(name.length);
      if (/^\s*\(/u.test(rest)) {
        if (!FUNCTIONS.has(name.toLowerCase()))
          throw new ProjectionError(
            "VACASK_UNSUPPORTED_FUNCTION",
            `Project function ${name} needs an explicit native mapping.`,
          );
        // Preserve executed .param semantics: log/ln are natural logarithms
        // (ngspice 46 manual 2.11.5).
        output.push(name.toLowerCase());
      } else
        output.push(
          vacaskIdentifier(parameterNames.get(name.toLowerCase()) ?? name),
        );
      continue;
    }
    const operator = /^(?:\*\*|&&|\|\||==|!=|<=|>=|[+\-*/^!<>() ,])/u.exec(
      rest,
    );
    if (!operator)
      throw new ProjectionError(
        "VACASK_UNSUPPORTED_PARAMETER",
        `Unsupported project expression token in ${raw}`,
      );
    output.push(operator[0] === "^" ? "**" : operator[0]);
    rest = rest.slice(operator[0].length);
  }
  return `(${output.join("")})`;
}

export type PrintedVacask =
  | {
      ok: true;
      text: string;
      instances: PrintedNetlistInstance[];
      parameters: PrintedNetlistParameter[];
    }
  | { ok: false; diagnostics: NetlistDiagnostic[] };

/**
 * Native circuit projection directly from the shared electrical IR. Analyses,
 * model-library selection and environment policy belong to preparation, not
 * this printer. Used by native execution and the generated Circuit preview.
 */
export function printVacaskWithLocations(
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
  emission: {
    cellIds?: ReadonlySet<string>;
    definitionNames?: ReadonlySet<string>;
    preamble?: boolean;
    reservedNames?: Iterable<string>;
    /** Editing projection only: unresolved parameter slots never reach execution. */
    authoring?: boolean;
  } = {},
): PrintedVacask {
  const diagnostics: NetlistDiagnostic[] = [];
  const instances: PrintedNetlistInstance[] = [];
  const parameters: PrintedNetlistParameter[] = [];
  const projectValue = (raw: string, names: ReadonlyMap<string, string>) =>
    emission.authoring && /^<[A-Za-z][A-Za-z0-9_-]*>$/u.test(raw)
      ? raw
      : vacaskProjectValue(raw, names);
  const cellsById = new Map(ir.cells.map((cell) => [cell.id, cell]));
  const cellsByName = new Map(ir.cells.map((cell) => [cell.name, cell]));
  const mastersByName = new Map(
    [
      ...ir.cells,
      ...(ir.externalMasters ?? []),
      ...(ir.generatedDefinitions ?? []).map((definition) => ({
        name: definition.name,
        formalParameters:
          definition.kind === "magnetic"
            ? definition.formalParameters
            : (builtInModelContract(definition.name)?.parameters ?? []).map(
                (p) => ({
                  name: p.name,
                  ...(p.defaultValue !== undefined
                    ? { defaultValue: p.defaultValue }
                    : {}),
                }),
              ),
      })),
    ].map((master) => [master.name, master]),
  );
  // Only generated definitions with an actual IR multiplicity call acquire
  // forwarding. Do not claim an arbitrary external wrapper forwards a factor
  // merely because it happens to declare a parameter named m.
  const multipliedCells = new Set<string>();
  const pending = ir.cells.flatMap((cell) =>
    cell.instances.flatMap((instance) =>
      instance.invocationKind === "subcircuit" &&
      instance.parameters.some((p) => p.name.toLowerCase() === "m") &&
      instance.target &&
      cellsByName.has(instance.target)
        ? [instance.target]
        : [],
    ),
  );
  for (let index = 0; index < pending.length; index++) {
    const cell = cellsByName.get(pending[index]!)!;
    if (multipliedCells.has(cell.id)) continue;
    multipliedCells.add(cell.id);
    for (const instance of cell.instances)
      if (
        instance.invocationKind === "subcircuit" &&
        instance.target &&
        cellsByName.has(instance.target)
      )
        pending.push(instance.target);
  }
  let text = "// Generated native VACASK circuit\n";
  const append = (line: string) => {
    text += `${line}\n`;
  };
  const report = (
    cellId: string,
    instanceId: string | undefined,
    error: unknown,
  ) => {
    if (!(error instanceof ProjectionError)) throw error;
    diagnostics.push({
      code: error.code,
      severity: "error",
      documentId: cellId,
      objectIds: instanceId ? [instanceId] : [],
      primary: directObjectLocator(
        cellId,
        instanceId ? "instance" : "document",
        instanceId ?? cellId,
      ),
      message: error.message,
    });
  };
  const used = new Set([
    ...(emission.reservedNames ?? []),
    ...ir.cells.map((c) => c.name),
    ...(ir.generatedDefinitions ?? []).map((d) => d.name),
    ...(ir.externalMasters ?? []).map((m) => m.name),
    ...ir.cells.flatMap((c) =>
      c.instances.flatMap((i) => (i.target ? [i.target] : [])),
    ),
  ]);
  const models = new Map<string, string>();
  let switchMaster: string | undefined;
  if (ir.cells.some((c) => c.models?.some((m) => m.type === "SW"))) {
    switchMaster = "__icm_switch";
    while (used.has(switchMaster)) switchMaster += "_";
    used.add(switchMaster);
    if (emission.preamble !== false) {
      // The qualified native primitive registers hard-edge breakpoints. A
      // ternary behavioral source alone cannot do this on OpenVAF/VACASK 0.3.4.
      // RON/ROFF/VT still come from the shared Cell-owned model below.
      append(`model ${switchMaster} icm_switch`);
    }
  }
  if (
    emission.preamble !== false &&
    ir.cells.some((c) => c.models?.some((m) => m.type === "D"))
  )
    append('load "spice/diode.osdi"');
  const classes = new Set(
    ir.cells.flatMap((cell) =>
      cell.instances.flatMap((card) =>
        card.invocationKind === "primitive" ? [card.deviceClass] : [],
      ),
    ),
  );
  for (const definition of ir.generatedDefinitions ?? []) {
    if (definition.kind === "magnetic") {
      classes.add("inductor");
      if (definition.capacitors.length) classes.add("capacitor");
    } else if (builtInModelContract(definition.name)?.family === "logic") {
      classes.add("resistor");
      classes.add("capacitor");
    }
  }
  for (const deviceClass of classes) {
    if (!(deviceClass in PRIMITIVES)) continue;
    const definition = PRIMITIVES[deviceClass as keyof typeof PRIMITIVES];
    let name = `__icm_${definition.module}`;
    while (used.has(name)) name += "_";
    used.add(name);
    models.set(deviceClass, name);
    if (emission.preamble !== false) {
      if (definition.file) append(`load "${definition.file}"`);
      append(`model ${name} ${definition.module}`);
    }
  }
  try {
    if (emission.preamble !== false) append("ground 0");
    const globals = ir.globals.filter((n) => n !== "0");
    if (globals.length && emission.preamble !== false)
      append(`global ${globals.map(vacaskIdentifier).join(" ")}`);
    if (!ir.cells.some((c) => c.id === ir.topCellId))
      throw new ProjectionError(
        "VACASK_MISSING_TOP",
        "IR does not contain its selected top Cell.",
      );
  } catch (error) {
    report(ir.topCellId, undefined, error);
  }

  const emitCard = (cellId: string, card: DesignNetlistInstance) => {
    if (card.deviceClass === "net-marker") return;
    const start = text.length;
    const localSpans: PrintedNetlistParameter[] = [];
    const assigned = new Set<string>();
    const scope = cellsById.get(cellId)!;
    const ownedModel = scope.models?.find(
      (model) => model.name === card.target,
    );
    const inheritedMultiplicity = multipliedCells.has(cellId);
    const externalSubcircuit =
      card.invocationKind === "subcircuit" &&
      !!card.target &&
      !cellsByName.has(card.target);
    const reviewed = card.target
      ? reviewedExternalBindingForMaster(card.target)
      : undefined;
    const reviewedMultiplier =
      reviewed?.id === card.reviewedExternalBindingId &&
      reviewed?.parameters.some(
        (p) => p.name === "m" && p.displayRole === "multiplier",
      );
    // An external formal called m is not necessarily parallel multiplicity.
    // Only a reviewed device binding can override that declared meaning.
    const ordinaryExternalM =
      externalSubcircuit &&
      !reviewedMultiplier &&
      mastersByName
        .get(card.target!)
        ?.formalParameters?.some((p) => p.name.toLowerCase() === "m");
    const parameterNames = new Map(
      (scope.formalParameters ?? []).map((p) => [p.name.toLowerCase(), p.name]),
    );
    let line = `${vacaskIdentifier(card.reference)} (${card.nodes.map((n) => vacaskIdentifier(n.netName)).join(" ")}) `;
    const assignment = (
      name: string,
      raw: string,
      originalName = name,
      verbatim = false,
    ) => {
      if (assigned.has(name))
        throw new ProjectionError(
          "VACASK_DUPLICATE_PARAMETER",
          `${card.reference} has two projections for native parameter ${name}.`,
        );
      assigned.add(name);
      const value = verbatim ? raw : projectValue(raw, parameterNames);
      line += ` ${vacaskIdentifier(name)}=`;
      localSpans.push({
        documentId: cellId,
        instanceId: card.id,
        parameter: originalName,
        rawValue: value,
        startOffset: start + line.length,
        endOffset: start + line.length + value.length,
      });
      line += value;
    };
    if (ownedModel?.type === "SW") {
      const values = new Map(
        ownedModel.parameters.map((p) => [p.name.toLowerCase(), p.rawValue]),
      );
      if (
        parseSpiceNumber(values.get("vh") ?? "0")?.value !== 0 ||
        card.nodes.length !== 4
      )
        throw new ProjectionError(
          "VACASK_UNSUPPORTED_MODEL",
          `${card.reference}: hysteretic switch models need an explicit native model.`,
        );
    }
    if (card.invocationKind === "subcircuit" || !models.has(card.deviceClass)) {
      if (!card.target)
        throw new ProjectionError(
          "VACASK_MISSING_MASTER",
          `${card.reference} has no native model/subcircuit target.`,
        );
      line += vacaskIdentifier(card.target);
      const targetParameters =
        mastersByName.get(card.target)?.formalParameters ?? [];
      for (const p of card.parameters) {
        if (p.name.toLowerCase() === "m" && !ordinaryExternalM) continue;
        assignment(
          targetParameters.find(
            (f) => f.name.toLowerCase() === p.name.toLowerCase(),
          )?.name ?? p.name,
          p.rawValue,
          p.name,
        );
      }
    } else {
      line += models.get(card.deviceClass)!;
      if (
        card.deviceClass === "voltage-source" ||
        card.deviceClass === "current-source"
      ) {
        const source = normalizeIndependentSource(card.parameters);
        if (source.issues.length && !emission.authoring)
          throw new ProjectionError(
            source.issues[0]!.code,
            `${card.reference}: ${source.issues.map((i) => i.message).join("; ")}`,
          );
        const transient = source.transient;
        assignment(
          "type",
          JSON.stringify(transient.kind === "sin" ? "sine" : transient.kind),
          "waveform",
          true,
        );
        if (source.dc !== undefined) assignment("dc", source.dc);
        if (source.ac) {
          assignment("mag", source.ac.magnitude, "acMagnitude");
          assignment("phase", source.ac.phase, "acPhase");
        }
        if (transient.kind === "pulse") {
          for (const [native, original] of [
            ["val0", "low"],
            ["val1", "high"],
            ["delay", "delay"],
            ["rise", "rise"],
            ["fall", "fall"],
            ["width", "width"],
            ["period", "period"],
          ] as const)
            assignment(
              native,
              transient[original] ?? `<${original}>`,
              original,
            );
        } else if (transient.kind === "sin") {
          for (const [native, original] of [
            ["sinedc", "offset"],
            ["ampl", "amplitude"],
            ["freq", "frequency"],
            ["delay", "delay"],
            ["theta", "damping"],
            ["tdphase", "phase"],
          ] as const)
            assignment(
              native,
              transient[original] ?? `<${original}>`,
              original,
            );
        } else if (transient.kind === "pwl") {
          assignment(
            "wave",
            emission.authoring && !transient.points.length
              ? "<pwlPoints>"
              : `[${transient.points.flatMap((p) => [projectValue(p.time, parameterNames), projectValue(p.value, parameterNames)]).join(", ")}]`,
            "pwlPoints",
            true,
          );
        }
        for (const p of source.extraParameters)
          if (p.name.toLowerCase() !== "m")
            assignment(p.name, p.rawValue, p.name);
      } else if (["vcvs", "vccs", "cccs", "ccvs"].includes(card.deviceClass)) {
        // VACASK builtins use gain for all four dimensions. Current controls
        // reuse the shared IR's zero-volt probe, scoped to this subcircuit.
        const current =
          card.deviceClass === "cccs" || card.deviceClass === "ccvs";
        const key =
          card.deviceClass === "vccs"
            ? "gm"
            : card.deviceClass === "ccvs"
              ? "rm"
              : "gain";
        const gain = card.parameters.find((p) => p.name.toLowerCase() === key);
        if (!gain || card.nodes.length !== (current ? 2 : 4))
          throw new ProjectionError(
            "VACASK_INVALID_CONTROLLED_SOURCE",
            `${card.reference} requires a gain and complete control terminals.`,
          );
        const value = projectValue(gain.rawValue, parameterNames);
        assignment(
          "gain",
          current && card.controlCurrentSign === -1 ? `-(${value})` : value,
          gain.name,
          true,
        );
        if (current) {
          if (!card.controlSourceReference)
            throw new ProjectionError(
              "VACASK_MISSING_CURRENT_CONTROL",
              `${card.reference} requires a resolved current probe.`,
            );
          // An electrical reference is not an editable scalar parameter.
          line += ` ctlinst=${JSON.stringify(card.controlSourceReference)}`;
        }
      } else {
        const definition =
          PRIMITIVES[card.deviceClass as "resistor" | "capacitor" | "inductor"];
        const value = card.parameters.find(
          (p) => p.name.toLowerCase() === "value",
        );
        if (!value)
          throw new ProjectionError(
            "VACASK_MISSING_VALUE",
            `${card.reference} has no ${card.deviceClass} value.`,
          );
        assignment(definition.value, value.rawValue, value.name);
        for (const p of card.parameters)
          if (p !== value && p.name.toLowerCase() !== "m")
            assignment(p.name, p.rawValue, p.name);
      }
    }
    const factors = card.parameters.filter(
      (p) => p.name.toLowerCase() === "m" && !ordinaryExternalM,
    );
    if (
      factors.length > 1 ||
      (assigned.has("$mfactor") && (factors.length || inheritedMultiplicity))
    )
      throw new ProjectionError(
        "VACASK_DUPLICATE_PARAMETER",
        `${card.reference} has two projections for native parameter $mfactor.`,
      );
    const factor = factors[0];
    // Parallel ideal voltage sources must not divide reported branch current
    // by an inherited factor. Their imposed voltage is already unchanged.
    const inherit =
      inheritedMultiplicity &&
      !(
        card.invocationKind === "primitive" &&
        card.deviceClass === "voltage-source"
      );
    // Exact numeric unity has no electrical effect. Do not demand an external
    // forwarding contract for it, or erase inherited/nonliteral multiplicity.
    const neutralExternalFactor =
      externalSubcircuit &&
      !inherit &&
      factor &&
      parseSpiceNumber(factor.rawValue)?.value === 1;
    if ((factor || inherit) && !neutralExternalFactor) {
      if (
        card.invocationKind === "subcircuit" &&
        !cellsByName.has(card.target!) &&
        !emission.authoring
      )
        throw new ProjectionError(
          "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
          `${card.reference}: external subcircuit multiplicity needs a qualified native forwarding contract.`,
        );
      line += " $mfactor=";
      if (factor) {
        const value = projectValue(factor.rawValue, parameterNames);
        if (inherit) line += "($mfactor*";
        localSpans.push({
          documentId: cellId,
          instanceId: card.id,
          parameter: factor.name,
          rawValue: value,
          startOffset: start + line.length,
          endOffset: start + line.length + value.length,
        });
        line += value;
        if (inherit) line += ")";
      } else line += "$mfactor";
    }
    append(line);
    instances.push({
      documentId: cellId,
      instanceId: card.id,
      startOffset: start,
      endOffset: start + line.length,
    });
    parameters.push(...localSpans);
  };

  for (const definition of ir.generatedDefinitions ?? []) {
    if (
      emission.definitionNames &&
      !emission.definitionNames.has(definition.name)
    )
      continue;
    if (definition.kind === "behavioral") {
      for (const line of nativeBehavioralModel(
        definition.name,
        (raw) => vacaskProjectValue(raw),
        models,
      ))
        append(line);
    } else {
      append(
        `subckt ${vacaskIdentifier(definition.name)} (${definition.ports.map(vacaskIdentifier).join(" ")})`,
      );
      for (const p of definition.formalParameters)
        append(`parameters ${p.name}=${vacaskProjectValue(p.defaultValue)}`);
      append("model __coupling mutual");
      for (const [index, l] of definition.inductors.entries()) {
        const line = (nodes: readonly string[]) =>
          `${l.name} (${nodes.join(" ")}) ${models.get("inductor")} l=${l.parameter}`;
        if (index === 1) {
          append(`@if ${definition.coupling.parameter}<0`);
          append(line([...l.nodes].reverse()));
          append("@else");
          append(line(l.nodes));
          append("@end");
        } else append(line(l.nodes));
      }
      const k = definition.coupling;
      append(
        `${k.name} () __coupling k=abs(${k.parameter}) ind1=${JSON.stringify(k.inductors[0])} ind2=${JSON.stringify(k.inductors[1])}`,
      );
      for (const c of definition.capacitors)
        append(
          `${c.name} (${c.nodes.join(" ")}) ${models.get("capacitor")} c=${c.parameter}`,
        );
      append("ends");
    }
    append("");
  }

  for (const cell of ir.cells) {
    if (emission.cellIds && !emission.cellIds.has(cell.id)) continue;
    const top = rootAsTopLevel && cell.id === ir.topCellId;
    const parameterNames = new Map(
      (cell.formalParameters ?? []).map((p) => [p.name.toLowerCase(), p.name]),
    );
    try {
      if (!top)
        append(
          `subckt ${vacaskIdentifier(cell.name)} (${cell.ports.map((p) => vacaskIdentifier(p.netName)).join(" ")})`,
        );
      if (multipliedCells.has(cell.id)) {
        if (
          cell.formalParameters?.some((p) =>
            ["m", "$mfactor"].includes(p.name.toLowerCase()),
          )
        )
          throw new ProjectionError(
            "VACASK_MULTIPLICITY_PARAMETER_CONFLICT",
            `Cell ${cell.name} declares a parameter that conflicts with generated multiplicity forwarding.`,
          );
        append("parameters $mfactor=1");
      }
      for (const p of cell.formalParameters ?? []) {
        if (p.defaultValue === undefined)
          throw new ProjectionError(
            "VACASK_REQUIRED_PARAMETER_DEFAULT",
            `Cell ${cell.name} parameter ${p.name} requires a native default before projection.`,
          );
        append(
          `parameters ${vacaskIdentifier(p.name)}=${vacaskProjectValue(p.defaultValue, parameterNames)}`,
        );
      }
      for (const model of cell.models ?? []) {
        if (model.type === "SW") {
          const values = new Map(
            model.parameters.map((p) => [p.name.toLowerCase(), p.rawValue]),
          );
          if (parseSpiceNumber(values.get("vh") ?? "0")?.value !== 0)
            throw new ProjectionError(
              "VACASK_UNSUPPORTED_MODEL",
              `Cell-owned switch ${model.name} needs an explicit native hysteresis model.`,
            );
          // Keep the Canvas reference and four-terminal interface intact;
          // only the qualified runtime owns event location and LTE history.
          append(`subckt ${vacaskIdentifier(model.name)} (p n cp cn)`);
          append("parameters $mfactor=1");
          append(
            `implementation (p n cp cn) ${switchMaster} $mfactor=$mfactor ${switchBehavioralDefinition(
              model,
            )
              .parameters.map(
                (p) =>
                  `${p.name}=${projectValue(p.defaultValue, parameterNames)}`,
              )
              .join(" ")}`,
          );
          append("ends");
          continue;
        }
        if (model.type !== "D")
          throw new ProjectionError(
            "VACASK_UNSUPPORTED_MODEL",
            `Cell-owned model ${model.name} (${model.type}) needs a qualified native mapping.`,
          );
        append(
          `model ${vacaskIdentifier(model.name)} sp_diode ${model.parameters.map((p) => `${p.name.toLowerCase()}=${projectValue(p.rawValue, parameterNames)}`).join(" ")}`,
        );
      }
    } catch (error) {
      report(cell.id, undefined, error);
    }
    for (const card of cell.instances) {
      try {
        emitCard(cell.id, card);
      } catch (error) {
        report(cell.id, card.id, error);
      }
    }
    if (!top) append("ends");
    append("");
  }
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, text, instances, parameters };
}
