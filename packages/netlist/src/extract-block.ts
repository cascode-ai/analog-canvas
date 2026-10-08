// An Analog Block as its call: supplies, an adder's signs, and the ideal
// comparator's and op-amp's parameters and bodies.
import { drawnSupplyNet, drawsSupply } from "@icm/derived";
import type { Instance, SchematicDocument } from "@icm/model";
import {
  ADDER_SIGNED_INPUTS,
  ADDER_TARGET,
  IDEAL_COMPARATOR_SUPPLY_TARGET,
  OPAMP_HIGH_LIMIT,
  OPAMP_LIMIT_SUPPLIES,
  OPAMP_LOW_LIMIT,
  OPAMP_TARGET,
  UNPOWERED_OPAMP_LIMITS,
  adderInputSigns,
  HIGH_LEVEL_PARAMETER,
  callsIdealComparatorBody,
  callsIdealOpampBody,
  idealComparatorBodyPorts,
  idealOpampBodyFor,
  idealOpampBodyReads,
  isSupplyLimit,
  isSupplyLimitParameter,
  limitFollowsSupply,
  isSupplyHighLevel,
  type BuiltInSubcircuitDescriptor,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import type { DesignNetlistInstance, NetlistDiagnostic } from "./ir.js";
import { implicitSupplyNetId } from "./implicit-mos-supplies.js";
import { builtInBlockCallTarget } from "./ideal-analog-block-models.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  isIdentifier,
  compareText,
  diagnostic,
} from "./extract-common.js";
import { type CellNetContext, terminalNetName } from "./extract-nets.js";

export function extractBuiltInSubcircuitInstance(
  document: SchematicDocument,
  instance: Instance,
  definition: BuiltInSubcircuitDescriptor,
  reference: string,
  context: CellNetContext,
  _options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
  /** The Project's own subcircuit names; see projectSubcircuitNames. */
  projectNames: ReadonlySet<string>,
  /** The body never reads VDD/VSS, so an undrawn supply is tied to ground. */
  supplyFree = false,
): DesignNetlistInstance | null {
  const netlist = instance.netlist;
  const binding = netlist?.binding;
  if (binding && binding.kind !== "unresolved-subcircuit") {
    diagnostic(
      diagnostics,
      document.id,
      "BUILTIN_SUBCIRCUIT_BINDING_MISMATCH",
      `Analog Block ${reference} requires a black-box subcircuit target`,
      [instance.id],
    );
    return null;
  }
  const target = builtInBlockCallTarget(instance, definition, projectNames);
  if (!isIdentifier(reference) || !isIdentifier(target)) {
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_SUBCIRCUIT_IDENTIFIER",
      `Analog Block ${reference} or target ${target} is outside the portable identifier subset`,
      [instance.id],
    );
  }
  // An adder's input signs chose its body above; they are not SPICE
  // parameters, so the call carries none of them.
  const adderSigns =
    definition.target === ADDER_TARGET
      ? adderInputSigns(netlist?.parameters)
      : [];
  const signNames = new Set(
    ADDER_SIGNED_INPUTS.map((input) => input.parameter.toLowerCase()),
  );
  for (const input of adderSigns) {
    if (input.sign === null)
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_ADDER_SIGN",
        `Adder ${reference}'s ${input.parameter} must be + or -; received ${netlist?.parameters[input.parameter]}`,
        [instance.id],
        "error",
        input.parameter,
      );
  }
  // The signs choose among the generated adder bodies only. A call that
  // reaches anything else must subtract as drawn: a subcircuit the adder
  // was retargeted to, or the Project's own definition of the name.
  const retargeted =
    binding?.kind === "unresolved-subcircuit" &&
    binding.name.toLowerCase() !== definition.target;
  const ownDefinition = projectNames.has(target.toLowerCase());
  if (
    adderSigns.some((input) => input.sign === "-") &&
    (retargeted || ownDefinition)
  )
    diagnostic(
      diagnostics,
      document.id,
      "ADDER_SIGN_NOT_EXPORTED",
      `Adder ${reference} subtracts ${adderSigns
        .filter((input) => input.sign === "-")
        .map((input) => input.pinName)
        .join(" and ")}, but calls ${target}${
        ownDefinition ? ", which this Project defines" : ""
      }: the signs choose only among the built-in adder bodies, so ${target} must subtract as drawn`,
      [instance.id],
      "warning",
    );
  const parameters = Object.entries(netlist?.parameters ?? {}).filter(
    ([name]) => !adderSigns.length || !signNames.has(name.toLowerCase()),
  );
  for (const [name] of parameters) {
    if (isIdentifier(name)) continue;
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_PARAMETER_NAME",
      `Parameter name is outside the portable identifier subset: ${name}`,
      [instance.id],
    );
  }
  const idealComparator = callsIdealComparatorBody(definition, target);
  if (idealComparator) {
    const seenParameters = new Set<string>();
    for (const [name, rawValue] of parameters) {
      const folded = name.toLowerCase();
      if (seenParameters.has(folded)) {
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_PARAMETER_NAME",
          `Ideal comparator ${reference} repeats parameter ${name} under case folding`,
          [instance.id],
          "error",
          name,
        );
      }
      seenParameters.add(folded);
      if (!["vhigh", "vlow", "vtransition"].includes(folded)) {
        diagnostic(
          diagnostics,
          document.id,
          "UNKNOWN_IDEAL_COMPARATOR_PARAMETER",
          `Ideal comparator ${reference} accepts only vhigh, vlow, and vtransition`,
          [instance.id],
          "error",
          name,
        );
        continue;
      }
      if (folded === HIGH_LEVEL_PARAMETER && isSupplyHighLevel(rawValue))
        continue;
      const parsed = parseSpiceNumber(rawValue.trim());
      if (
        parsed &&
        Number.isFinite(parsed.value) &&
        (folded !== "vtransition" || parsed.value > 0)
      )
        continue;
      diagnostic(
        diagnostics,
        document.id,
        "INVALID_IDEAL_COMPARATOR_PARAMETER",
        folded === HIGH_LEVEL_PARAMETER
          ? `Ideal comparator ${reference} requires ${name} to be a number or VDD`
          : `Ideal comparator ${reference} requires numeric ${name}${folded === "vtransition" ? " > 0" : ""}`,
        [instance.id],
        "error",
        name,
      );
    }
  }
  // A Project's own definition of the op-amp's name replaces every body.
  const idealOpamp =
    callsIdealOpampBody(definition, target) &&
    !projectNames.has(target.toLowerCase());
  const opampParameters = Object.fromEntries(parameters);
  const followsSupply = idealOpamp && {
    VDD: limitFollowsSupply(opampParameters, OPAMP_HIGH_LIMIT),
    VSS: limitFollowsSupply(opampParameters, OPAMP_LOW_LIMIT),
  };
  // Whether a selected VDD, or the one positive supply the author drew,
  // powers the block (ideal-opamp.ts). The default VDD the netlist adds for
  // other parts of a Cell that drew none does not.
  let powered = false;
  // The ideal comparator's call lowers only the ports its body reads.
  const nodes = (
    idealComparator
      ? idealComparatorBodyPorts(target, definition.ports)
      : definition.ports
  ).flatMap((port) => {
    if (port.supply) {
      // A property-only terminal is an explicit electrical binding even
      // though the Symbol exposes no canvas pin. Its identity wins over any
      // spelling or inferred power domain, including alternate supply rails.
      const explicit = context.netByTerminal.get(
        `${instance.id}\u0000${port.supply}`,
      );
      const explicitName = explicit
        ? context.nameByNetId.get(explicit.id)
        : undefined;
      if (explicitName) {
        if (port.supply === "VDD") powered = true;
        return [{ pinName: port.name, netName: explicitName }];
      }
      if (explicit) {
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_BLOCK_SUPPLY",
          `Analog Block ${reference} binds ${port.supply} to a Net that cannot be exported; select another Net in Properties`,
          [instance.id],
        );
        return [{ pinName: port.name, netName: `<unconnected:${port.name}>` }];
      }
      // Auto is safe only when the Cell has one unambiguous drawn supply of
      // this domain. A similarly named signal is not a supply declaration.
      const drawn = drawnSupplyNet(
        document,
        port.supply === "VDD" ? "vdd" : "ground",
      );
      const drawnName = drawn ? context.nameByNetId.get(drawn.id) : undefined;
      if (drawnName) {
        if (
          port.supply === "VDD" &&
          drawn!.id !== implicitSupplyNetId(document.id, "VDD")
        )
          powered = true;
        return [{ pinName: port.name, netName: drawnName }];
      }
      // An ideal op-amp in a figure without supplies, such as a textbook
      // switched-capacitor integrator: the port is in the call but unused.
      // Where the Cell drew several, a limit following that supply cannot
      // read one until the author chooses: the op-amp says what it reads.
      if (supplyFree) {
        if (
          followsSupply &&
          (port.supply === "VDD"
            ? followsSupply.VDD || followsSupply.VSS
            : powered && followsSupply.VSS) &&
          drawsSupply(document, port.supply === "VDD" ? "vdd" : "ground")
        )
          diagnostic(
            diagnostics,
            document.id,
            "IDEAL_OPAMP_SUPPLY_AMBIGUOUS",
            port.supply === "VDD"
              ? `Ideal op-amp ${reference}'s ${[
                  followsSupply.VDD &&
                    `high limit reads +${UNPOWERED_OPAMP_LIMITS[OPAMP_HIGH_LIMIT]} V`,
                  followsSupply.VSS &&
                    `low limit reads ${UNPOWERED_OPAMP_LIMITS[OPAMP_LOW_LIMIT].replace("-", "−")} V`,
                ]
                  .filter(Boolean)
                  .join(
                    " and ",
                  )}: several drawn supplies could be its VDD. Select its VDD in Properties to limit it at its supplies`
              : `Ideal op-amp ${reference}'s low limit reads ground: several drawn Nets could be its VSS. Select its VSS in Properties`,
            [instance.id],
            "warning",
          );
        return [{ pinName: port.name, netName: "0" }];
      }
      diagnostic(
        diagnostics,
        document.id,
        "MISSING_BLOCK_SUPPLY",
        `Analog Block ${reference} has no unambiguous ${port.supply} Net; select one in Properties or draw a unique ${port.supply === "VDD" ? "positive supply" : "ground"}`,
        [instance.id],
      );
      return [{ pinName: port.name, netName: `<unconnected:${port.name}>` }];
    }
    const netName = terminalNetName(
      document,
      instance,
      port.pinName,
      context,
      diagnostics,
    );
    return [
      { pinName: port.name, netName: netName ?? `<unconnected:${port.name}>` },
    ];
  });
  const opampBody = idealOpamp
    ? idealOpampBody(
        document,
        instance,
        reference,
        parameters,
        powered,
        diagnostics,
      )
    : undefined;
  return {
    id: instance.id,
    reference,
    invocationKind: "subcircuit",
    deviceClass: "hierarchical",
    target: opampBody ?? target,
    nodes,
    // A comparator's call keeps the authored order. Its body that reads VDD
    // takes no vhigh, so that call carries none. An op-amp's limit set to its
    // supply is the body's choice, never a parameter: whichever body is
    // called, even a Project's own, reads no `vhigh=VDD`.
    parameters: (idealComparator
      ? parameters.filter(
          ([name]) =>
            target !== IDEAL_COMPARATOR_SUPPLY_TARGET ||
            name.toLowerCase() !== HIGH_LEVEL_PARAMETER,
        )
      : parameters
          .filter(
            ([name, rawValue]) =>
              definition.target !== OPAMP_TARGET ||
              !isSupplyLimitParameter(name, rawValue),
          )
          .sort(([a], [b]) => compareText(a, b))
    ).map(([name, rawValue]) => ({ name, rawValue })),
  };
}

/**
 * The body an ideal op-amp calls (ideal-opamp.ts), with its limits checked:
 * each is a number or its supply, and two numeric levels, typed or read for
 * want of a supply, leave the output room between them.
 */
function idealOpampBody(
  document: SchematicDocument,
  instance: Instance,
  reference: string,
  parameters: readonly (readonly [string, string])[],
  powered: boolean,
  diagnostics: NetlistDiagnostic[],
) {
  const body = idealOpampBodyFor(Object.fromEntries(parameters), powered);
  const reads = idealOpampBodyReads(body);
  const levels: number[] = [];
  for (const limit of [OPAMP_HIGH_LIMIT, OPAMP_LOW_LIMIT] as const) {
    if (reads[limit === OPAMP_HIGH_LIMIT ? "vdd" : "vss"]) continue;
    const entry = parameters.find(([name]) => name.toLowerCase() === limit);
    if (!entry || isSupplyLimit(limit, entry[1])) {
      levels.push(Number(UNPOWERED_OPAMP_LIMITS[limit]));
      continue;
    }
    const parsed = parseSpiceNumber(entry[1].trim());
    if (parsed && Number.isFinite(parsed.value)) {
      levels.push(parsed.value);
      continue;
    }
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_IDEAL_OPAMP_LIMIT",
      `Ideal op-amp ${reference} requires ${entry[0]} to be a number or ${OPAMP_LIMIT_SUPPLIES[limit]}`,
      [instance.id],
      "error",
      entry[0],
    );
  }
  if (levels.length === 2 && !(levels[0]! > levels[1]!))
    diagnostic(
      diagnostics,
      document.id,
      "INVALID_IDEAL_OPAMP_LIMIT",
      `Ideal op-amp ${reference}'s output high limit, ${levels[0]} V, must be above its low limit, ${levels[1]} V`,
      [instance.id],
      "error",
      parameters.find(([name]) => name.toLowerCase() === OPAMP_HIGH_LIMIT)?.[0],
    );
  return body;
}
