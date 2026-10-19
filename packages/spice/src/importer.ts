import {
  CURRENT_MODEL_SCHEMA_VERSION,
  CircuitProjectSchema,
  deriveStableId,
} from "@icm/model";
import {
  deviceDescriptor,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingForTerminalCount,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import {
  externalSubcircuitSymbolId,
  isPdkMappableSymbolId,
  isRazaviProductSymbolId,
  resolvePdkSymbolMapping,
} from "@icm/symbols";
import type { PdkSymbolMappingOverride } from "@icm/symbols";
import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  Instance,
  InstanceNetlistBinding,
  NetlistDeviceClass,
  Net,
  SchematicDocument,
} from "@icm/model";

import type { SpiceCompileResult } from "./compiler.js";
import type { SpiceCompileOptions } from "./dialect.js";
import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import type { CircuitCellIR, CircuitIR, CircuitInstanceIR } from "./ir.js";
import type { SourceBundle, SpiceSourceInput } from "./source-types.js";
import { compileSpiceSources } from "./compiler.js";
import { decodeSourceContent, normalizeSourcePath } from "./source.js";
import { parseNgspiceSourceParameters } from "./source-parameters.js";

export interface SpiceImportResult extends SpiceCompileResult {
  project: CircuitProject | null;
}

/**
 * A body Analog Canvas writes itself that the sources define, such as an
 * op-amp's subcircuit or the ideal switch's model card: each card naming it
 * imports as the part that wrote it, and a subcircuit body as no Cell. The
 * netlist package tells such a body from an author's own of the same name
 * (`findBuiltInBodies`); the importer only reads what it found.
 */
export interface SpiceBuiltInBody {
  /** The verified declaration in the prepared source, not just its name. */
  readonly source: { readonly path: string; readonly line: number };
  /** The body's name, as the sources spell it. */
  readonly name: string;
  /**
   * What the name is: a subcircuit, which `X` calls name, or a model card,
   * which device cards such as `S` name.
   */
  readonly kind: "subcircuit" | "model";
  /** The part's Symbol. */
  readonly symbolId: string;
  /** The subcircuit the part is bound to, as a placed one is; a part that takes no binding, such as a switch, has none. */
  readonly target?: string;
  /**
   * The letters the part's reference starts with, where they are not X: a
   * card that writes an X before them, as SPICE writes a call and the
   * conversion from Spectre names one, keeps the reference without it.
   */
  readonly referencePrefix?: string;
  /** Parameters the body's name stands for, such as an adder's signs. */
  readonly parameters?: Readonly<Record<string, string>>;
  /**
   * The body's ports in the order it lists them: a Symbol pin; a supply the
   * part takes as a property; the Cell's ground, which a switch reads its
   * control against; or the clock its label names, as a chopper's. A supply
   * the body does not read is left unbound where a card passes ground,
   * which is what an unbound one exports as; bound, it could export as
   * another card.
   */
  readonly ports: readonly (
    | { readonly pinName: string }
    | { readonly supply: "VDD" | "VSS"; readonly unboundAtGround: boolean }
    | { readonly ground: true }
    | { readonly phase: true }
  )[];
}

export interface SpiceImportOptions {
  /** Input before frontend conversion; never used as mutable connectivity. */
  originalSources?: readonly SpiceSourceInput[];
  symbolMappings?: readonly PdkSymbolMappingOverride[];
  namingProfile?: "native" | "cadence-bang";
  /** Bodies Analog Canvas writes itself among the sources' subcircuits. */
  builtInBodies?: readonly SpiceBuiltInBody[];
}

/** The key a built-in body is found by: its kind and its name, any case. */
const builtInBodyKey = (kind: SpiceBuiltInBody["kind"], name: string) =>
  `${kind}:${name.toLowerCase()}`;

/** The built-in body a card names, if the sources define one. */
function calledBuiltInBody(
  instance: CircuitInstanceIR,
  bodies: ReadonlyMap<string, SpiceBuiltInBody>,
): SpiceBuiltInBody | undefined {
  if (instance.target.kind === "subcircuit")
    return bodies.get(builtInBodyKey("subcircuit", instance.target.cellName));
  if (instance.target.kind === "model")
    return bodies.get(builtInBodyKey("model", instance.target.modelName));
  return undefined;
}

/**
 * The pin a card's node meets on the part a built-in body imports as: a
 * Symbol pin, a supply, or null where the part takes the node otherwise (a
 * supply left unbound, the ground a switch reads, the clock its label names).
 */
function builtInBodyPin(
  body: SpiceBuiltInBody,
  position: number,
  atGround: boolean,
): string | null {
  const port = body.ports[position];
  if (!port) return null;
  if ("pinName" in port) return port.pinName;
  if ("supply" in port)
    return atGround && port.unboundAtGround ? null : port.supply;
  return null;
}

/** The part's reference: the card's name, without an X SPICE put before it. */
function builtInReference(name: string, prefix: string | undefined): string {
  return prefix &&
    /^x/iu.test(name) &&
    name.slice(1).toUpperCase().startsWith(prefix.toUpperCase())
    ? name.slice(1)
    : name;
}

/** A card naming a built-in body, as the part that wrote it. */
function importBuiltInBlock(
  instance: CircuitInstanceIR,
  body: SpiceBuiltInBody,
  diagnostics: SpiceDiagnostic[],
): Instance | null {
  if (instance.terminals.length !== body.ports.length) {
    diagnostics.push(
      diagnostic(
        "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
        "error",
        "import",
        `${instance.name} calls ${body.name} with ${instance.terminals.length} nodes for its ${body.ports.length} ports`,
        instance.sourceRef,
      ),
    );
    return null;
  }
  return {
    id: instance.id,
    symbolId: body.symbolId,
    sourceRef: instance.sourceRef,
    importProvenance: {
      kind: "opaque",
      sourceMasterName: body.name,
      sourceTarget: `${body.kind}:${body.name}`,
      status: "resolved",
      terminalMapping: instance.terminals.flatMap((terminal) => {
        const port = body.ports[terminal.position];
        return port && "pinName" in port
          ? [{ sourcePosition: terminal.position, pinName: port.pinName }]
          : [];
      }),
    },
    placement: null,
    reference: builtInReference(instance.name, body.referencePrefix),
    netlist: {
      ...(body.target
        ? {
            binding: {
              kind: "unresolved-subcircuit" as const,
              name: body.target,
            },
          }
        : {}),
      parameters: {
        ...Object.fromEntries(
          Object.entries(instance.parameters).map(([name, parameter]) => [
            name,
            parameter.rawText,
          ]),
        ),
        ...body.parameters,
      },
    },
  };
}

function importedNetName(
  name: string,
  scope: "local" | "global",
  namingProfile: NonNullable<SpiceImportOptions["namingProfile"]>,
): { name: string; scope: "local" | "global"; sourceName: string } {
  if (
    namingProfile === "cadence-bang" &&
    name.length > 1 &&
    name.endsWith("!")
  ) {
    return { name: name.slice(0, -1), scope: "global", sourceName: name };
  }
  return { name, scope, sourceName: name };
}

interface ImportSymbolMapping {
  symbolId: string;
  pinNames?: readonly string[];
  registryId?: string;
  /** A reviewed subcircuit an M card names, imported as the X call it is. */
  reviewedMaster?: string;
}

function explicitSymbolOverride(
  modelName: string,
  terminalCount: number,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): ImportSymbolMapping | undefined {
  const override = symbolMappings.find(
    (candidate) =>
      candidate.modelName.toLowerCase() === modelName.toLowerCase() &&
      candidate.terminalCount === terminalCount &&
      candidate.pinNames.length === terminalCount &&
      isPdkMappableSymbolId(candidate.symbolId),
  );
  return override
    ? {
        symbolId: override.symbolId,
        ...(override.pinNames ? { pinNames: override.pinNames } : {}),
        ...(override.registryId ? { registryId: override.registryId } : {}),
      }
    : undefined;
}

function externalDefinitionId(masterName: string): string {
  return deriveStableId("external-subcircuit", masterName.toLowerCase());
}

function netlistDeviceClass(symbolId: string): NetlistDeviceClass | null {
  const classes: Readonly<Record<string, NetlistDeviceClass>> = {
    resistor: "resistor",
    capacitor: "capacitor",
    inductor: "inductor",
    "inductor-compact": "inductor",
    nmos: "mos",
    pmos: "mos",
    diode: "diode",
    "zener-diode": "diode",
    npn: "bjt",
    pnp: "bjt",
    "voltage-source": "voltage-source",
    "current-source": "current-source",
    "voltage-controlled-switch": "switch",
    ground: "net-marker",
    vdd: "net-marker",
  };
  return classes[symbolId] ?? null;
}

function importedNetlistBinding(
  instance: CircuitInstanceIR,
  mapping: ImportSymbolMapping,
): InstanceNetlistBinding | undefined {
  if (instance.target.kind === "subcircuit") {
    return {
      kind: "unresolved-subcircuit",
      name: instance.target.cellName,
    };
  }
  if (instance.target.kind === "external-subcircuit") {
    return {
      kind: "external-subcircuit",
      definitionId: externalDefinitionId(instance.target.masterName),
    };
  }
  if (mapping.reviewedMaster) {
    return {
      kind: "external-subcircuit",
      definitionId: externalDefinitionId(mapping.reviewedMaster),
    };
  }
  const deviceClass = netlistDeviceClass(mapping.symbolId);
  if (!deviceClass) return undefined;
  switch (instance.target.kind) {
    case "primitive":
      return { kind: "primitive", deviceClass };
    case "model":
      return { kind: "model", deviceClass, name: instance.target.modelName };
    case "opaque":
      return { kind: "model", deviceClass, name: instance.target.sourceName };
  }
}

function symbolFor(
  instance: CircuitInstanceIR,
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): ImportSymbolMapping | null {
  if (instance.target.kind === "subcircuit") {
    return {
      symbolId: deriveStableId(
        "hierarchical-symbol",
        instance.target.cellName.toLowerCase(),
      ),
    };
  }
  if (instance.target.kind === "external-subcircuit") {
    const mapping = resolvePdkSymbolMapping(
      instance.target.masterName,
      instance.terminals.length,
      symbolMappings,
    );
    return {
      symbolId:
        mapping?.symbolId ??
        externalSubcircuitSymbolId(
          externalDefinitionId(instance.target.masterName),
        ),
      ...(mapping?.pinNames ? { pinNames: mapping.pinNames } : {}),
      ...(mapping?.registryId ? { registryId: mapping.registryId } : {}),
    };
  }
  if (instance.target.kind === "model") {
    const pdkMapping = explicitSymbolOverride(
      instance.target.modelName,
      instance.terminals.length,
      symbolMappings,
    );
    if (pdkMapping) {
      return {
        symbolId: pdkMapping.symbolId,
        ...(pdkMapping.pinNames ? { pinNames: pdkMapping.pinNames } : {}),
        ...(pdkMapping.registryId ? { registryId: pdkMapping.registryId } : {}),
      };
    }
    // An S card naming a model of the author's own: a switch the voltage
    // across its two control nodes closes. Analog Canvas's own ideal switch
    // is a built-in body, read before this.
    if (/^s/iu.test(instance.name) && instance.terminals.length === 4)
      return {
        symbolId: "voltage-controlled-switch",
        pinNames: ["P", "N", "CP", "CN"],
      };
    const modelType = modelTypeByName.get(
      instance.target.modelName.toLowerCase(),
    );
    if (instance.terminals.length === 2 && modelType === "d")
      return { symbolId: "diode", pinNames: ["A", "K"] };
    if (instance.terminals.length === 3 && modelType === "npn")
      return { symbolId: "npn", pinNames: ["C", "B", "E"] };
    if (instance.terminals.length === 3 && modelType === "pnp")
      return { symbolId: "pnp", pinNames: ["C", "B", "E"] };
    if (instance.terminals.length === 4 && modelType === "nmos")
      return { symbolId: "nmos", pinNames: ["D", "G", "S", "B"] };
    if (instance.terminals.length === 4 && modelType === "pmos")
      return { symbolId: "pmos", pinNames: ["D", "G", "S", "B"] };
    // A reviewed SKY130 MOS written as a plain M card, as this product once
    // exported a MOS bound to the model by name, has no .model card. The
    // reviewed table says which transistor it is, and that it is a
    // subcircuit: it imports as the X call the SKY130 simulation profile
    // runs, not as a model card of that name (#1249). Its W and L are
    // already in metres.
    const reviewed =
      modelType === undefined && instance.terminals.length === 4
        ? reviewedExternalBindingForMaster(instance.target.modelName)
        : undefined;
    if (
      reviewed &&
      (["nmos", "pmos", "ndmos", "pdmos"] as const).some(
        (symbolId) => symbolId === reviewed.symbolId,
      )
    )
      return {
        symbolId: reviewed.symbolId,
        pinNames: ["D", "G", "S", "B"],
        registryId: reviewed.id,
        reviewedMaster: reviewed.masterName,
      };
    return null;
  }
  if (instance.target.kind === "opaque") {
    const pdkMapping = explicitSymbolOverride(
      instance.target.sourceName,
      instance.terminals.length,
      symbolMappings,
    );
    return pdkMapping
      ? {
          symbolId: pdkMapping.symbolId,
          ...(pdkMapping.pinNames ? { pinNames: pdkMapping.pinNames } : {}),
          ...(pdkMapping.registryId
            ? { registryId: pdkMapping.registryId }
            : {}),
        }
      : null;
  }
  if (instance.target.kind !== "primitive") return null;
  const symbols: Record<string, ImportSymbolMapping> = {
    resistor: { symbolId: "resistor" },
    capacitor: { symbolId: "capacitor" },
    // Imported L elements take the scale-reconciled Inductor so an imported
    // schematic reads at the same scale as its R and C.
    inductor: { symbolId: "inductor-compact" },
    nmos: { symbolId: "nmos" },
    pmos: { symbolId: "pmos" },
    "voltage-source": { symbolId: "voltage-source" },
    "current-source": { symbolId: "current-source" },
    vcvs: { symbolId: "vcvs", pinNames: ["+", "-", "CTRL+", "CTRL-"] },
    vccs: { symbolId: "vccs", pinNames: ["+", "-", "CTRL+", "CTRL-"] },
    cccs: { symbolId: "cccs", pinNames: ["+", "-"] },
    ccvs: { symbolId: "ccvs", pinNames: ["+", "-"] },
  };
  const mapping = symbols[instance.target.family];
  return mapping && isRazaviProductSymbolId(mapping.symbolId) ? mapping : null;
}

function targetDescription(
  instance: CircuitInstanceIR,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): string {
  switch (instance.target.kind) {
    case "primitive":
      return `primitive:${instance.target.family}`;
    case "model":
      return `model:${instance.target.modelName}`;
    case "subcircuit":
      return `subcircuit:${instance.target.cellName}`;
    case "external-subcircuit":
      return `external-subcircuit:${instance.target.masterName}`;
    case "opaque":
      return explicitSymbolOverride(
        instance.target.sourceName,
        instance.terminals.length,
        symbolMappings,
      )
        ? `model:${instance.target.sourceName}`
        : `opaque:${instance.target.sourceName}`;
  }
}

function importProvenance(
  instance: CircuitInstanceIR,
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): NonNullable<Instance["importProvenance"]> {
  switch (instance.target.kind) {
    case "primitive":
      return {
        kind: "primitive",
        sourceMasterName: instance.target.family,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
      };
    case "model": {
      const modelType = modelTypeByName.get(
        instance.target.modelName.toLowerCase(),
      );
      return {
        kind: "model",
        sourceMasterName: instance.target.modelName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
        ...(modelType ? { modelType } : {}),
      };
    }
    case "subcircuit":
      // The second importer pass resolves the stable child document id. Until
      // then the evidence records the target name without deriving it from a
      // mutable compatibility property.
      return {
        kind: "subcircuit",
        sourceMasterName: instance.target.cellName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "missing",
      };
    case "external-subcircuit":
      return {
        kind: "opaque",
        sourceMasterName: instance.target.masterName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "missing",
      };
    case "opaque":
      return {
        kind: "opaque",
        sourceMasterName: instance.target.sourceName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
      };
  }
}

/**
 * A device card naming a model no .model card declares cannot say what it
 * is. The symbol catalog is not what is missing, so say what is.
 */
function undeclaredModelMessage(
  instance: CircuitInstanceIR,
  modelTypeByName: ReadonlyMap<string, string>,
): string | undefined {
  if (instance.target.kind !== "model") return undefined;
  const model = instance.target.modelName;
  if (modelTypeByName.has(model.toLowerCase())) return undefined;
  const types =
    { 2: ["d"], 3: ["npn", "pnp"], 4: ["nmos", "pmos"] }[
      instance.terminals.length
    ] ?? [];
  if (!types.length) return undefined;
  return `${instance.name} uses model ${model}, which no .model card declares, so its device type is unknown. Add ${types.map((type) => `".model ${model} ${type}"`).join(" or ")}.`;
}

/**
 * An independent source's card tail comes in as one value (`0.9 AC 1 0
 * PULSE(0.9 0.91 1u 1n 1n 1u 3u)`, kept whole in `dc` after a DC keyword, or in
 * `value` without one). A Canvas source keeps it apart: the DC value, the AC
 * magnitude and phase, and the transient function with its arguments, and its
 * value label shows the DC value, not the card. A tail that is only a DC
 * value, or that does not fit those fields (an EXP function, a PULSE with
 * defaulted arguments, a parameter reference), stays as written.
 */
function structureSourceTail(parameters: Record<string, string>): void {
  const key = ["dc", "value"].find((name) => parameters[name] !== undefined);
  if (key === undefined) return;
  const parsed = parseNgspiceSourceParameters(parameters[key]!, {
    requireDc: false,
  });
  if (!parsed.ok) return;
  const fields = Object.keys(parsed.parameters).filter(
    (name) => name !== "dc" && name !== "waveform",
  );
  if (!fields.length && parsed.parameters.waveform === "dc") return;
  delete parameters[key];
  // A DC-only waveform is the plain source: it names no waveform.
  const { waveform, ...rest } = parsed.parameters;
  Object.assign(parameters, rest, waveform === "dc" ? {} : { waveform });
}
function importInstance(
  instance: CircuitInstanceIR,
  diagnostics: SpiceDiagnostic[],
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
  builtInBodies: ReadonlyMap<string, SpiceBuiltInBody>,
): Instance | null {
  const body = calledBuiltInBody(instance, builtInBodies);
  if (body) return importBuiltInBlock(instance, body, diagnostics);
  const mapping = symbolFor(instance, modelTypeByName, symbolMappings);
  if (!mapping) {
    diagnostics.push(
      diagnostic(
        "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
        "error",
        "import",
        undeclaredModelMessage(instance, modelTypeByName) ??
          `Unsupported SPICE device ${instance.name} (${targetDescription(instance, symbolMappings)}): the approved Razavi catalog has no symbol. Add and review a Razavi symbol mapping before importing.`,
        instance.sourceRef,
      ),
    );
    return null;
  }
  const netlistBinding = importedNetlistBinding(instance, mapping);
  const reviewed =
    instance.target.kind === "external-subcircuit"
      ? reviewedExternalBindingForTerminalCount(
          instance.target.masterName,
          instance.terminals.length,
        )
      : undefined;
  const parameters = Object.fromEntries(
    Object.entries(instance.parameters)
      .filter(([name]) => name !== "control-source")
      // A 20 V device's channel is the device's own; export writes it (#1486).
      .filter(
        ([name]) =>
          !reviewed?.fixedParameters?.some(
            (fixed) => fixed.name.toLowerCase() === name.toLowerCase(),
          ),
      )
      .map(([name, parameter]) => {
        const parameterName =
          name === "gain" && mapping.symbolId === "vccs"
            ? "gm"
            : name === "gain" && mapping.symbolId === "ccvs"
              ? "rm"
              : name;
        const reviewedParameter = reviewed?.parameters.find(
          (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
        );
        if (reviewedParameter?.targetUnit !== "micrometre") {
          return [parameterName, parameter.rawText];
        }
        try {
          return [
            parameterName,
            sky130MicrometresToProjectLength(parameter.rawText),
          ];
        } catch (error) {
          diagnostics.push(
            diagnostic(
              "SPICE_IMPORT_INVALID_REVIEWED_GEOMETRY",
              "error",
              "import",
              error instanceof Error ? error.message : String(error),
              instance.sourceRef,
            ),
          );
          return [parameterName, parameter.rawText];
        }
      }),
  );
  if (
    mapping.symbolId === "voltage-source" ||
    mapping.symbolId === "current-source"
  )
    structureSourceTail(parameters);
  return {
    id: instance.id,
    symbolId: mapping.symbolId,
    sourceRef: instance.sourceRef,
    importProvenance: {
      ...importProvenance(instance, modelTypeByName, symbolMappings),
      ...(mapping.registryId
        ? { symbolMappingRegistryId: mapping.registryId }
        : {}),
      terminalMapping: instance.terminals
        .filter(
          (terminal) =>
            !["vcvs", "vccs", "cccs", "ccvs"].includes(mapping.symbolId) ||
            terminal.position < 2,
        )
        .map((terminal) => ({
          sourcePosition: terminal.position,
          pinName:
            mapping.pinNames?.[terminal.position] ??
            terminal.name ??
            `P${terminal.position + 1}`,
        })),
    },
    placement: null,
    reference: instance.name,
    netlist: {
      ...(netlistBinding ? { binding: netlistBinding } : {}),
      parameters,
    },
  };
}

/**
 * A schematic never holds a device its sheet does not draw, so an import lands
 * every Instance on the canvas instead of staging invisible content behind a
 * later placement step. The shelf is deliberately a legible starting grid, not
 * an analog auto-layout: devices fill a square block in source order, and each
 * Cell Pin waits on its side of it, facing the circuit. Pins on one line
 * facing one way made every wire between them read as a short.
 */
const DOCUMENT_GRID = 10;
const SHELF_MARGIN = 80;
const SHELF_PITCH_X = 180;
const SHELF_PITCH_Y = 140;
const SHELF_MAX_COLUMNS = 8;

type CellPinSide = "top" | "bottom" | "left" | "right";

const SUPPLY_NAME = /^(?:[ad]?vdd|vcc|vpwr|vpos|vplus|pwr)/iu;
const GROUND_NAME = /^(?:[ad]?vss|[ad]?gnd|vee|vgnd|vneg|ground)|^0$/iu;
const OUTPUT_NAME = /^(?:v?o(?:ut)?[pn+-]?|q|qb|qn|y|z)$|^v?out/iu;

/** Supplies above, grounds below, outputs right and everything else left. A
 * name says it first; otherwise a Net only drains and collectors drive is an
 * output. */
function cellPinSide(
  name: string,
  netId: string,
  nets: readonly Net[],
  instances: readonly Instance[],
): CellPinSide {
  if (SUPPLY_NAME.test(name)) return "top";
  if (GROUND_NAME.test(name)) return "bottom";
  if (OUTPUT_NAME.test(name)) return "right";
  let drives = 0;
  let senses = 0;
  for (const terminal of nets.find((net) => net.id === netId)?.terminals ??
    []) {
    const instance = instances.find(
      (candidate) => candidate.id === terminal.instanceId,
    );
    if (!instance) continue;
    const deviceClass = deviceDescriptor(instance.symbolId)?.deviceClass;
    const pin = terminal.pinName.toUpperCase();
    if (
      (deviceClass === "mos" && pin === "D") ||
      (deviceClass === "bjt" && pin === "C") ||
      pin === "OUT"
    )
      drives += 1;
    else if (
      (deviceClass === "mos" && pin === "G") ||
      (deviceClass === "bjt" && pin === "B") ||
      pin === "IN+" ||
      pin === "IN-"
    )
      senses += 1;
  }
  return drives > 0 && senses === 0 ? "right" : "left";
}

function withShelfPlacements(
  instances: readonly Instance[],
  grid: number,
  sides: ReadonlyMap<string, CellPinSide>,
): Instance[] {
  const margin = snapUpToGrid(SHELF_MARGIN, grid);
  const pitchX = snapUpToGrid(SHELF_PITCH_X, grid);
  const pitchY = snapUpToGrid(SHELF_PITCH_Y, grid);
  const pinPitch = snapUpToGrid(SHELF_PITCH_Y / 2, grid);
  const ports = instances.filter((instance) => instance.symbolId === "port");
  const sideOf = (instance: Instance) => sides.get(instance.id) ?? "left";
  const has = (side: CellPinSide) =>
    ports.some((port) => sideOf(port) === side);
  const deviceCount = instances.length - ports.length;
  const columns = Math.min(
    SHELF_MAX_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(deviceCount))),
  );
  const rows = Math.max(1, Math.ceil(deviceCount / columns));
  const left = has("left") ? margin + pitchX : margin;
  const top = has("top") ? margin + pitchY : margin;
  const right = left + (columns - 1) * pitchX;
  const bottom = top + (rows - 1) * pitchY;
  // Rotation turns the Cell Pin's lead, drawn facing east, toward the devices.
  const faces = { top: 90, bottom: 270, left: 0, right: 180 } as const;
  const next = { top: 0, bottom: 0, left: 0, right: 0 };
  let deviceIndex = 0;
  return instances.map((instance) => {
    if (instance.placement !== null) return instance;
    let position;
    let rotation: 0 | 90 | 180 | 270 = 0;
    if (instance.symbolId === "port") {
      const side = sideOf(instance);
      const index = next[side]++;
      rotation = faces[side];
      position =
        side === "top"
          ? { x: left + index * pitchX, y: margin }
          : side === "bottom"
            ? { x: left + index * pitchX, y: bottom + pitchY }
            : {
                x: side === "left" ? margin : right + pitchX,
                y: top + index * pinPitch,
              };
    } else {
      position = {
        x: left + (deviceIndex % columns) * pitchX,
        y: top + Math.floor(deviceIndex / columns) * pitchY,
      };
      deviceIndex += 1;
    }
    return {
      ...instance,
      placement: { position, rotation, mirror: "none" as const },
    };
  });
}

function snapUpToGrid(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}

/** A common imported fourth node becomes the Cell's default for later MOSes. */
function importedMosBulkDefaults(
  instances: readonly Instance[],
  nets: readonly Net[],
): SchematicDocument["mosBulkDefaults"] {
  const defaults: NonNullable<SchematicDocument["mosBulkDefaults"]> = {};
  for (const kind of ["nmos", "pmos"] as const) {
    const mosInstances = instances.filter(
      (instance) => deviceDescriptor(instance.symbolId)?.mosBulkClass === kind,
    );
    if (mosInstances.length === 0) continue;
    const bulkNetIds = mosInstances.map((instance) =>
      nets
        .filter((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id && terminal.pinName === "B",
          ),
        )
        .map((net) => net.id),
    );
    const netId = bulkNetIds[0]?.[0];
    if (
      netId &&
      bulkNetIds.every((ids) => ids.length === 1 && ids[0] === netId)
    ) {
      defaults[kind === "nmos" ? "nmosNetId" : "pmosNetId"] = netId;
    }
  }
  return defaults.nmosNetId || defaults.pmosNetId ? defaults : undefined;
}

function isMutualInductor(instance: CircuitInstanceIR): boolean {
  return (
    instance.target.kind === "primitive" &&
    instance.target.family === "mutual-inductor"
  );
}

/**
 * Each `K` card of the Cell as a coupling of the two inductors it names, by
 * the card's own name and coupling text. SPICE dots an inductor at its first
 * node, so each member is dotted at the pin that node landed on. A card that
 * cannot be one coupling of two of the Cell's inductors is left out with a
 * warning saying why, as a part without a Symbol is.
 */
function importedInductorCouplings(
  cell: CircuitCellIR,
  documentId: string,
  importedInstanceById: ReadonlyMap<string, Instance>,
  diagnostics: SpiceDiagnostic[],
): NonNullable<SchematicDocument["inductorCouplings"]> {
  const couplings: NonNullable<SchematicDocument["inductorCouplings"]> = [];
  for (const card of cell.instances.filter(isMutualInductor)) {
    const skip = (reason: string) => {
      diagnostics.push(
        diagnostic(
          "SPICE_IMPORT_COUPLING_SKIPPED",
          "warning",
          "import",
          `${card.name} is not imported: ${reason}`,
          card.sourceRef,
        ),
      );
    };
    const names = (card.parameters.inductors?.rawText ?? "")
      .split(/\s+/u)
      .filter(Boolean);
    const k = card.parameters.coupling?.rawText.trim();
    if (names.length !== 2) {
      skip(
        `it couples ${names.length} inductors, and a coupling joins exactly two`,
      );
      continue;
    }
    if (!k) {
      skip("it has no coupling value");
      continue;
    }
    const members = names.map((name) => {
      const source = cell.instances.find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
      );
      const imported = source && importedInstanceById.get(source.id);
      const dotPin = imported?.importProvenance?.terminalMapping?.find(
        (terminal) => terminal.sourcePosition === 0,
      )?.pinName;
      return source?.target.kind === "primitive" &&
        source.target.family === "inductor" &&
        imported &&
        dotPin
        ? { name, member: { instanceId: imported.id, dotPin } }
        : { name, member: null };
    });
    const missing = members.find((entry) => !entry.member);
    if (missing) {
      skip(`${missing.name} is not an inductor of ${cell.name}`);
      continue;
    }
    const [first, second] = members.map((entry) => entry.member!) as [
      { instanceId: string; dotPin: string },
      { instanceId: string; dotPin: string },
    ];
    if (first.instanceId === second.instanceId) {
      skip(`it couples ${names[0]} with itself`);
      continue;
    }
    const pair = couplings.find((coupling) =>
      coupling.members.every(
        (member) =>
          member.instanceId === first.instanceId ||
          member.instanceId === second.instanceId,
      ),
    );
    if (pair) {
      skip(`${pair.name} already couples ${names[0]} and ${names[1]}`);
      continue;
    }
    const named = couplings.find(
      (coupling) => coupling.name.toLowerCase() === card.name.toLowerCase(),
    );
    if (named || card.name.length > 64 || k.length > 256) {
      skip(
        named
          ? `another coupling is already named ${named.name}`
          : "its name or coupling value is too long",
      );
      continue;
    }
    couplings.push({
      id: deriveStableId("inductor-coupling", documentId, card.id),
      name: card.name,
      members: [first, second],
      k,
    });
  }
  return couplings;
}

function importDocument(
  cell: CircuitCellIR,
  diagnostics: SpiceDiagnostic[],
  modelTypeByName: ReadonlyMap<string, string>,
  options: SpiceImportOptions,
  builtInBodies: ReadonlyMap<string, SpiceBuiltInBody>,
): SchematicDocument {
  const symbolMappings = options.symbolMappings ?? [];
  const namingProfile = options.namingProfile ?? "native";
  const documentId = deriveStableId("document", cell.name.toLowerCase());
  const visibleInstances = cell.instances.filter((instance) => {
    if (instance.terminals.length > 0) return true;
    // A K card becomes a coupling of the inductors it names, below.
    if (isMutualInductor(instance)) return false;
    diagnostics.push(
      diagnostic(
        "SPICE_IMPORT_NON_VISUAL_INSTANCE",
        "warning",
        "import",
        `Structural instance ${instance.name} has no electrical terminals and remains in transient Circuit IR only`,
        instance.sourceRef,
      ),
    );
    return false;
  });
  const instances = visibleInstances
    .map((instance) =>
      importInstance(
        instance,
        diagnostics,
        modelTypeByName,
        symbolMappings,
        builtInBodies,
      ),
    )
    .filter((instance): instance is Instance => instance !== null);
  const importedInstanceById = new Map(
    instances.map((instance) => [instance.id, instance]),
  );
  // The two output pins are drawn terminals; E/G's control nodes and F/H's
  // probe are typed relations, not extra visible pins on the source glyph.
  for (const source of visibleInstances) {
    const imported = importedInstanceById.get(source.id);
    if (!imported?.netlist) continue;
    if (source.target.kind !== "primitive") continue;
    if (source.target.family === "vcvs" || source.target.family === "vccs") {
      const positiveNetId = source.terminals[2]?.netId;
      const negativeNetId = source.terminals[3]?.netId;
      imported.netlist.control = {
        kind: "voltage",
        ...(positiveNetId ? { positiveNetId } : {}),
        ...(negativeNetId ? { negativeNetId } : {}),
      };
    } else if (
      source.target.family === "cccs" ||
      source.target.family === "ccvs"
    ) {
      const probe = source.parameters["control-source"]?.rawText;
      const sensorInstanceId = visibleInstances.find(
        (candidate) => candidate.name.toLowerCase() === probe?.toLowerCase(),
      )?.id;
      imported.netlist.control = {
        kind: "current",
        ...(sensorInstanceId ? { sensorInstanceId } : {}),
      };
    }
  }
  const groundNetIds = new Set(
    cell.nets.filter((net) => net.name === "0").map((net) => net.id),
  );
  /** The pin a call's node meets, or null where it meets none. */
  const pinAt = (
    instance: CircuitInstanceIR,
    terminal: CircuitInstanceIR["terminals"][number],
  ): string | null => {
    const imported = importedInstanceById.get(instance.id);
    if (!imported) return null;
    const body = calledBuiltInBody(instance, builtInBodies);
    if (body)
      return builtInBodyPin(
        body,
        terminal.position,
        groundNetIds.has(terminal.netId),
      );
    if (
      ["vcvs", "vccs", "cccs", "ccvs"].includes(imported.symbolId) &&
      terminal.position >= 2
    )
      return null;
    return String(
      imported.importProvenance?.terminalMapping?.find(
        (candidate) => candidate.sourcePosition === terminal.position,
      )?.pinName ?? `P${terminal.position + 1}`,
    );
  };
  const controlNetIds = new Set(
    instances.flatMap((instance) =>
      instance.netlist?.control?.kind === "voltage"
        ? [
            instance.netlist.control.positiveNetId,
            instance.netlist.control.negativeNetId,
          ]
        : [],
    ),
  );
  const nets: Net[] = cell.nets
    .map((net) => ({
      id: net.id,
      terminals: visibleInstances.flatMap((instance) =>
        instance.terminals.flatMap((terminal) => {
          const pinName =
            terminal.netId === net.id ? pinAt(instance, terminal) : null;
          return pinName === null ? [] : [{ instanceId: instance.id, pinName }];
        }),
      ),
    }))
    // A ground that only supplies left unbound reached would still make
    // the Cell reach ground, and its export add a ground pin; it goes too.
    .filter(
      (net) =>
        net.terminals.length > 0 ||
        !groundNetIds.has(net.id) ||
        controlNetIds.has(net.id) ||
        cell.ports.some((port) => port.netId === net.id) ||
        !visibleInstances.some(
          (instance) =>
            calledBuiltInBody(instance, builtInBodies) &&
            instance.terminals.some((terminal) => terminal.netId === net.id),
        ),
    );
  const keptNetIds = new Set(nets.map((net) => net.id));
  // A switch reads its control against the Cell's ground, which a Cell
  // printed as a subcircuit takes as a pin (VSS): the node its card passes
  // there is claimed as ground, as a ground drawn on it would be, so the
  // switch reads the same node again.
  const blockGroundNetIds = new Set<string>();
  const phaseLabels: { instanceId: string; name: string }[] = [];
  for (const instance of visibleInstances) {
    const body = calledBuiltInBody(instance, builtInBodies);
    if (!body || !importedInstanceById.has(instance.id)) continue;
    for (const terminal of instance.terminals) {
      const port = body.ports[terminal.position];
      if (!port) continue;
      if ("ground" in port && !groundNetIds.has(terminal.netId))
        blockGroundNetIds.add(terminal.netId);
      // A part clocked by its label, as a chopper is, names the node.
      const net = cell.nets.find((item) => item.id === terminal.netId);
      if ("phase" in port && net)
        phaseLabels.push({
          instanceId: instance.id,
          name: importedNetName(net.name, net.scope, namingProfile).name,
        });
    }
  }
  const formalTerminals = cell.ports.map((port, index) => {
    const importedPortName = importedNetName(
      port.name,
      cell.nets.find((net) => net.id === port.netId)?.scope ?? "local",
      namingProfile,
    ).name;
    const interfaceInstanceId = deriveStableId(
      "cell-pin",
      documentId,
      String(index),
      importedPortName,
    );
    instances.push({
      id: interfaceInstanceId,
      symbolId: "port",
      placement: null,
    });
    const net = nets.find((candidate) => candidate.id === port.netId);
    net?.terminals.push({ instanceId: interfaceInstanceId, pinName: "P" });
    return {
      id: deriveStableId(
        "cell-terminal",
        documentId,
        String(index),
        importedPortName,
      ),
      name: importedPortName,
      netId: port.netId,
      direction: "passive" as const,
      interfaceInstanceIds: [interfaceInstanceId],
    };
  });
  const mosBulkDefaults = importedMosBulkDefaults(instances, nets);
  const inductorCouplings = importedInductorCouplings(
    cell,
    documentId,
    importedInstanceById,
    diagnostics,
  );
  const placed = withShelfPlacements(
    instances,
    DOCUMENT_GRID,
    new Map(
      formalTerminals.flatMap((terminal) => {
        const [pin] = terminal.interfaceInstanceIds;
        return pin
          ? [
              [
                pin,
                cellPinSide(terminal.name, terminal.netId, nets, instances),
              ] as const,
            ]
          : [];
      }),
    ),
  );
  const labelOffset = { x: 0, y: -4 * DOCUMENT_GRID };
  return {
    id: documentId,
    name: cell.name,
    revision: 0,
    sourceBinding: { cellName: cell.name, sourceRef: cell.sourceRef },
    sourceStatus: "in-sync",
    importReference: {
      files: [],
      // Every net kept is one of the Cell's.
      nets: nets.flatMap((net) => {
        const source = cell.nets.find((candidate) => candidate.id === net.id);
        if (!source) return [];
        const name = importedNetName(source.name, source.scope, namingProfile);
        return {
          id: source.id,
          name: name.name,
          scope: name.scope,
          terminals: net.terminals.map((terminal) => {
            const mapping = importedInstanceById
              .get(terminal.instanceId)
              ?.importProvenance?.terminalMapping?.find(
                (entry) => entry.pinName === terminal.pinName,
              );
            return mapping
              ? {
                  instanceId: terminal.instanceId,
                  sourcePosition: mapping.sourcePosition,
                }
              : { instanceId: terminal.instanceId, pinName: terminal.pinName };
          }),
        };
      }),
    },
    netlist: {
      name: cell.name,
      terminals: formalTerminals,
      formalParameters: cell.parameters.map((parameter) => ({
        name: parameter.name,
        defaultValue: parameter.rawText,
      })),
    },
    instances: placed,
    nets,
    ...(mosBulkDefaults ? { mosBulkDefaults } : {}),
    ...(inductorCouplings.length ? { inductorCouplings } : {}),
    connectivityEvidence: cell.nets.flatMap((net) => {
      if (!keptNetIds.has(net.id)) return [];
      const importedName = importedNetName(net.name, net.scope, namingProfile);
      return [
        ...(importedName.name
          ? [
              importedName.scope === "global"
                ? {
                    id: deriveStableId(
                      "connectivity-evidence",
                      documentId,
                      "global-declaration",
                      net.id,
                      importedName.name,
                    ),
                    kind: "name-claim" as const,
                    netId: net.id,
                    name: importedName.name,
                    owner: {
                      kind: "global-declaration" as const,
                      sourceNetId: net.id,
                    },
                    scope: "global" as const,
                    ...(importedName.name === "0"
                      ? { powerDomain: "ground" as const }
                      : {}),
                  }
                : {
                    id: deriveStableId(
                      "connectivity-evidence",
                      documentId,
                      "net-name-hint",
                      net.id,
                      net.name,
                    ),
                    kind: "net-name-hint" as const,
                    netId: net.id,
                    sourceName: importedName.sourceName,
                    origin: "spice-import" as const,
                  },
            ]
          : []),
        ...(importedName.scope === "global" &&
        importedName.sourceName !== importedName.name
          ? [
              {
                id: deriveStableId(
                  "connectivity-evidence",
                  documentId,
                  "net-name-hint",
                  net.id,
                  importedName.sourceName,
                ),
                kind: "net-name-hint" as const,
                netId: net.id,
                sourceName: importedName.sourceName,
                origin: "spice-import" as const,
              },
            ]
          : []),
        ...[net.id].map((sourceNetId) => ({
          id: deriveStableId(
            "connectivity-evidence",
            documentId,
            "spice-source",
            net.id,
            sourceNetId,
          ),
          kind: "spice-source" as const,
          netId: net.id,
          sourceNetId,
        })),
        ...(blockGroundNetIds.has(net.id)
          ? [
              {
                id: deriveStableId(
                  "connectivity-evidence",
                  documentId,
                  "block-ground",
                  net.id,
                ),
                kind: "name-claim" as const,
                netId: net.id,
                name: "0",
                owner: {
                  kind: "global-declaration" as const,
                  sourceNetId: net.id,
                },
                scope: "global" as const,
                powerDomain: "ground" as const,
              },
            ]
          : []),
      ];
    }),
    routes: [],
    junctions: [],
    annotations: phaseLabels.map(({ instanceId, name }) => {
      const position = placed.find((item) => item.id === instanceId)?.placement
        ?.position ?? { x: 0, y: 0 };
      return {
        id: deriveStableId("annotation", documentId, "phase", instanceId),
        kind: "instance-label" as const,
        content: { runs: [{ kind: "text" as const, value: name }] },
        anchor: {
          kind: "object" as const,
          objectId: instanceId,
          localOffset: labelOffset,
          fallbackPosition: {
            x: position.x + labelOffset.x,
            y: position.y + labelOffset.y,
          },
        },
        alignment: "middle" as const,
        rotation: 0 as const,
        locked: false,
      };
    }),
    presentation: {
      styleProfileId: "razavi-textbook-v1",
      grid: DOCUMENT_GRID,
      compactness: "normal",
    },
    layoutGroups: [],
    constraints: [],
    noConnects: [],
  };
}

/**
 * Records a stable document link for an imported `X` instance. Typed
 * `netlist.binding` is the navigation authority; import provenance retains the
 * source spelling without becoming an electrical runtime fallback.
 */
function bindImportedChildDocuments(documents: readonly SchematicDocument[]): {
  documents: SchematicDocument[];
  externalSubcircuitDefinitions: ExternalSubcircuitDefinition[];
} {
  const documentIdByCellName = new Map(
    documents.flatMap((document) => {
      const cellName = document.sourceBinding?.cellName;
      return cellName ? [[cellName.toLowerCase(), document.id] as const] : [];
    }),
  );
  const externalDefinitions = new Map<string, ExternalSubcircuitDefinition>();
  const boundDocuments: SchematicDocument[] = documents.map((document) => ({
    ...document,
    instances: document.instances.map((instance) => {
      const referencedInstance = { ...instance };
      const isImportedChild = instance.importProvenance?.kind === "subcircuit";
      const isImportedExternal =
        instance.netlist?.binding?.kind === "external-subcircuit";
      if (!isImportedChild && !isImportedExternal) {
        return referencedInstance;
      }
      const childDocumentId = isImportedChild
        ? documentIdByCellName.get(
            instance.importProvenance!.sourceMasterName.toLowerCase(),
          )
        : undefined;
      const externalDefinition = !childDocumentId
        ? (() => {
            const key =
              instance.importProvenance!.sourceMasterName.toLowerCase();
            const existing = externalDefinitions.get(key);
            if (existing) return existing;
            const definition: ExternalSubcircuitDefinition = {
              id: externalDefinitionId(
                instance.importProvenance!.sourceMasterName,
              ),
              name: instance.importProvenance!.sourceMasterName,
              terminals: (() => {
                const sourceTerminals = (
                  instance.importProvenance!.terminalMapping ?? []
                ).toSorted(
                  (left, right) => left.sourcePosition - right.sourcePosition,
                );
                const reviewed = reviewedExternalBindingForTerminalCount(
                  instance.importProvenance!.sourceMasterName,
                  sourceTerminals.length,
                );
                return sourceTerminals.map((terminal, index) => ({
                  id: deriveStableId(
                    "external-subcircuit-terminal",
                    key,
                    String(index),
                  ),
                  name:
                    reviewed?.terminals.length === sourceTerminals.length
                      ? reviewed.terminals[index]!.targetName
                      : terminal.pinName,
                  direction: "passive" as const,
                }));
              })(),
              formalParameters:
                reviewedExternalBindingForTerminalCount(
                  instance.importProvenance!.sourceMasterName,
                  instance.importProvenance!.terminalMapping?.length ?? 0,
                )?.parameters.map((parameter) => ({
                  name: parameter.name,
                  ...(parameter.targetDefaultValue === undefined
                    ? {}
                    : { defaultValue: parameter.targetDefaultValue }),
                })) ?? [],
              interfaceStatus: reviewedExternalBindingForTerminalCount(
                instance.importProvenance!.sourceMasterName,
                instance.importProvenance!.terminalMapping?.length ?? 0,
              )
                ? "declared"
                : "inferred-positional",
            };
            externalDefinitions.set(key, definition);
            return definition;
          })()
        : undefined;
      return {
        ...referencedInstance,
        importProvenance: {
          ...instance.importProvenance,
          status:
            childDocumentId ||
            (isImportedExternal &&
              Boolean(instance.importProvenance?.symbolMappingRegistryId))
              ? ("resolved" as const)
              : ("missing" as const),
        } as NonNullable<Instance["importProvenance"]>,
        netlist: instance.netlist
          ? {
              ...instance.netlist,
              binding: childDocumentId
                ? {
                    kind: "subcircuit" as const,
                    childDocumentId,
                  }
                : {
                    kind: "external-subcircuit" as const,
                    definitionId: externalDefinition!.id,
                  },
            }
          : undefined,
      };
    }),
  }));
  return {
    documents: boundDocuments,
    externalSubcircuitDefinitions: [...externalDefinitions.values()],
  };
}

function sourceProjectName(bundle: SourceBundle): string {
  const filename = bundle.entryPath.split("/").at(-1) ?? bundle.entryPath;
  return filename.replace(/\.[^.]+$/u, "") || "Imported SPICE";
}

function importCircuitIR(
  ir: CircuitIR,
  bundle: SourceBundle,
  inputDiagnostics: readonly SpiceDiagnostic[] = [],
  options: SpiceImportOptions = {},
): { project: CircuitProject; diagnostics: SpiceDiagnostic[] } {
  const diagnostics = [...inputDiagnostics];
  const modelTypeByName = new Map(
    ir.models.map((model) => [
      model.name.toLowerCase(),
      model.modelType.toLowerCase(),
    ]),
  );
  const builtInBodies = new Map(
    (options.builtInBodies ?? [])
      .filter((body) => {
        const definitions = (
          body.kind === "subcircuit" ? ir.cells : ir.models
        ).filter(
          (definition) =>
            definition.name.toLowerCase() === body.name.toLowerCase(),
        );
        const matches = (
          candidate: SpiceBuiltInBody,
          definition: (typeof definitions)[number],
        ) =>
          bundle.files.some(
            (file) =>
              file.id === definition.sourceRef.fileId &&
              file.path === normalizeSourcePath(candidate.source.path),
          ) && definition.sourceRef.start.line === candidate.source.line;
        // Only the active definition may authorize a built-in. Model names can
        // occur in several Cells: keep ordinary bindings if any definition is
        // custom, rather than applying one Cell's model to another.
        return (
          definitions.some((definition) => matches(body, definition)) &&
          definitions.every((definition) =>
            (options.builtInBodies ?? []).some(
              (candidate) =>
                candidate.kind === body.kind &&
                candidate.name.toLowerCase() === body.name.toLowerCase() &&
                matches(candidate, definition),
            ),
          )
        );
      })
      .map((body) => [builtInBodyKey(body.kind, body.name), body]),
  );
  // A built-in body imports as the part each call of it is, not as a Cell.
  const isBody = (name: string) =>
    builtInBodies.has(builtInBodyKey("subcircuit", name));
  const cells = ir.cells.filter((cell) => !isBody(cell.name));
  const importedDocuments = cells.map((cell) =>
    importDocument(cell, diagnostics, modelTypeByName, options, builtInBodies),
  );
  const { documents, externalSubcircuitDefinitions } =
    bindImportedChildDocuments(importedDocuments);
  for (const document of documents) {
    document.importReference!.files = bundle.files.map((file) => ({
      fileId: file.id,
    }));
  }
  const topCell = ir.topCells.find((name) => !isBody(name)) ?? cells[0]?.name;
  const topDocument = documents.find(
    (document) =>
      document.sourceBinding?.cellName.toLowerCase() === topCell?.toLowerCase(),
  );
  if (!topDocument)
    throw new Error("Circuit IR has no importable top Document");
  const name = topCell ?? sourceProjectName(bundle);
  const entryHash = bundle.files.find(
    (file) => file.id === bundle.entryFileId,
  )?.hash;
  const project = CircuitProjectSchema.parse({
    schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
    id: deriveStableId("project", bundle.entryPath, entryHash ?? "missing"),
    name: `${name} (SPICE Import)`,
    source: {
      entry: bundle.entryPath,
      dialect: ir.dialect,
      sourcePolicy: "copy",
      files: bundle.files.map((file) => {
        const original = options.originalSources?.find(
          (input) => normalizeSourcePath(input.path) === file.path,
        );
        const originalContent = original
          ? decodeSourceContent(original.bytes)
          : undefined;
        return {
          id: file.id,
          path: file.path,
          hash: file.hash,
          content: { text: file.text, encoding: file.encoding },
          ...(originalContent &&
          (originalContent.text !== file.text ||
            originalContent.encoding !== file.encoding)
            ? { originalContent }
            : {}),
        };
      }),
    },
    symbolLibrary: {
      id: "razavi-symbols",
      version: "1",
      hash: "razavi-reference-v1",
    },
    structureRevision: 0,
    topDocumentId: topDocument.id,
    documents,
    externalSubcircuitDefinitions,
    simulationFolders: [],
  });
  return { project, diagnostics };
}

export function importCompileResult(
  result: SpiceCompileResult,
  options: SpiceImportOptions = {},
): SpiceImportResult {
  if (!result.ir) return { ...result, project: null };
  try {
    const imported = importCircuitIR(
      result.ir,
      result.bundle,
      result.diagnostics,
      options,
    );
    const hasErrors = imported.diagnostics.some(
      (item) => item.severity === "error",
    );
    return {
      ...result,
      project: hasErrors ? null : imported.project,
      diagnostics: imported.diagnostics,
      successful: !hasErrors,
    };
  } catch (error) {
    const diagnostics = [
      ...result.diagnostics,
      diagnostic(
        "SPICE_IMPORT_INVALID_PROJECT",
        "error",
        "import",
        error instanceof Error ? error.message : String(error),
      ),
    ];
    return { ...result, project: null, diagnostics, successful: false };
  }
}

export async function importSpiceSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  compileOptions: SpiceCompileOptions = {},
  importOptions: SpiceImportOptions = {},
): Promise<SpiceImportResult> {
  return importCompileResult(
    await compileSpiceSources(inputs, entryPath, compileOptions),
    importOptions,
  );
}
