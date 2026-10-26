import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  isSchematicAnnotationVisible,
  objectStyleProfile,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveCommittedDocumentLogicalNets,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
  resolveDraftingObjectGeometry,
  resolveEndpointPoint,
  resolveRouteAttachment,
  resolveVisualAnchor,
  richTextMetrics,
  type AnnotationPresentation,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import {
  labelTypography,
  type Annotation,
  type CircuitProject,
  type Instance,
  type RouteEndpoint,
  type SchematicDocument,
  type StableId,
} from "@icm/model";
import {
  normalizeIndependentSource,
  printedParameterConversion,
  restorePrintedParameter,
  spectreNumber,
  withNetlistPowerMarkerClaims,
  type DesignNetlistCell,
  type DesignNetlistIR,
  type NetlistFormat,
} from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  bindsProjectCell,
  matchGateCellPins,
  subcircuitDescriptor,
} from "@icm/devices";

import {
  blockSymbols,
  blockTerminals,
  type RnlSymbolDefinition,
} from "./block-symbols.js";
import { draftingLayer, draftingShapes, drawingGroup } from "./drawing-ops.js";
import { composeOrient, rnlOrient, type RnlOrient } from "./orientation.js";
import {
  AC_UNITS_PER_RNL_UNIT,
  rnlPlace,
  toRnlPoint,
  type RnlPoint,
} from "./place.js";
import { rnlName } from "./rnl-name.js";
import type { RnlShape } from "./shapes.js";
import { rnlSymbolFor, terminalOfPin, type RnlSymbol } from "./symbol-map.js";
import { symbolForCall } from "./call-symbols.js";
import { inlineRnlDefinition } from "./inline-symbols.js";
import { plainLines, rnlTextLines, type RnlRun } from "./text.js";

/**
 * A vertex of a wire as an RNL edit transaction names it: a terminal, a named
 * point, a role of a usage, or a coordinate (rnl-dev
 * `notes/rnl-editor-interface/spec-draft.md`, 3.5).
 */
export type RnlVertex =
  | { terminal: string }
  | { point: string }
  | { usage: string; role: string }
  | { at: RnlPoint };

/**
 * One operation of an RNL edit transaction (the same draft, 4.1, and
 * `ops-draft-blocks-and-drawings.md` beside it). `level` is `subckt:<name>`,
 * or `file` for the file level.
 */
export type RnlOp = { level: string } & (
  | {
      op: "set";
      object: string;
      /** Absent leaves the part to RNL's own symbol rules or stand-in box. */
      symbol?: string;
      /** Its colour, written as a `@SET-STYLE` of these properties. */
      style?: Record<string, string>;
      at?: RnlPoint;
      orient?: RnlOrient;
    }
  | {
      op: "add-usage";
      /** Absent for a usage nothing refers to, such as one of meaning only. */
      name?: string;
      definition: string;
      attach: Record<string, string | RnlPoint>;
      /** Written `@ATTACH(k=v, …)`, in the order given. */
      params?: Record<string, string | number | boolean>;
      symbol?: string;
      style?: Record<string, string>;
      at?: RnlPoint;
      orient?: RnlOrient;
    }
  | { op: "add-point"; name: string; at: RnlPoint; junction?: true }
  | {
      op: "add-wire";
      nets: string[];
      via: RnlVertex[];
      mode: "straight";
      style?: Record<string, string>;
    }
  | { op: "remove-from"; items: string[]; set: string }
  | { op: "use-package"; name: string; version: string }
  | {
      op: "add-text";
      /** Its name in the level, for a text of a drawing object's group. */
      name?: string;
      /** The part, usage or net it is attached to; absent for a text on a point. */
      attach?: string;
      /** Its key on that object (`#M1::name`); never for a net or a point. */
      key?: string;
      lines: RnlRun[][];
      /** An absolute anchor, in scene coordinates. */
      at?: RnlPoint;
      /** The anchor from the attached object's own point (13.3). */
      offset?: RnlPoint;
      halign: "start" | "middle" | "end";
      valign?: "baseline" | "middle";
      rotate?: 90 | 180 | 270;
      /** Text height, the em, in scene units. */
      size: number;
      style?: Record<string, string | boolean>;
    }
  | ({
      op: "add-shape";
      /** Drawn under the circuit, or over it (11.6). */
      layer: "bottom" | "top";
      /** Its name in the level, for a shape of a drawing object's group. */
      name?: string;
    } & RnlShape)
  /** A symbol, defined in the level; `set` on `#` makes it a Cell's look. */
  | ({ op: "define-symbol" } & RnlSymbolDefinition)
);

export interface RnlExportDiagnostic {
  /** An error leaves the drawing out of the export; a warning only reports. */
  severity: "error" | "warning";
  code: string;
  message: string;
  documentId: StableId;
  objectIds: StableId[];
}

/**
 * The virtual elements a glyph stands for (standard package `rnl-std-basic`),
 * with the prefix of their usages' names. The mapping table says which
 * definition a glyph's symbol draws.
 */
const USAGE_PREFIX: Readonly<Record<string, string>> = {
  $GROUND: "gnd",
  $SUPPLY: "vdd",
  $IO_PORT: "port",
};

/**
 * Packages the standard package `rnl-std` brings in by itself (16.3): they
 * hold the symbols for every element SPICE and Spectre read natively, all but
 * subcircuit calls. A file names every other package it uses. The rules that
 * pick those symbols by default come with the netlist dialect's own standard
 * package; the export needs none, since it sets every symbol itself. The
 * split is rnl-dev's draft, not yet in the standard.
 */
const IMPLICIT_PACKAGES = new Set(["rnl-std-basic", "rnl-std-semiconductors"]);

/** The standard series the export writes for; the header pins it (16.3). */
const STD_VERSION = "0.3";

/**
 * The standard package that clears the labels symbols bring with them (name,
 * value, model; a usage's name), so a file shows only the labels it writes.
 * Formulas stay: Analog Canvas shows them.
 */
const NO_LABELS_PACKAGE = "rnl-std-no-labels";

/**
 * The package of Analog Canvas's appearance variants and chopper, and what
 * only Analog Canvas keeps of a drawing; not standard.
 */
const AC_PACKAGE = "analog-canvas-extensions";
const AC_PACKAGE_VERSION = "0.3";

/**
 * The edit transaction's operations that draw a netlisted Project as Analog
 * Canvas draws it: each part's symbol, place and orientation, each block's
 * symbol, the ground, supply and Cell Pin glyphs, every wire with all its
 * bends and direction arrows, junctions and the dots Analog Canvas draws, the
 * contacts it makes by touching, its labels and texts, the current and
 * voltage marks on wires, and the drawing objects. The header pins the
 * standard series and every other package the drawing uses.
 *
 * `ir` is the IR the netlist was printed from (`includeIr`), with the body
 * port order `rnlBodyPortOrder` gives, so names and terminals match the file;
 * `format` is the netlist's dialect, whose escaped names RNL reads plain.
 */
export function rnlExportOps(
  project: CircuitProject,
  ir: DesignNetlistIR,
  format: NetlistFormat = "spice",
): { ops: RnlOp[]; diagnostics: RnlExportDiagnostic[] } {
  const ops: RnlOp[] = [];
  const diagnostics: RnlExportDiagnostic[] = [];
  const packages = new Set<string>();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const blocks = blockSymbols(project, ir, resolver, format);
  const callSymbols = new Map<string, RnlSymbol>();
  const top = ir.cells.find((cell) => cell.id === ir.topCellId);
  for (const cell of ir.cells) {
    if (cell.origin === "generated-model") continue;
    const document = project.documents.find((item) => item.id === cell.id);
    if (!document) continue;
    exportCell(document, cell, {
      project,
      ir,
      format,
      ops,
      diagnostics,
      packages,
      resolver,
      blocks,
      callSymbols,
    });
  }
  const header: RnlOp[] = [
    "rnl-std",
    NO_LABELS_PACKAGE,
    ...[...packages].filter((name) => !IMPLICIT_PACKAGES.has(name)).sort(),
  ].map((name) => ({
    level: top ? `subckt:${top.name}` : "",
    op: "use-package",
    name,
    version: name === AC_PACKAGE ? AC_PACKAGE_VERSION : STD_VERSION,
  }));
  const fileSymbols: RnlOp[] = [...blocks.externals.values()].map((symbol) => ({
    level: "file",
    op: "define-symbol",
    ...symbol,
  }));
  const inline = new Map(
    project.documents
      .flatMap((document) => [
        ...document.instances,
        ...(document.drafting?.objects ?? []).filter(
          (object) => object.kind === "floating-symbol",
        ),
      ])
      .flatMap((instance) => {
        const row = rnlSymbolFor(
          instance.symbolId,
          "symbolVariantId" in instance ? instance.symbolVariantId : undefined,
        );
        return row?.inline ? [[row.symbol, row] as const] : [];
      }),
  );
  for (const row of [...inline.values(), ...callSymbols.values()])
    fileSymbols.push({
      level: "file",
      op: "define-symbol",
      ...inlineRnlDefinition(row),
    });
  return { ops: [...header, ...fileSymbols, ...ops], diagnostics };
}

interface ExportContext {
  project: CircuitProject;
  ir: DesignNetlistIR;
  format: NetlistFormat;
  ops: RnlOp[];
  diagnostics: RnlExportDiagnostic[];
  packages: Set<string>;
  resolver: ReturnType<typeof createProjectSymbolResolver>;
  /** The symbols written for blocks: a Cell's by its Document, an external one's by definition. */
  blocks: ReturnType<typeof blockSymbols>;
  /** Library artwork defined for calls that print its pins in another order, by name. */
  callSymbols: Map<string, RnlSymbol>;
}

/**
 * A Document's naming typography as `$CANVAS_TYPESETTING` writes it: each
 * setting other than Analog Canvas's default, which one left out stands for.
 */
function canvasTypesetting(
  presentation: SchematicDocument["presentation"],
): Record<string, string | boolean> {
  const own = labelTypography(presentation);
  const usual = labelTypography({} as SchematicDocument["presentation"]);
  return Object.fromEntries(
    Object.entries({
      subscript_case: [own.subscriptCase, usual.subscriptCase],
      subscript_italic: [own.subscriptItalic, usual.subscriptItalic],
      underscore_subscript: [
        own.underscoreSubscript,
        usual.underscoreSubscript,
      ],
      subscript_after_first: [
        own.subscriptAfterFirst,
        usual.subscriptAfterFirst,
      ],
      first_letter_italic: [own.firstLetterItalic, usual.firstLetterItalic],
      face: [presentation.textFace, undefined],
      crossings: [presentation.crossingStyle, undefined],
    }).flatMap(([key, [value, otherwise]]) =>
      value !== undefined && value !== otherwise ? [[key, value]] : [],
    ),
  );
}

/**
 * What a bound label shows, as `$CANVAS_LABEL` says it: the part's name, its
 * value or one parameter (shown without its value, or with it), a Cell Pin's
 * name or a net's. Null for a label that holds its own text.
 */
function canvasLabel(
  binding: Annotation["binding"],
): Record<string, string | boolean> | null {
  if (!binding) return null;
  switch (binding.kind) {
    case "instance-reference":
      return { bind: "name" };
    case "instance-value":
      return binding.parameter
        ? {
            bind: "parameter",
            parameter: binding.parameter,
            ...(binding.showValue === false ? { show_value: false } : {}),
          }
        : { bind: "value" };
    case "cell-terminal-name":
      return { bind: "port" };
    case "net-name":
      return { bind: "net" };
  }
}

/** A source's fields as Spectre names them, where it names them otherwise. */
const SPECTRE_SOURCE_NAMES: Readonly<Record<string, string>> = {
  low: "val0",
  high: "val1",
  offset: "dc",
  amplitude: "ampl",
  frequency: "freq",
  damping: "damp",
  phase: "sinephase",
  acmagnitude: "mag",
  acphase: "phase",
};

/** The fields a source's Spectre card writes, by its waveform. */
const SPECTRE_SOURCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  dc: ["dc"],
  pulse: ["low", "high", "delay", "rise", "fall", "width", "period", "dc"],
  sin: ["offset", "amplitude", "frequency", "delay", "damping", "phase"],
  pwl: ["dc"],
};

/**
 * The parameters of a part the netlist writes as other text than the
 * author's, by the name the netlist gives each. A SKY130 size prints in
 * plain micrometres in either dialect, and reads back as 150n where the
 * author wrote 0.15u. The Spectre netlist writes its own numbers too: a
 * resistor's, capacitor's or inductor's value is its r, c or l, and a
 * source's fields are named as its card names them, those of its waveform
 * only. A source kept as SPICE wrote it, its waveform in its text, has no
 * fields of its own.
 */
function authoredTexts(
  cell: DesignNetlistCell,
  instance: Instance,
  format: NetlistFormat,
): { name: string; text: string }[] {
  const printed = cell.instances.find((item) => item.id === instance.id);
  if (!printed) return [];
  // The part's own text of a size, beside the micrometres printed for it.
  const authored = Object.entries(instance.netlist?.parameters ?? {});
  const scaled = printed.parameters.flatMap(({ name, rawValue }) => {
    if (printedParameterConversion(printed, name) !== "sky130-micrometres")
      return [];
    const text = authored.find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
    try {
      return text === undefined ||
        restorePrintedParameter(rawValue, "sky130-micrometres") === text
        ? []
        : [{ name, text }];
    } catch {
      return [];
    }
  });
  if (format !== "spectre") return scaled;
  const source =
    printed.deviceClass === "voltage-source" ||
    printed.deviceClass === "current-source";
  if (
    source &&
    printed.parameters.some(
      (p) =>
        p.name.toLowerCase() === "dc" &&
        /(?:AC|PULSE|SIN|PWL)/iu.test(p.rawValue),
    )
  )
    return scaled;
  const waveform = source
    ? normalizeIndependentSource(printed.parameters).transient.kind
    : null;
  const fields = waveform
    ? new Set([
        ...(SPECTRE_SOURCE_FIELDS[waveform] ?? []),
        "acmagnitude",
        "acphase",
      ])
    : null;
  const letter = { resistor: "r", capacitor: "c", inductor: "l" }[
    printed.deviceClass as string
  ];
  const rest = printed.parameters.flatMap(({ name, rawValue }) => {
    const folded = name.toLowerCase();
    if (
      spectreNumber(rawValue) === rawValue ||
      printedParameterConversion(printed, name) !== "identity" ||
      folded === "waveform" ||
      (fields &&
        !fields.has(folded) &&
        (Object.hasOwn(SPECTRE_SOURCE_NAMES, folded) ||
          Object.values(SPECTRE_SOURCE_FIELDS).some((list) =>
            list.includes(folded),
          )))
    )
      return [];
    const written = source
      ? (SPECTRE_SOURCE_NAMES[folded] ?? name)
      : letter && name === "value"
        ? letter
        : name;
    return [{ name: written, text: rawValue }];
  });
  return [...scaled, ...rest];
}

function exportCell(
  document: SchematicDocument,
  cell: DesignNetlistCell,
  context: ExportContext,
): void {
  const { ops, diagnostics, packages, blocks } = context;
  const level = `subckt:${cell.name}`;

  // The Cell's own block symbol: how every call of it is drawn (9.2.6).
  const own = blocks.cells.get(document.id);
  if (own)
    ops.push(
      { level, op: "define-symbol", ...own },
      { level, op: "set", object: "#", symbol: own.name },
    );
  // How the Cell sets names in its labels, each setting other than Analog
  // Canvas's default, none included, so the import knows the Cell keeps
  // the default: in its own record, which reaches no other Cell.
  packages.add(AC_PACKAGE);
  ops.push({
    level,
    op: "add-usage",
    definition: "$CANVAS_TYPESETTING",
    attach: { level: "#" },
    params: canvasTypesetting(document.presentation),
  });
  const report = (
    severity: RnlExportDiagnostic["severity"],
    code: string,
    message: string,
    objectIds: StableId[],
  ) =>
    diagnostics.push({
      severity,
      code,
      message,
      documentId: document.id,
      objectIds,
    });

  // Printed names: Instance -> card name, Base Net -> node.
  const references = new Map(
    cell.instances.map((instance) => [instance.id, instance.reference]),
  );
  const logical = resolveDocumentLogicalNets(document);
  // The netlist joins supply markers by name before it names Nets (a copied
  // ground glyph carries no claim of its own), so a Net prints under the name
  // of the group that joining makes, as designNetlistNetName finds it.
  const electrical = resolveCommittedDocumentLogicalNets(
    withNetlistPowerMarkerClaims(document, context.project),
  );
  // A Spectre netlist escapes a name's other characters (`Vin\+`); RNL reads
  // the name the netlist means, `Vin+`.
  const plain = (name: string) =>
    context.format === "spectre" ? name.replace(/\\(.)/gu, "$1") : name;
  const printedNets = new Map(
    cell.nets.map((net) => [net.id, plain(net.name)]),
  );
  const netOf = (baseNetId: string): string | undefined => {
    const id = electrical.byBaseNetId.get(baseNetId)?.id;
    return id ? printedNets.get(id) : undefined;
  };
  const netOfPin = (instanceId: string, pinName: string) => {
    const net = document.nets.find((candidate) =>
      candidate.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    );
    return net ? netOf(net.id) : undefined;
  };

  // Pins a wire or a contact reaches: a variant that hides one is drawn
  // whole instead, since RNL draws a wire only to a pin.
  const evidence = deriveDocumentContactEvidence(document, context.resolver);
  const reached = new Set<string>();
  const reach = (endpoint: RouteEndpoint) => {
    if (endpoint.kind === "terminal")
      reached.add(`${endpoint.instanceId}\u0000${endpoint.pinName}`);
  };
  for (const route of document.routes) {
    reach(route.start);
    for (const leg of route.legs)
      if (leg.to.kind === "endpoint") reach(leg.to.endpoint);
  }
  for (const contact of evidence.contacts) contact.endpoints.forEach(reach);

  // Parts and glyphs.
  const terminalsOf = new Map<StableId, (pin: string) => number | undefined>();
  const usageOf = new Map<StableId, string>();
  const counters = new Map<string, number>();
  const nextName = (prefix: string) => {
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    return `%${prefix}${count}`;
  };
  const drawnPorts = new Set<string>();
  /** Where each drawn part or glyph is registered, and the name RNL knows it by. */
  const placeOf = new Map<StableId, { object: string; at: RnlPoint }>();
  for (const instance of document.instances) {
    let symbol = rnlSymbolFor(instance.symbolId, instance.symbolVariantId);
    if (symbol?.inline) {
      const descriptor = subcircuitDescriptor(
        instance.symbolId,
        context.project,
      );
      const call = cell.instances.find(
        (candidate) => candidate.id === instance.id,
      );
      if (
        call &&
        symbol.pins.some(
          (pin) =>
            call.nodes[pin.terminal - 1]?.pinName !==
            descriptor?.ports.find((port) => port.pinName === pin.acPin)?.name,
        )
      ) {
        report(
          "error",
          "RNL_INLINE_INTERFACE_MISMATCH",
          `${describe(instance)} calls a custom interface with a different terminal order; export plain SPICE/SCS or use a custom block Symbol`,
          [instance.id],
        );
        continue;
      }
    }
    const block = symbol
      ? undefined
      : blockTerminals(instance, context.project, context.ir);
    if (!symbol && !block) {
      report(
        "error",
        "RNL_NO_SYMBOL",
        `${describe(instance)} has no RNL symbol`,
        [instance.id],
      );
      continue;
    }
    // A Cell's symbol is its own look; an external block's is set on each call.
    const binding = instance.netlist?.binding;
    const blockSymbol = !block
      ? undefined
      : binding?.kind === "subcircuit"
        ? blocks.cells.get(binding.childDocumentId)
        : binding?.kind === "external-subcircuit"
          ? blocks.externals.get(binding.definitionId)
          : undefined;
    if (block && !blockSymbol)
      report(
        "warning",
        "RNL_BLOCK_STAND_IN",
        `${describe(instance)} is drawn with RNL's stand-in box: its block's artwork has a shape RNL cannot take yet`,
        [instance.id],
      );
    const hidden = symbol?.undrawnPins.find((pin) =>
      reached.has(`${instance.id}\u0000${pin.acPin}`),
    );
    if (symbol && hidden) {
      const whole = rnlSymbolFor(instance.symbolId, null);
      if (whole && whole !== symbol) {
        report(
          "warning",
          "RNL_HIDDEN_PIN_WIRED",
          `${describe(instance)} hides pin ${hidden.acPin}, which a wire reaches; it is drawn as ${whole.symbol}`,
          [instance.id],
        );
        symbol = whole;
      }
    }
    const call = cell.instances.find(
      (candidate) => candidate.id === instance.id,
    );
    if (symbol && call?.invocationKind === "subcircuit") {
      // A Library gate bound to a Cell meets its Pins by name (#1450).
      const gate =
        instance.netlist?.binding?.kind === "subcircuit" &&
        bindsProjectCell(instance.symbolId)
          ? matchGateCellPins(instance.symbolId, {
              name: call.target ?? "",
              portNames: call.nodes.map((node) => node.pinName),
            })
          : undefined;
      const ordered = symbolForCall(
        symbol,
        call,
        gate
          ? (node) =>
              gate.pins.find((pin) => pin.portName === node.pinName)?.pinName
          : undefined,
      );
      if (ordered !== symbol) {
        context.callSymbols.set(ordered.symbol, ordered);
        symbol = ordered;
      }
    }
    if (!instance.placement) {
      report(
        "warning",
        "RNL_NOT_PLACED",
        `${describe(instance)} is not placed on the drawing; RNL leaves it without a position`,
        [instance.id],
      );
    }
    const placement = instance.placement;
    let orient: RnlOrient | undefined;
    if (placement) {
      const result = rnlOrient(placement);
      if (!result.ok) {
        report(
          "error",
          "RNL_ROTATION_NOT_QUARTER",
          `${describe(instance)} is turned ${placement.rotation}°; RNL only turns parts in quarter turns`,
          [instance.id],
        );
        continue;
      }
      orient = result.orient;
    }
    if (symbol?.package === AC_PACKAGE)
      report(
        "warning",
        "RNL_NOT_STANDARD_SYMBOL",
        `${describe(instance)} is drawn with ${symbol.symbol} from the ${AC_PACKAGE} package, not the standard package`,
        [instance.id],
      );
    if (symbol && !symbol.inline) packages.add(symbol.package);
    // Its colour: its lines and the labels it brings, which RNL gives the
    // style of their part (11.3), as the editor gives a label its Instance's.
    const foreground = instance.styleOverride?.foreground;
    const paint = foreground
      ? { style: { linecolor: foreground, textcolor: foreground } }
      : {};
    if (instance.styleOverride?.background)
      report(
        "warning",
        "RNL_BACKGROUND_NOT_EXPORTED",
        `${describe(instance)} is painted with a background, which RNL draws no fill behind a symbol for`,
        [instance.id],
      );
    const mapped = symbol;
    terminalsOf.set(
      instance.id,
      mapped ? (pin) => terminalOfPin(mapped, pin) : block!,
    );
    const where =
      placement && orient
        ? {
            at: rnlPlace(placement.position, orient, symbol?.offset ?? [0, 0]),
            // a drawing that is the symbol flipped turns with the part
            orient: composeOrient(orient, symbol?.orient ?? "R0"),
          }
        : {};
    const definition = symbol?.definition;
    if (symbol && definition && USAGE_PREFIX[definition]) {
      const pin = symbol.pins[0]?.acPin;
      const net = pin ? netOfPin(instance.id, pin) : undefined;
      if (!net) {
        report(
          "warning",
          "RNL_GLYPH_UNCONNECTED",
          `${describe(instance)} meets no net; RNL draws a glyph only on a net`,
          [instance.id],
        );
        continue;
      }
      const name = nextName(USAGE_PREFIX[definition]!);
      usageOf.set(instance.id, name);
      if (where.at) placeOf.set(instance.id, { object: name, at: where.at });
      if (definition === "$IO_PORT") drawnPorts.add(net);
      ops.push({
        level,
        op: "add-usage",
        name,
        definition,
        attach: { p: rnlName("&", net) },
        symbol: symbol.symbol,
        ...paint,
        ...where,
      });
      continue;
    }
    const reference = references.get(instance.id);
    if (!reference) {
      report(
        "warning",
        "RNL_NOT_NETLISTED",
        `${describe(instance)} is not in the netlist, so RNL cannot name it`,
        [instance.id],
      );
      continue;
    }
    const object = rnlName("#", reference);
    if (where.at) placeOf.set(instance.id, { object, at: where.at });
    ops.push({
      level,
      op: "set",
      object,
      ...(symbol
        ? { symbol: symbol.symbol }
        : blockSymbol && binding?.kind === "external-subcircuit"
          ? { symbol: blockSymbol.name }
          : {}),
      ...paint,
      ...where,
    });
    // The part's own name, where the netlist spells it otherwise: SPICE
    // starts a subcircuit call's card with X, so M1 prints as XM1.
    if (instance.reference && instance.reference !== reference) {
      packages.add(AC_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_NAME",
        attach: { part: object },
        params: { name: instance.reference },
      });
    }
    // The author's text of each value the netlist writes otherwise: Spectre
    // reads 100f where the author wrote 100fF, and a SKY130 size 0.15 where
    // the author wrote 0.15u.
    for (const { name, text } of authoredTexts(
      cell,
      instance,
      context.format,
    )) {
      packages.add(AC_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_PARAMETER_TEXT",
        attach: { part: object },
        params: { name, text },
      });
    }
  }

  // A Cell Pin drawn as ground or supply, or not drawn at all, gets no port
  // tag: each leaves the fill's set on its own, since RNL removes several
  // nets only as one set of them (5.2.2).
  for (const port of cell.ports)
    if (!drawnPorts.has(plain(port.name)))
      ops.push({
        level,
        op: "remove-from",
        items: [rnlName("&", plain(port.name))],
        set: "$PORT_FILL_SET",
      });

  // Junctions are named points; the dots come below.
  const pointOf = new Map<StableId, string>();
  const points = new Map<string, RnlOp & { op: "add-point" }>();
  for (const junction of document.junctions) {
    const name = nextName("j");
    pointOf.set(junction.id, name);
    const op = {
      level,
      op: "add-point" as const,
      name,
      at: toRnlPoint(junction.position),
    };
    points.set(name, op);
    ops.push(op);
  }

  const vertex = (endpoint: RouteEndpoint): RnlVertex | undefined => {
    if (endpoint.kind === "junction") {
      const point = pointOf.get(endpoint.junctionId);
      return point ? { point } : undefined;
    }
    const usage = usageOf.get(endpoint.instanceId);
    if (usage) return { usage, role: "p" };
    const reference = references.get(endpoint.instanceId);
    const terminal = terminalsOf.get(endpoint.instanceId)?.(endpoint.pinName);
    return reference && terminal
      ? { terminal: `${rnlName("#", reference)}:${terminal}` }
      : undefined;
  };

  // A wire that runs through a contact without ending there (a T joint) is
  // joined there in Analog Canvas; RNL joins only at the vertices a wire
  // lists, so the contact's point or pin goes into its list where it passes.
  const through = new Map<
    StableId,
    { point: { x: number; y: number }; vertex: RnlVertex }[]
  >();
  for (const contact of evidence.contacts) {
    const own = contact.endpoints.map(vertex).find((item) => item);
    if (!own) continue;
    const touches = (endpoint: RouteEndpoint) =>
      contact.endpoints.some((item) => sameEndpoint(item, endpoint));
    const routeIds = new Set(
      contact.incidents
        .filter((incident) => incident.kind === "route")
        .map((incident) => incident.objectId),
    );
    for (const routeId of routeIds) {
      const route = document.routes.find((item) => item.id === routeId);
      const last = route?.legs.at(-1)?.to;
      if (
        !route ||
        touches(route.start) ||
        (last?.kind === "endpoint" && touches(last.endpoint))
      )
        continue;
      const list = through.get(routeId) ?? [];
      list.push({ point: contact.point, vertex: own });
      through.set(routeId, list);
    }
  }
  const pointOfEndpoint = (endpoint: RouteEndpoint) =>
    resolveEndpointPoint(document, context.resolver, endpoint);
  const routing = resolveDocumentRoutingGeometry(document, context.resolver);
  const profile = resolveDocumentStyleProfile(document.presentation);

  // Wires, every bend written, so RNL draws them as drawn.
  for (const route of document.routes) {
    const net = netOf(route.netId);
    const corners = [
      { place: pointOfEndpoint(route.start), vertex: vertex(route.start) },
      ...route.legs.map((leg) =>
        leg.to.kind === "bend"
          ? {
              place: leg.to.position,
              vertex: { at: toRnlPoint(leg.to.position) } as RnlVertex,
            }
          : {
              place: pointOfEndpoint(leg.to.endpoint),
              vertex: vertex(leg.to.endpoint),
            },
      ),
    ];
    const via: (RnlVertex | undefined)[] = [];
    corners.forEach((corner, index) => {
      via.push(corner.vertex);
      const next = corners[index + 1];
      if (!next || !corner.place || !next.place) return;
      const from = corner.place;
      const to = next.place;
      const passes = (through.get(route.id) ?? [])
        .filter(({ point }) => onSegment(point, from, to))
        .sort(
          (a, b) =>
            Math.hypot(a.point.x - from.x, a.point.y - from.y) -
            Math.hypot(b.point.x - from.x, b.point.y - from.y),
        );
      for (const pass of passes) via.push(pass.vertex);
    });
    if (!net || via.some((item) => !item)) {
      report(
        "warning",
        "RNL_WIRE_UNNAMED",
        `Wire ${route.id} reaches something RNL cannot name; it is left out`,
        [route.id],
      );
      continue;
    }
    const style: Record<string, string> = {};
    if (route.presentation === "bulk-dashed") style.linestyle = "dashed";
    if (route.presentation === "power-rail") style.linestyle = "bold";
    if (route.styleOverride?.lineStyle)
      style.linestyle = route.styleOverride.lineStyle;
    if (route.styleOverride?.color) style.linecolor = route.styleOverride.color;
    ops.push({
      level,
      op: "add-wire",
      nets: [rnlName("&", net)],
      via: via as RnlVertex[],
      mode: "straight",
      ...(Object.keys(style).length ? { style } : {}),
    });
    // RNL wires take no arrow (13.1): the head is an arrow usage on the wire.
    const placement = route.styleOverride?.arrow;
    if (!placement) continue;
    const arrow = wireArrow(
      routing.routes.get(route.id)?.centerline ?? [],
      placement,
      objectStyleProfile(profile, route).annotations.arrowHeadLength,
    );
    if (!arrow) {
      report(
        "warning",
        "RNL_WIRE_ARROW",
        `Wire ${route.id} shows a direction arrow on a slanted run, which RNL cannot turn to`,
        [route.id],
      );
      continue;
    }
    ops.push({
      level,
      op: "add-usage",
      name: nextName("arrow"),
      definition: "$ARROW",
      attach: { p: arrow.at },
      orient: arrow.orient,
    });
  }

  // Contacts: things that touch are joined by a wire of no length, since RNL
  // never connects by position; and the dots Analog Canvas draws are written.
  for (const contact of evidence.contacts) {
    const net = netOf(contact.netId);
    if (net && contact.endpoints.length > 1) {
      const via = contact.endpoints.map(vertex);
      if (via.every((item) => item))
        ops.push({
          level,
          op: "add-wire",
          nets: [rnlName("&", net)],
          via: via as RnlVertex[],
          mode: "straight",
        });
    }
    if (!contactRequiresJunctionDot(contact)) continue;
    const junction = contact.endpoints.find(
      (endpoint) => endpoint.kind === "junction",
    );
    const point =
      junction?.kind === "junction" ? pointOf.get(junction.junctionId) : null;
    if (point) {
      points.get(point)!.junction = true;
      continue;
    }
    ops.push({
      level,
      op: "add-usage",
      name: nextName("dot"),
      definition: "$JUNCTION",
      attach: { p: toRnlPoint(contact.point) },
    });
  }

  exportTexts(document, level, {
    context,
    logical,
    routing,
    placeOf,
    netOf,
    nextName,
    report,
  });
}

/**
 * Where the arrow usage of a wire's direction arrow goes, and how it turns:
 * Analog Canvas puts the head's tip at the middle or the end of the wire's
 * run, on the segment it reaches there, and the arrow symbol is centred on
 * its point, its tip half a head ahead. Null on a slanted segment.
 */
function wireArrow(
  centerline: readonly { x: number; y: number }[],
  placement: "middle" | "end",
  headLength: number,
): { at: RnlPoint; orient: RnlOrient } | null {
  const segments = centerline.slice(1).flatMap((to, index) => {
    const from = centerline[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return length > 0 ? [{ from, to, length }] : [];
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!total) return null;
  const target = placement === "end" ? total : total / 2;
  let before = 0;
  let segment = segments.at(-1)!;
  for (const candidate of segments) {
    if (target <= before + candidate.length) {
      segment = candidate;
      break;
    }
    before += candidate.length;
  }
  if (placement === "end") before = total - segment.length;
  const along = Math.min(segment.length, Math.max(0, target - before));
  const ux = (segment.to.x - segment.from.x) / segment.length;
  const uy = (segment.to.y - segment.from.y) / segment.length;
  const orient: RnlOrient | null =
    ux === 1
      ? "R0"
      : ux === -1
        ? "R180"
        : uy === -1
          ? "R90"
          : uy === 1
            ? "R270"
            : null;
  if (!orient) return null;
  const back = along - headLength / 2;
  return {
    at: toRnlPoint({
      x: segment.from.x + ux * back,
      y: segment.from.y + uy * back,
    }),
    orient,
  };
}

/** A text's size in RNL units: Analog Canvas's em height, ten to a unit. */
const rnlSize = (fontSize: number) =>
  Math.round((fontSize / AC_UNITS_PER_RNL_UNIT) * 1e4) / 1e4;

/** A counter-clockwise quarter turn for an Analog Canvas clockwise rotation, or null. */
function quarterTurn(rotation: number): 0 | 90 | 180 | 270 | null {
  const turn = (360 - rotation) % 360;
  return turn % 90 === 0 ? (turn as 0 | 90 | 180 | 270) : null;
}

function annotationFontSize(
  annotation: Annotation,
  profile: ReturnType<typeof resolveDocumentStyleProfile>,
): number {
  switch (annotation.kind) {
    case "instance-label":
    case "instance-value":
      return profile.typography.instanceFontSize;
    case "net-label":
      return profile.typography.netFontSize;
    case "power-label":
      return profile.typography.powerFontSize;
    case "route-marker":
      return profile.typography.annotationFontSize;
  }
}

/**
 * Labels and drawing texts. A label bound to a name or value is written as
 * the text Analog Canvas shows for it, styled as shown (an italic letter, a
 * subscript), since RNL cannot style part of a referenced name (13.6); it no
 * longer follows a rename. A part's labels hang on the part by key and
 * offset, a Net's on the Net at an absolute place, anything else on its point.
 */
function exportTexts(
  document: SchematicDocument,
  level: string,
  {
    context,
    logical,
    routing,
    placeOf,
    netOf,
    nextName,
    report,
  }: {
    context: ExportContext;
    logical: ReturnType<typeof resolveDocumentLogicalNets>;
    routing: ResolvedDocumentRoutingGeometry;
    placeOf: ReadonlyMap<StableId, { object: string; at: RnlPoint }>;
    netOf: (baseNetId: string) => string | undefined;
    nextName: (prefix: string) => string;
    report: (
      severity: RnlExportDiagnostic["severity"],
      code: string,
      message: string,
      objectIds: StableId[],
    ) => void;
  },
): void {
  const { ops, resolver } = context;
  const profile = resolveDocumentStyleProfile(document.presentation);
  const fixed: StableId[] = [];
  const hidden: StableId[] = [];
  const alongWires: StableId[] = [];
  const formulas: StableId[] = [];
  const tilted: StableId[] = [];
  const drawings: StableId[] = [];
  // Each bound label says what it shows, so the import binds it again; a
  // label without one holds its own text. Two labels of one part with the
  // same key are one text to RNL, so only the first says it.
  const said = new Set<string>();
  const bindLabel = (label: string, binding: Annotation["binding"]) => {
    const params = canvasLabel(binding);
    if (!params || said.has(label)) return;
    said.add(label);
    context.packages.add(AC_PACKAGE);
    ops.push({
      level,
      op: "add-usage",
      definition: "$CANVAS_LABEL",
      attach: { label },
      params,
    });
  };
  const write = (
    id: StableId,
    text: Parameters<typeof rnlTextLines>[0],
    rotation: number,
    fields: Omit<
      Extract<RnlOp, { op: "add-text" }>,
      "level" | "op" | "lines" | "rotate"
    >,
  ) => {
    const { lines, formulas: count } = rnlTextLines(text);
    if (count) formulas.push(id);
    const turn = quarterTurn(rotation);
    if (turn === null) tilted.push(id);
    ops.push({
      level,
      op: "add-text",
      lines,
      ...fields,
      ...(turn ? { rotate: turn } : {}),
    });
  };

  for (const annotation of document.annotations) {
    if (annotation.visible === false) {
      hidden.push(annotation.id);
      continue;
    }
    const text = resolveAnnotationText(document, annotation, logical);
    if (!isSchematicAnnotationVisible(document, annotation, logical, text))
      continue;
    const shown = resolveAnnotationPresentation(
      document,
      resolver,
      annotation,
      profile,
      routing,
      logical,
      text,
    );
    const anchor = toRnlPoint(shown.position);
    if (annotation.binding) fixed.push(annotation.id);
    if (annotation.anchor.kind === "route") alongWires.push(annotation.id);
    const common = {
      halign: shown.alignment,
      size: rnlSize(
        annotationFontSize(annotation, profile) * (annotation.sizeScale ?? 1),
      ),
      ...(annotation.textColor
        ? { style: { textcolor: annotation.textColor } }
        : {}),
    };
    if (annotation.kind === "route-marker") {
      const marker = routeMarkerPlacement(annotation, shown, routing);
      const markerProfile = objectStyleProfile(profile, annotation);
      if (annotation.markerKind === "current") {
        // The arrow's head alone, on the wire that is its shaft (15.2); the
        // label stands centred beside it, level.
        const turn = quarterTurn(marker.rotation);
        let name: string | undefined;
        if (turn === null) tilted.push(annotation.id);
        else {
          name = nextName("current");
          ops.push({
            level,
            op: "add-usage",
            name,
            definition: "$CURRENT_ARROW",
            attach: { p: toRnlPoint(marker.position) },
            orient: `R${turn}` as RnlOrient,
          });
        }
        write(annotation.id, text, 0, {
          ...common,
          halign: "middle",
          ...(name ? { attach: name } : {}),
          at: toRnlPoint(marker.labelPosition),
        });
        continue;
      }
      if (annotation.markerKind === "voltage") {
        // The label on the wire, with + and − beside it as Analog Canvas
        // writes them, in plain type.
        write(annotation.id, text, 0, {
          ...common,
          halign: annotation.alignment,
          at: toRnlPoint(marker.position),
        });
        const { polarityOffsetX, polarityHalfGap } = markerProfile.annotations;
        for (const [sign, side] of [
          ["+", -1],
          ["−", 1],
        ] as const) {
          const offset = turned(
            { x: -polarityOffsetX, y: side * polarityHalfGap },
            marker.rotation,
          );
          ops.push({
            level,
            op: "add-text",
            lines: plainLines(sign),
            at: toRnlPoint({
              x: marker.position.x + offset.x,
              y: marker.position.y + offset.y + 4,
            }),
            halign: "middle",
            size: rnlSize(markerProfile.typography.polarityFontSize),
            ...(common.style ? { style: common.style } : {}),
          });
        }
        continue;
      }
    }
    const owner =
      annotation.anchor.kind === "object"
        ? placeOf.get(annotation.anchor.objectId)
        : undefined;
    const binding = annotation.binding;
    if (
      owner &&
      (annotation.kind === "instance-label" ||
        annotation.kind === "instance-value")
    ) {
      const key =
        binding?.kind === "instance-value" && binding.parameter
          ? binding.parameter
          : annotation.kind === "instance-label"
            ? "name"
            : "value";
      write(annotation.id, text, shown.rotation, {
        ...common,
        // A key's text takes what the scene leaves unsaid from the symbol's
        // own label (13.3); Analog Canvas's labels stand on their baseline.
        valign: "baseline",
        attach: owner.object,
        key,
        offset: [
          Math.round((anchor[0] - owner.at[0]) * 1e6) / 1e6 + 0,
          Math.round((anchor[1] - owner.at[1]) * 1e6) / 1e6 + 0,
        ],
      });
      bindLabel(`${owner.object}::${key}`, binding);
      continue;
    }
    const netId =
      binding?.kind === "net-name" ? binding.netId : annotation.netId;
    const net =
      (annotation.kind === "net-label" || annotation.kind === "power-label") &&
      netId
        ? netOf(netId)
        : undefined;
    // A power label is named for what it is, which RNL has no kind for: the
    // import makes it one again. A bound net label is named to say so.
    const name =
      annotation.kind === "power-label" && net
        ? nextName("power")
        : net && canvasLabel(binding)
          ? nextName("label")
          : undefined;
    write(annotation.id, text, shown.rotation, {
      ...common,
      ...(net ? { attach: rnlName("&", net) } : {}),
      ...(name ? { name } : {}),
      at: anchor,
    });
    if (name) bindLabel(name, binding);
  }

  // Drawing objects, in the order Analog Canvas stacks them.
  const objects = [...(document.drafting?.objects ?? [])].sort(
    (a, b) => a.zIndex - b.zIndex,
  );
  for (const object of objects) {
    const objectProfile = objectStyleProfile(profile, object);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
      routing,
    );
    const shapes = draftingShapes(object, geometry, objectProfile);
    // An object of a kind RNL has no form for is a group of shapes and
    // texts, named after it and each by its part, for the import to join.
    const kind = drawingGroup(object);
    const group = kind && shapes ? nextName(kind) : null;
    const named = (role: string | null) =>
      group ? { name: role ? `${group}_${role}` : group } : {};
    for (const { role, shape } of shapes ?? [])
      ops.push({
        level,
        op: "add-shape",
        layer: draftingLayer(object),
        ...shape,
        ...named(role),
      });
    if (object.anchor.kind === "route") alongWires.push(object.id);
    if (object.kind === "floating-symbol") {
      // A symbol drawn as a picture: a usage of the point definition
      // $FIGURE, which takes any symbol (rnl-dev ops draft, 3.4).
      const symbol = rnlSymbolFor(object.symbolId, null);
      const turn = rnlOrient(object.transform);
      if (geometry.kind !== "floating-symbol" || !symbol || !turn.ok) {
        drawings.push(object.id);
        continue;
      }
      if (!symbol.inline) context.packages.add(symbol.package);
      const orient = composeOrient(turn.orient, symbol.orient);
      ops.push({
        level,
        op: "add-usage",
        name: nextName("figure"),
        definition: "$FIGURE",
        attach: { p: rnlPlace(geometry.position, turn.orient, symbol.offset) },
        symbol: symbol.symbol,
        orient,
      });
      continue;
    }
    if (object.kind === "callout") {
      // Its leader is drawn above; its words go with it.
      if (!shapes || geometry.kind !== "callout") {
        drawings.push(object.id);
        continue;
      }
      // Its leader is drawn above; its words are bold unless set plain.
      const style: Record<string, string | boolean> = {};
      if (object.styleOverride?.weight !== "normal") style.bold = true;
      if (object.styleOverride?.italic) style.italic = true;
      if (object.styleOverride?.color)
        style.textcolor = object.styleOverride.color;
      if (object.typographyToken) drawings.push(object.id);
      write(object.id, object.content, geometry.rotation, {
        ...named("text"),
        at: toRnlPoint(geometry.textPosition),
        halign: object.alignment,
        size: rnlSize(
          richTextMetrics(
            objectProfile,
            object.typographyToken,
            object.styleOverride?.sizeScale,
          ).fontSize,
        ),
        ...(Object.keys(style).length ? { style } : {}),
      });
      continue;
    }
    if (object.kind !== "text") {
      if (!shapes) drawings.push(object.id);
      continue;
    }
    // A one-sided polarity text is its mark alone: it shows no words.
    if (object.polarity && !shapes) drawings.push(object.id);
    if (object.polarity === "positive" || object.polarity === "negative")
      continue;
    const anchor = resolveVisualAnchor(
      document,
      resolver,
      object.anchor,
      routing,
    );
    if (object.typographyToken) drawings.push(object.id);
    // Analog Canvas draws drawing text bold unless it is set plain.
    const style: Record<string, string | boolean> = {};
    if (object.styleOverride?.weight !== "normal") style.bold = true;
    if (object.styleOverride?.italic) style.italic = true;
    if (object.styleOverride?.color)
      style.textcolor = object.styleOverride.color;
    write(object.id, object.content, anchor.rotation + object.rotation, {
      ...named(null),
      at: toRnlPoint(anchor.position),
      halign: object.alignment,
      // On an object, or between polarity marks, a drawing text is centred
      // on its anchor; free, it stands on it.
      valign:
        object.anchor.kind === "object" || object.polarity
          ? "middle"
          : "baseline",
      size: rnlSize(
        richTextMetrics(
          profile,
          object.typographyToken,
          object.styleOverride?.sizeScale,
        ).fontSize,
      ),
      ...(Object.keys(style).length ? { style } : {}),
    });
  }

  const say = (code: string, ids: StableId[], message: string) => {
    if (ids.length) report("warning", code, `${ids.length} ${message}`, ids);
  };
  say(
    "RNL_TEXT_FIXED",
    fixed,
    "labels are written as the text they show, styled as shown; RNL will not follow a rename",
  );
  say("RNL_TEXT_HIDDEN", hidden, "hidden labels are left out");
  say(
    "RNL_TEXT_ALONG_WIRE",
    alongWires,
    "texts placed along a wire are written at a fixed place; they no longer move with the wire",
  );
  say(
    "RNL_TEXT_FORMULA",
    formulas,
    "texts hold formulas, written as their LaTeX source",
  );
  say(
    "RNL_TEXT_TILTED",
    tilted,
    "texts are turned by 45°; RNL turns text in quarter turns only, so they are written level",
  );
  say(
    "RNL_DRAWING_NOT_EXPORTED",
    drawings,
    "drawing objects keep only part of their look: a floating symbol with no RNL symbol is left out, and a typography token is written as its size",
  );
}

/**
 * Where a route marker's arrow or sign is drawn, and its label, as Analog
 * Canvas draws them: on a wire, at the conductor, the label on its offset
 * (level when the marker is set horizontal); anywhere else at its anchor.
 */
function routeMarkerPlacement(
  annotation: Annotation,
  shown: AnnotationPresentation,
  routing: ResolvedDocumentRoutingGeometry,
): {
  position: { x: number; y: number };
  labelPosition: { x: number; y: number };
  rotation: number;
} {
  const anchor = annotation.anchor;
  if (anchor.kind !== "route") {
    const position =
      anchor.kind === "free" ? anchor.position : shown.anchor.position;
    return { position, labelPosition: position, rotation: 0 };
  }
  const route = routing.routes.get(anchor.routeId);
  const placement = route && resolveRouteAttachment(route, anchor);
  if (!placement)
    return {
      position: anchor.fallbackPosition,
      labelPosition: anchor.fallbackPosition,
      rotation: 0,
    };
  const level = anchor.orientation === "horizontal";
  return {
    position: placement.conductorPoint,
    labelPosition: level ? placement.conductorPoint : placement.labelPoint,
    rotation: level ? 0 : placement.rotation,
  };
}

/** An offset turned clockwise by `rotation` degrees, y down, as Analog Canvas turns. */
function turned(
  offset: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: offset.x * cosine - offset.y * sine,
    y: offset.x * sine + offset.y * cosine,
  };
}

function sameEndpoint(a: RouteEndpoint, b: RouteEndpoint): boolean {
  return a.kind === "junction"
    ? b.kind === "junction" && a.junctionId === b.junctionId
    : b.kind === "terminal" &&
        a.instanceId === b.instanceId &&
        a.pinName === b.pinName;
}

/** Whether a point lies on a segment strictly between its ends. */
function onSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  const cross =
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot =
    (point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y);
  const length = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  return dot > 1e-9 && dot < length - 1e-9;
}

function describe(instance: Instance): string {
  return instance.reference
    ? `${instance.reference} (${instance.symbolId})`
    : instance.symbolId;
}
