import {
  contactRequiresJunctionDot,
  draftTextTurn,
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
  labelTextDocument,
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
  unprintedSourceFields,
  printedParameterConversion,
  restorePrintedParameter,
  spectreNumber,
  spectreSourceFieldName,
  spectreSourceFromText,
  plainBodyName,
  withNetlistPowerMarkerClaims,
  type DesignNetlistCell,
  type DesignNetlistIR,
  type NetlistFormat,
} from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  bindsExternalByPartPins,
  bindsProjectCell,
  builtInModelContract,
  matchGateCellPins,
  reviewedExternalBindingForMaster,
  subcircuitDescriptor,
} from "@icm/devices";

import type { Op, Vertex } from "@rich-netlist/runtime";

import { blockSymbols, blockTerminals } from "./block-symbols.js";
import { rnlLength } from "./shapes.js";
import { draftingLayer, draftingShapes, drawingGroup } from "./drawing-ops.js";
import {
  composeOrient,
  inverseOrient,
  orientPoint,
  rnlOrient,
  type RnlOrient,
} from "./orientation.js";
import {
  AC_UNITS_PER_RNL_UNIT,
  rnlPlace,
  toRnlPoint,
  type RnlPoint,
} from "./place.js";
import { rnlName } from "./rnl-name.js";
import {
  CANVAS_PACKAGE,
  CANVAS_PACKAGE_VERSION,
  RNL_STD_VERSION,
} from "./rnl-packages.js";
import {
  RNL_SYMBOLS,
  rnlDiagonalSymbolFor,
  rnlSymbolFor,
  rnlSymbolForPart,
  symbolModelType,
  terminalOfPin,
  type RnlSymbol,
} from "./symbol-map.js";
import { symbolForCall } from "./call-symbols.js";
import {
  inlineInterface,
  inlineRnlDefinition,
  inlineRnlDeviceMaster,
} from "./inline-symbols.js";
import { plainLines, rnlTextLines } from "./text.js";

/**
 * One operation of an RNL edit transaction, as the rnl runtime's writer takes
 * it (https://github.com/rich-netlist/rnl/blob/main/crates/rnl-edit/README.md).
 * The export names every op's level: `subckt:<name>`, or `file` for the file
 * level.
 */
export type RnlOp = Op & { level: string };

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
 * definition a glyph's symbol draws. A Cell Pin on a net that is no port of
 * its level, as at the file level, is a `$NET_LABEL` drawn with its port
 * symbol, since an `$IO_PORT` asserts its net is a port.
 */
const USAGE_PREFIX: Readonly<Record<string, string>> = {
  $GROUND: "gnd",
  $SUPPLY: "vdd",
  $IO_PORT: "port",
  $NET_LABEL: "port",
};

/**
 * The glyph symbols that show the name of their net (`netname`, 13.3). The
 * export writes a glyph's labels itself, so it hides that text where it
 * writes none in its place: `rnl-std-no-labels` leaves it shown.
 */
const NETNAME_SYMBOLS = new Set([
  "$NAMED_GROUND_SYMBOL",
  "$SUPPLY_SYMBOL",
  "$IO_PORT_SYMBOL",
  "$CANVAS_PORT_FILLED",
  "$NET_LABEL_SYMBOL",
]);

/**
 * The standard net label's turn whose one-unit lead leaves its pin toward
 * `away` (Analog Canvas axes, y down); unturned, the lead runs to −x.
 */
const LEAD_ORIENTS: Readonly<Record<string, RnlOrient>> = {
  "-1,0": "R0",
  "1,0": "MY",
  "0,1": "R90",
  "0,-1": "R270",
};

/**
 * The packages every file uses, a series 0.4 file bringing in none by itself
 * (16.3): the styles, and the symbols for every element SPICE and Spectre
 * read natively. A file names every other package it uses; the standard
 * fill (`rnl-std-fill`, in `rnl-std-all`) stays out, since the export draws
 * every glyph and label itself.
 */
const BASE_PACKAGES = [
  "rnl-std-style",
  "rnl-std-basic",
  "rnl-std-semiconductors",
] as const;

/**
 * The standard package that hides the labels symbols bring with them (name,
 * value, model), so a file shows only the labels it writes; the export
 * writes each of its own visible (`textvisible`). Formulas stay: Analog
 * Canvas shows them.
 */
const NO_LABELS_PACKAGE = "rnl-std-no-labels";

/**
 * The edit transaction's operations that draw a netlisted Project as Analog
 * Canvas draws it: each part's symbol, place and orientation, each block's
 * symbol, the ground, supply and Cell Pin glyphs, every wire with all its
 * bends and direction arrows, junctions and the dots Analog Canvas draws, the
 * contacts it makes by touching, its no-connect marks, its labels and texts,
 * the current and voltage marks on wires, and the drawing objects. The
 * header pins the standard series and every other package the drawing uses.
 *
 * `ir` is the IR the netlist was printed from (`includeIr`), with the body
 * port order `rnlBodyPortOrder` gives, so names and terminals match the file;
 * `format` is the netlist's dialect, whose escaped names RNL reads plain.
 */
export function rnlExportOps(
  project: CircuitProject,
  ir: DesignNetlistIR,
  format: NetlistFormat = "spice",
  /** The top is printed as the file's own cards, and drawn at the file level. */
  rootAsTopLevel = false,
  /** The netlist as printed: the models and subcircuits it ships. */
  netlist?: string,
): { ops: RnlOp[]; diagnostics: RnlExportDiagnostic[] } {
  const ops: RnlOp[] = [];
  const diagnostics: RnlExportDiagnostic[] = [];
  const packages = new Set<string>();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const blocks = blockSymbols(project, ir, resolver, format);
  const callSymbols = new Map<string, RnlSymbol>();
  const calledParts = new Set<string>();
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
      calledParts,
      level:
        rootAsTopLevel && cell.id === ir.topCellId
          ? "file"
          : `subckt:${cell.name}`,
    });
  }
  // The editor's top, where a Cell printed beside it calls it and so is the
  // netlist's top in its place.
  const calledTop =
    top &&
    !rootAsTopLevel &&
    ir.cells.some((cell) =>
      project.documents
        .find((document) => document.id === cell.id)
        ?.instances.some(
          (instance) =>
            instance.netlist?.binding?.kind === "subcircuit" &&
            instance.netlist.binding.childDocumentId === top.id,
        ),
    );
  if (top && calledTop) {
    packages.add(CANVAS_PACKAGE);
    ops.push({
      level: `subckt:${top.name}`,
      op: "add-usage",
      definition: "$CANVAS_TOP",
      attach: { level: "#" },
    });
  }
  const header: RnlOp[] = [
    ...BASE_PACKAGES,
    NO_LABELS_PACKAGE,
    ...[...packages]
      .filter(
        (name) =>
          !(BASE_PACKAGES as readonly string[]).includes(name) &&
          name !== NO_LABELS_PACKAGE,
      )
      .sort(),
  ].map((name) => ({
    level: top ? `subckt:${top.name}` : "",
    op: "use-package",
    name,
    version: name === CANVAS_PACKAGE ? CANVAS_PACKAGE_VERSION : RNL_STD_VERSION,
  }));
  if (netlist !== undefined)
    header.push(
      ...deviceDeclarations(project, ir, netlist).map((device) => ({
        level: top ? `subckt:${top.name}` : "",
        ...device,
      })),
    );
  const fileSymbols: RnlOp[] = [...blocks.externals.values()].map((symbol) => ({
    level: "file",
    op: "define-symbol",
    ...symbol,
  }));
  const inline = new Map(
    project.documents
      .flatMap((document) =>
        [
          ...document.instances,
          ...(document.drafting?.objects ?? []).filter(
            (object) => object.kind === "floating-symbol",
          ),
        ]
          // A part drawn with a call symbol needs no library one.
          .filter((instance) => !calledParts.has(partKey(document, instance))),
      )
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

/**
 * The kind of each device the netlist calls a model or subcircuit of that
 * the file does not ship (a PDK's MOSFET, bipolar transistor or diode), as
 * Analog Canvas knows it from the part's symbol: one `@DEVICE` of the header
 * per such master (6.12), with its type and, for a call whose terminals its
 * card does not name (`X`), their names, where every part calling it says
 * the same. Meaning only: readers type the instances by it.
 */
function deviceDeclarations(
  project: CircuitProject,
  ir: DesignNetlistIR,
  netlist: string,
): Extract<Op, { op: "declare-device" }>[] {
  const shipped = new Set(
    netlist.split(/\r?\n/u).flatMap((line) => {
      const found =
        /^\s*\.?(?:model|subckt|inline\s+subckt)\s+([^\s(]+)/iu.exec(line);
      return found ? [found[1]!.toLowerCase()] : [];
    }),
  );
  const found = new Map<
    string,
    { model: string; type: string | null; terminals: string[] | null }
  >();
  for (const cell of ir.cells) {
    if (cell.origin === "generated-model") continue;
    const document = project.documents.find((item) => item.id === cell.id);
    for (const call of cell.instances) {
      const model = call.target;
      if (!model || shipped.has(model.toLowerCase())) continue;
      const instance = document?.instances.find((item) => item.id === call.id);
      const type = instance
        ? symbolModelType(instance.symbolId, project)
        : undefined;
      if (!instance || !type) continue;
      // An X card names its terminals as its subcircuit's ports, which the
      // file does not hold: by the symbol's terminal at each position, where
      // the call prints each pin at its own.
      const row = rnlSymbolForPart(instance, project);
      const terminals =
        call.invocationKind === "subcircuit" &&
        row &&
        call.nodes.length <= row.terminals.length &&
        row.pins.every(
          (pin) =>
            pin.terminal > call.nodes.length ||
            (call.nodes[pin.terminal - 1]?.canvasPinName ??
              call.nodes[pin.terminal - 1]?.pinName) === pin.acPin,
        )
          ? call.nodes.map((_, index) => row.terminals[index]!.name)
          : null;
      const key = model.toLowerCase();
      const before = found.get(key);
      if (!before) {
        found.set(key, { model, type, terminals });
        continue;
      }
      if (before.type !== type) before.type = null;
      if (before.terminals?.join(" ") !== terminals?.join(" "))
        before.terminals = null;
    }
  }
  return [...found.values()].flatMap(({ model, type, terminals }) =>
    type
      ? [
          {
            op: "declare-device" as const,
            model,
            ...(terminals ? { terminals } : {}),
            type,
          },
        ]
      : [],
  );
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
  /** The level the Cell's drawing goes to: its subcircuit, or the file level. */
  level?: string;
  /** Library artwork defined for calls that print its pins in another order, by name. */
  callSymbols: Map<string, RnlSymbol>;
  /** The parts drawn with one of those (`partKey`). */
  calledParts: Set<string>;
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
      // Canvas 0.7 names only the serif; the other faces await a version.
      face: [
        presentation.textFace === "serif" ? "serif" : undefined,
        undefined,
      ],
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

/**
 * The parameters of a part the editor keeps and its card does not print: a
 * source's fields of the waveforms it is not set to, and its waveform where
 * that is dc, which a card without one is; any other part's parameters its
 * card has none of, such as an op-amp's rails, which choose its body.
 */
function unprintedParameters(
  cell: DesignNetlistCell,
  instance: Instance,
): { name: string; text: string }[] {
  const printed = cell.instances.find((item) => item.id === instance.id);
  if (!printed) return [];
  const fields = unprintedSourceFields(printed);
  const names = new Set(
    printed.parameters.map((item) => item.name.toLowerCase()),
  );
  return Object.entries(instance.netlist?.parameters ?? {}).flatMap(
    ([name, text]) => {
      const folded = name.toLowerCase();
      const unprinted = fields
        ? fields.has(folded) ||
          (folded === "waveform" && text.trim().toLowerCase() === "dc")
        : !names.has(folded);
      return unprinted ? [{ name, text }] : [];
    },
  );
}

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
  if (source && spectreSourceFromText(printed.parameters)) return scaled;
  const waveform = source
    ? normalizeIndependentSource(printed.parameters).transient.kind
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
      (waveform && spectreSourceFieldName(name, waveform) === null)
    )
      return [];
    const written = waveform
      ? (spectreSourceFieldName(name, waveform) ?? name)
      : letter && name === "value"
        ? letter
        : name;
    return [{ name: written, text: rawValue }];
  });
  return [...scaled, ...rest];
}

/** A part's key across the project: its id is unique within its Document only. */
const partKey = (document: SchematicDocument, part: { id: StableId }) =>
  `${document.id}\u0000${part.id}`;

function exportCell(
  document: SchematicDocument,
  cell: DesignNetlistCell,
  context: ExportContext,
): void {
  const { ops, diagnostics, packages, blocks } = context;
  const level = context.level ?? `subckt:${cell.name}`;

  // The Cell's own block symbol: how every call of it is drawn (9.2.6). The
  // file level is no subcircuit, and nothing calls it.
  const own = level === "file" ? undefined : blocks.cells.get(document.id);
  if (own)
    ops.push(
      { level, op: "define-symbol", ...own },
      { level, op: "set", object: "#", symbol: own.name },
    );
  // How the Cell sets names in its labels, each setting other than Analog
  // Canvas's default, none included, so the import knows the Cell keeps
  // the default: in its own record, which reaches no other Cell.
  packages.add(CANVAS_PACKAGE);
  ops.push({
    level,
    op: "add-usage",
    definition: "$CANVAS_TYPESETTING",
    attach: { level: "#" },
    params: canvasTypesetting(document.presentation),
  });
  // The Cell's own name, where the netlist must write it otherwise: a
  // subcircuit name has no spaces.
  if (document.netlist?.name && document.netlist.name !== cell.name)
    ops.push({
      level,
      op: "add-usage",
      definition: "$CANVAS_CELL_NAME",
      attach: { level: "#" },
      params: { name: document.netlist.name },
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
  /** The glyphs drawn, by usage name: the symbol each is drawn with. */
  const glyphSymbols = new Map<string, string>();
  /** Where each drawn part or glyph is registered, and the name RNL knows it by. */
  const placeOf = new Map<StableId, { object: string; at: RnlPoint }>();
  for (const instance of document.instances) {
    let symbol = rnlSymbolForPart(instance, context.project);
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
    const placement = instance.placement;
    if (symbol && placement && placement.rotation % 90 === 45)
      symbol = rnlDiagonalSymbolFor(symbol) ?? symbol;
    const call = cell.instances.find(
      (candidate) => candidate.id === instance.id,
    );
    // A Library part bound to a Cell or an external definition meets its
    // Pins by name (#1450, #1928); a reviewed standard cell keeps its own
    // order, and a Circuit Component its own mapping.
    const gate =
      call?.invocationKind === "subcircuit" &&
      (binding?.kind === "subcircuit"
        ? bindsProjectCell(instance.symbolId)
        : binding?.kind === "external-subcircuit" &&
          !call.reviewedExternalBindingId &&
          bindsExternalByPartPins(context.project, instance.symbolId))
        ? matchGateCellPins(instance.symbolId, {
            name: call.target ?? "",
            portNames: call.nodes.map((node) => node.pinName),
          })
        : undefined;
    // A symbol the file defines takes a call symbol only on such a Cell.
    if (
      symbol &&
      call?.invocationKind === "subcircuit" &&
      (!inlineInterface(symbol) || gate?.ok)
    ) {
      // A Library block's call names its ports, as its contract does (a
      // DAC's VIN is its pin IN).
      const ports = call.target
        ? builtInModelContract(plainBodyName(context.ir, call.target))?.ports
        : undefined;
      const ordered = symbolForCall(
        symbol,
        call,
        gate
          ? (node) =>
              gate.pins.find((pin) => pin.portName === node.pinName)?.pinName
          : ports
            ? (node) =>
                node.canvasPinName ??
                ports.find((port) => port.name === node.pinName)?.pinName ??
                node.pinName
            : undefined,
      );
      if (ordered !== symbol) {
        if (ordered.inline) {
          context.callSymbols.set(ordered.symbol, ordered);
          context.calledParts.add(partKey(document, instance));
        }
        symbol = ordered;
      }
    }
    // Elsewhere it binds the call's terminals in its own order.
    if (
      symbol &&
      inlineInterface(symbol) &&
      call &&
      !gate?.ok &&
      !context.calledParts.has(partKey(document, instance))
    ) {
      const descriptor = subcircuitDescriptor(
        instance.symbolId,
        context.project,
      );
      // A device symbol's terminals are its reviewed device's (#2321).
      const device = inlineRnlDeviceMaster(symbol);
      const reviewed = device
        ? reviewedExternalBindingForMaster(device, instance.symbolId)
        : undefined;
      const portName = (acPin: string) =>
        device
          ? call.reviewedExternalBindingId === reviewed?.id
            ? reviewed?.terminals.find((terminal) => terminal.pinName === acPin)
                ?.targetName
            : undefined
          : descriptor?.ports.find((port) => port.pinName === acPin)?.name;
      if (
        symbol.pins.some(
          (pin) =>
            call.nodes[pin.terminal - 1]?.pinName !== portName(pin.acPin),
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
    if (!instance.placement) {
      report(
        "warning",
        "RNL_NOT_PLACED",
        `${describe(instance)} is not placed on the drawing; RNL leaves it without a position`,
        [instance.id],
      );
    }
    let orient: RnlOrient | undefined;
    if (placement) {
      const result = rnlOrient(placement, symbol?.baseRotation);
      if (!result.ok) {
        report(
          "error",
          "RNL_ROTATION_NOT_QUARTER",
          `${describe(instance)} is turned ${placement.rotation}° and has no matching diagonal RNL symbol`,
          [instance.id],
        );
        continue;
      }
      orient = result.orient;
    }
    if (symbol?.package === CANVAS_PACKAGE)
      report(
        "warning",
        "RNL_NOT_STANDARD_SYMBOL",
        `${describe(instance)} is drawn with ${symbol.symbol} from the ${CANVAS_PACKAGE} package, not the standard package`,
        [instance.id],
      );
    if (symbol && !symbol.inline) packages.add(symbol.package);
    // Its colour: its lines and the labels it brings, which RNL gives the
    // style of their part (11.3), as the editor gives a label its Instance's.
    const foreground = instance.styleOverride?.foreground;
    // Its line width, where the Document draws symbols thinner or thicker
    // than Analog Canvas's own (RNL's linewidth, 9.3).
    const symbolScale =
      document.presentation.styleOverrides?.symbolStrokeScale ?? 1;
    const paintStyle: Record<string, string | number> = {
      ...(foreground ? { linecolor: foreground, textcolor: foreground } : {}),
      ...(symbolScale !== 1
        ? {
            linewidth: rnlLength(
              resolveDocumentStyleProfile(document.presentation).strokes.symbol,
            ),
          }
        : {}),
    };
    const paint = Object.keys(paintStyle).length ? { style: paintStyle } : {};
    if (instance.styleOverride?.background)
      report(
        "warning",
        "RNL_BACKGROUND_NOT_EXPORTED",
        `${describe(instance)} is painted with a background, which RNL draws no fill behind a symbol for`,
        [instance.id],
      );
    const mapped = symbol;
    // A pin the part shows that its RNL symbol draws none for, as an op-amp's
    // shown supply on $OPAMP (#1833): RNL fails a wire to a terminal
    // with no pin (9.2.4), so none is written; the netlist still joins it.
    const unwritten = (mapped?.undrawnPins ?? []).filter((pin) =>
      reached.has(`${instance.id}\u0000${pin.acPin}`),
    );
    if (unwritten.length)
      report(
        "warning",
        "RNL_PIN_NOT_DRAWN",
        `${describe(instance)} has a wire on ${unwritten.map((pin) => pin.acPin).join(" and ")}, which RNL's ${mapped!.symbol} draws no pin for; the wire is left out, and the netlist still joins it`,
        [instance.id],
      );
    // A card that prints its two pins the other way round (a coupled
    // inductor starts at its dotted end): RNL binds the symbol's pins in the
    // card's order, so the symbol is turned over onto itself, each terminal
    // where the card prints its pin.
    const swap = mapped && call ? cardSwap(mapped, call.nodes) : undefined;
    terminalsOf.set(
      instance.id,
      mapped
        ? (pin) =>
            unwritten.some((item) => item.acPin === pin)
              ? undefined
              : swap
                ? swap.terminalOf(pin)
                : terminalOfPin(mapped, pin)
        : block!,
    );
    const where =
      placement && orient
        ? {
            at: rnlPlace(placement.position, orient, symbol?.offset ?? [0, 0]),
            // a drawing that is the symbol flipped turns with the part
            orient: composeOrient(
              orient,
              composeOrient(symbol?.orient ?? "R0", swap?.flip ?? "R0"),
            ),
          }
        : {};
    const glyph = symbol?.definition;
    if (symbol && glyph && USAGE_PREFIX[glyph]) {
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
      const name = nextName(USAGE_PREFIX[glyph]!);
      usageOf.set(instance.id, name);
      glyphSymbols.set(name, symbol.symbol);
      if (where.at) placeOf.set(instance.id, { object: name, at: where.at });
      // A port tag asserts its net is a port of its level (12.4): a Cell
      // Pin on any other net, as at the file level, is a net label drawn
      // with the port's symbol.
      const definition =
        glyph === "$IO_PORT" &&
        (level === "file" ||
          !cell.ports.some((port) => plain(port.name) === net))
          ? "$NET_LABEL"
          : glyph;
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
    // A package symbol's pins bind the terminals of their names (9.2.4). A
    // SPICE card's letter names its terminals as the symbol does (M1's d g s
    // b), but a call names them as its subcircuit's ports, and a Spectre
    // instance of a master (a model or a subcircuit) as the master does,
    // which the file need not hold: there each pin is bound to the position
    // the card prints it at (`@SET-SYMBOL(terminals=)`, 11.3). A symbol the
    // file defines binds by position itself.
    const named =
      call?.invocationKind === "subcircuit" ||
      (context.format === "spectre" && call?.target != null);
    const bound =
      symbol && !symbol.inline && named
        ? symbol.pins.flatMap(({ terminal }): [number, string][] =>
            terminal <= call.nodes.length
              ? [[terminal, symbol.terminals[terminal - 1]!.name]]
              : [],
          )
        : [];
    const settings = {
      ...(symbol
        ? { symbol: symbol.symbol }
        : blockSymbol && binding?.kind === "external-subcircuit"
          ? { symbol: blockSymbol.name }
          : {}),
      ...(bound.length ? { terminals: bound } : {}),
      ...paint,
      ...where,
    };
    // A Cell's call in the tray, drawn with its Cell's own symbol, has
    // nothing to set, which RNL refuses.
    if (Object.keys(settings).length)
      ops.push({ level, op: "set", object, ...settings });
    // Record the Canvas symbol where two parts share diagonal artwork or a
    // mirrored part could reopen as a different symbol without a mirror.
    const drawnOrient = where.orient;
    const variantSymbolId = symbol?.baseRotation
      ? (symbol.ac ?? instance.symbolId)
      : instance.symbolId;
    if (
      symbol &&
      (symbol.baseRotation || orient?.startsWith("M")) &&
      drawnOrient &&
      RNL_SYMBOLS.some(
        (other) =>
          other.symbol === symbol.symbol &&
          other.ac !== null &&
          other.ac !== variantSymbolId &&
          (symbol.baseRotation ||
            !composeOrient(drawnOrient, inverseOrient(other.orient)).startsWith(
              "M",
            )),
      )
    ) {
      packages.add(CANVAS_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_VARIANT",
        attach: { part: object },
        params: { symbol: variantSymbolId },
      });
    }
    // The part's own name, where the netlist spells it otherwise: SPICE
    // starts a subcircuit call's card with X, so M1 prints as XM1.
    if (instance.reference && instance.reference !== reference) {
      packages.add(CANVAS_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_NAME",
        attach: { part: object },
        params: { name: instance.reference },
      });
    }
    // A part the author never named, which the netlist must name to print
    // its card.
    if (!instance.reference) {
      packages.add(CANVAS_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_UNNAMED",
        attach: { part: object },
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
      packages.add(CANVAS_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_PARAMETER_TEXT",
        attach: { part: object },
        params: { name, text },
      });
    }
    // Each parameter the editor keeps that the card does not print, by the
    // editor's name for it.
    for (const { name, text } of unprintedParameters(cell, instance)) {
      packages.add(CANVAS_PACKAGE);
      ops.push({
        level,
        op: "add-usage",
        definition: "$CANVAS_PARAMETER",
        attach: { part: object },
        params: { name, text },
      });
    }
  }

  const pointOfEndpoint = (endpoint: RouteEndpoint) =>
    resolveEndpointPoint(document, context.resolver, endpoint);

  // A pin left open on purpose: the standard no-connect mark on its
  // terminal (12.6), a part's own or the one a Cell's call prints a bus
  // member on; its reason is a comment on the same (`$COMMENT`,
  // rnl-std-basic). A glyph's pin is open only on a glyph on no net, which
  // RNL does not draw (`RNL_GLYPH_UNCONNECTED`), so its mark has nothing to
  // stand on.
  const memberTerminal = (instanceId: StableId, memberId: string) => {
    const binding = document.instances.find((item) => item.id === instanceId)
      ?.netlist?.binding;
    if (binding?.kind !== "subcircuit") return undefined;
    // The child prints each member as a port of its own, keyed by the
    // member's Net.
    const member = context.project.documents
      .find((item) => item.id === binding.childDocumentId)
      ?.netlist?.terminals.flatMap((terminal) => terminal.signal?.members ?? [])
      .find((item) => item.id === memberId);
    const index =
      context.ir.cells
        .find((item) => item.id === binding.childDocumentId)
        ?.ports.findIndex((port) => port.id === member?.netId) ?? -1;
    return member && index >= 0 ? index + 1 : undefined;
  };
  for (const mark of document.noConnects) {
    const { instanceId, pinName, memberId } = mark.endpoint;
    const reference = usageOf.has(instanceId)
      ? undefined
      : references.get(instanceId);
    const terminal =
      memberId === undefined
        ? terminalsOf.get(instanceId)?.(pinName)
        : memberTerminal(instanceId, memberId);
    if (!reference || terminal === undefined) {
      const pin = `${references.get(instanceId) ?? instanceId}:${pinName}`;
      report(
        "warning",
        "RNL_NO_CONNECT_UNNAMED",
        `The no-connect mark on ${pin} is on a pin RNL cannot name (a glyph's, whose glyph is on no net); it is left out`,
        [mark.id],
      );
      continue;
    }
    const marked = `${rnlName("#", reference)}:${terminal}`;
    // A usage has a point of its own (12.1), placed on its terminal's pin,
    // which the definition's alignment alone leaves to a solver.
    const at = pointOfEndpoint(mark.endpoint);
    ops.push({
      level,
      op: "add-usage",
      definition: "$NO_CONNECT",
      attach: { t: marked },
      ...(at ? { at: toRnlPoint(at) } : {}),
    });
    if (!mark.reason) continue;
    // A record holds no line break: such a reason is written on one line.
    const reason = mark.reason.replace(/\s*[\r\n]+\s*/gu, " ");
    if (reason !== mark.reason)
      report(
        "warning",
        "RNL_NO_CONNECT_REASON",
        `The no-connect mark on ${marked}'s reason is written on one line, as an RNL record holds no line break`,
        [mark.id],
      );
    ops.push({
      level,
      op: "add-usage",
      definition: "$COMMENT",
      attach: { target: [marked] },
      params: { text: reason },
    });
  }

  // A net label hung on the junction at a wire's open end (one wire ends
  // there, or none) is the standard tag there, as the import reads a
  // `$NET_LABEL`: its one-unit lead toward the name, the wire ending on its
  // pin. One on a branch stays a label.
  /** How many wire arms meet each junction: two where a route runs through. */
  const armsAt = new Map<StableId, number>();
  const arm = (endpoint: RouteEndpoint, arms: number) => {
    if (endpoint.kind === "junction")
      armsAt.set(
        endpoint.junctionId,
        (armsAt.get(endpoint.junctionId) ?? 0) + arms,
      );
  };
  for (const route of document.routes) {
    arm(route.start, 1);
    route.legs.forEach((leg, index) => {
      if (leg.to.kind === "endpoint")
        arm(leg.to.endpoint, index === route.legs.length - 1 ? 1 : 2);
    });
  }
  const tagAt = new Map<
    StableId,
    { object: string; at: RnlPoint; away: { x: number; y: number } }
  >();
  const tagOf = new Map<StableId, { object: string; at: RnlPoint }>();
  for (const annotation of document.annotations) {
    const anchor = annotation.anchor;
    if (annotation.kind !== "net-label" || anchor.kind !== "object") continue;
    const junction = document.junctions.find(
      (item) => item.id === anchor.objectId,
    );
    const net = annotation.netId ? netOf(annotation.netId) : undefined;
    if (
      !junction ||
      !net ||
      tagAt.has(junction.id) ||
      (armsAt.get(junction.id) ?? 0) > 1
    )
      continue;
    const { x, y } = anchor.localOffset;
    const away =
      Math.abs(x) >= Math.abs(y) && x
        ? { x: Math.sign(x), y: 0 }
        : y
          ? { x: 0, y: Math.sign(y) }
          : { x: -1, y: 0 };
    const name = nextName(USAGE_PREFIX["$NET_LABEL"]!);
    const at = toRnlPoint(junction.position);
    tagAt.set(junction.id, { object: name, at, away });
    tagOf.set(annotation.id, { object: name, at });
    glyphSymbols.set(name, "$NET_LABEL_SYMBOL");
    ops.push({
      level,
      op: "add-usage",
      name,
      definition: "$NET_LABEL",
      attach: { p: rnlName("&", net) },
      symbol: "$NET_LABEL_SYMBOL",
      at,
      orient: LEAD_ORIENTS[`${away.x},${away.y}`]!,
    });
  }

  // Junctions are named points; the dots come below.
  const pointOf = new Map<StableId, string>();
  const pointAt = new Map<string, RnlPoint>();
  for (const junction of document.junctions) {
    if (tagAt.has(junction.id)) continue;
    const name = nextName("j");
    pointOf.set(junction.id, name);
    pointAt.set(name, toRnlPoint(junction.position));
    ops.push({ level, op: "add-point", name, at: pointAt.get(name)! });
  }

  const vertex = (endpoint: RouteEndpoint): Vertex | undefined => {
    if (endpoint.kind === "junction") {
      const tag = tagAt.get(endpoint.junctionId)?.object;
      if (tag) return { owner: tag, pin: 0, reference: `${tag}::pin` };
      const point = pointOf.get(endpoint.junctionId);
      return point ? { point } : undefined;
    }
    // A glyph's wire reaches its symbol's pin, `%pin` (9.2.4).
    const usage = usageOf.get(endpoint.instanceId);
    if (usage) return { owner: usage, pin: 0, reference: `${usage}::pin` };
    const reference = references.get(endpoint.instanceId);
    const terminal = terminalsOf.get(endpoint.instanceId)?.(endpoint.pinName);
    return reference && terminal
      ? { terminal: `${rnlName("#", reference)}:${terminal}` }
      : undefined;
  };

  // A wire that runs through a contact without ending there (a T joint) is
  // joined there in Analog Canvas; RNL joins only at the vertices a wire
  // lists, so the contact's point or pin goes into its list where it passes.
  // A junction other routes end at is joined only to them: Analog Canvas
  // joins only what a route reaches, so a route drawn over it passes it, as
  // the import reads a wire listing it as two routes ending there. A body
  // tie, dashed, ends on the wire it ties to without splitting it.
  const dashed = (route: (typeof document.routes)[number]) =>
    (route.styleOverride?.lineStyle ??
      (route.presentation === "bulk-dashed" ? "dashed" : undefined)) ===
    "dashed";
  const reachedJunctions = new Set(
    document.routes
      .filter((route) => !dashed(route))
      .flatMap((route) => [
        route.start,
        ...route.legs.flatMap((leg) =>
          leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
        ),
      ])
      .flatMap((endpoint) =>
        endpoint.kind === "junction" ? [endpoint.junctionId] : [],
      ),
  );
  const through = new Map<
    StableId,
    { point: { x: number; y: number }; vertex: Vertex }[]
  >();
  for (const contact of evidence.contacts) {
    const own = contact.endpoints.map(vertex).find((item) => item);
    if (!own) continue;
    if (
      contact.endpoints.every((endpoint) => endpoint.kind === "junction") &&
      contact.endpoints.some(
        (endpoint) =>
          endpoint.kind === "junction" &&
          reachedJunctions.has(endpoint.junctionId),
      )
    )
      continue;
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
  const routing = resolveDocumentRoutingGeometry(document, context.resolver);
  const profile = resolveDocumentStyleProfile(document.presentation);

  // The routes a net's or power label hangs on: their wires are named, for
  // the label to attach to (13.3).
  const hungOn = new Set(
    document.annotations.flatMap((annotation) =>
      (annotation.kind === "net-label" || annotation.kind === "power-label") &&
      annotation.anchor.kind === "route"
        ? [annotation.anchor.routeId]
        : [],
    ),
  );
  const wireOf = new Map<StableId, string>();

  // Wires, every bend written, so RNL draws them as drawn.
  for (const route of document.routes) {
    const net = netOf(route.netId);
    const corners = [
      { place: pointOfEndpoint(route.start), vertex: vertex(route.start) },
      ...route.legs.map((leg) =>
        leg.to.kind === "bend"
          ? {
              place: leg.to.position,
              vertex: { at: toRnlPoint(leg.to.position) } as Vertex,
            }
          : {
              place: pointOfEndpoint(leg.to.endpoint),
              vertex: vertex(leg.to.endpoint),
            },
      ),
    ];
    const via: (Vertex | undefined)[] = [];
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
    const style: Record<string, string | number> = {};
    if (route.presentation === "bulk-dashed") style.linestyle = "dashed";
    if (route.presentation === "power-rail") style.linestyle = "bold";
    // A wire as wide as the Document draws wires, where that is not Analog
    // Canvas's own width (RNL's linewidth, 9.3).
    else if ((document.presentation.styleOverrides?.wireStrokeScale ?? 1) !== 1)
      style.linewidth = rnlLength(
        resolveDocumentStyleProfile(document.presentation).strokes.wire,
      );
    if (route.styleOverride?.lineStyle)
      style.linestyle = route.styleOverride.lineStyle;
    if (route.styleOverride?.color) style.linecolor = route.styleOverride.color;
    const wire = hungOn.has(route.id) ? nextName("wire") : undefined;
    if (wire) wireOf.set(route.id, wire);
    ops.push({
      level,
      op: "add-wire",
      ...(wire ? { name: wire } : {}),
      nets: [rnlName("&", net)],
      via: via as Vertex[],
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
        `Wire ${route.id} shows a direction arrow on a run of no length, which RNL cannot turn to`,
        [route.id],
      );
      continue;
    }
    ops.push(
      arrowHead(level, nextName("arrow"), arrow.at, arrow.rotate, "$ARROW"),
    );
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
          via: via as Vertex[],
          mode: "straight",
        });
    }
    // A tag's lead is one more branch where it stands, as RNL draws it.
    const lead = contact.endpoints.flatMap((endpoint) =>
      endpoint.kind === "junction" && tagAt.has(endpoint.junctionId)
        ? [tagAt.get(endpoint.junctionId)!.away]
        : [],
    )[0];
    const branches = new Set(
      [...contact.branchDirections, ...(lead ? [lead] : [])].map(
        (direction) => `${Math.sign(direction.x)},${Math.sign(direction.y)}`,
      ),
    );
    if (!contactRequiresJunctionDot(contact) && branches.size < 3) continue;
    // A dot is a usage placed on its point (12.1): on the junction's named
    // point, else on the contact's.
    const junction = contact.endpoints.find(
      (endpoint) =>
        endpoint.kind === "junction" && pointOf.has(endpoint.junctionId),
    );
    const point =
      junction?.kind === "junction" ? pointOf.get(junction.junctionId) : null;
    const at =
      (point ? pointAt.get(point) : undefined) ?? toRnlPoint(contact.point);
    ops.push({
      level,
      op: "add-usage",
      name: nextName("dot"),
      definition: "$JUNCTION",
      attach: { p: point ?? at },
      at,
    });
  }

  const named = exportTexts(document, level, {
    context,
    logical,
    routing,
    placeOf,
    tagOf,
    wireOf,
    netOf,
    nextName,
    report,
    references,
  });
  // A glyph's own net name, where the export writes no label in its place:
  // hidden, as Analog Canvas draws the labels it shows itself (9.3).
  for (const [glyph, symbol] of glyphSymbols)
    if (NETNAME_SYMBOLS.has(symbol) && !named.has(glyph))
      ops.push({
        level,
        op: "add-text",
        attach: glyph,
        key: "netname",
        markup: "${p}",
        style: { textvisible: false },
      });
}

/**
 * Where the arrow head of a wire's direction arrow goes, and how it turns:
 * Analog Canvas puts the head's tip at the middle or the end of the wire's
 * run, on the segment it reaches there, and the arrow symbol is centred on
 * its point, its tip half a head ahead. Null on a run of no length.
 */
function wireArrow(
  centerline: readonly { x: number; y: number }[],
  placement: "middle" | "end",
  headLength: number,
): { at: RnlPoint; rotate: number } | null {
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
  const back = along - headLength / 2;
  return {
    at: toRnlPoint({
      x: segment.from.x + ux * back,
      y: segment.from.y + uy * back,
    }),
    // Counter-clockwise, y up (RNL's axes).
    rotate: turnOf(Math.atan2(-uy, ux)),
  };
}

/** An angle in radians as RNL's turn in degrees, from 0 below 360. */
function turnOf(radians: number): number {
  const degrees = ((((radians * 180) / Math.PI) % 360) + 360) % 360;
  const rounded = Math.round(degrees * 1e6) / 1e6 + 0;
  return rounded === 360 ? 0 : rounded;
}

/**
 * An arrow head on a point: at a quarter turn a mark of `definition` turned
 * by its orientation (`$ARROW`, `$CURRENT_ARROW` drawn with the full-size
 * `$ARROW_SYMBOL`), at any other angle the arrow symbol's graphics as an
 * annotation turned to it (13.5), named as the mark would be, which draws
 * nothing else and means nothing.
 */
function arrowHead(
  level: string,
  name: string,
  at: RnlPoint,
  rotate: number,
  definition: "$ARROW" | "$CURRENT_ARROW",
): RnlOp {
  if (rotate % 90 !== 0)
    return {
      level,
      op: "add-annotation",
      name,
      source: "$ARROW_SYMBOL",
      at,
      rotate,
    };
  return {
    level,
    op: "add-usage",
    name,
    definition,
    attach: definition === "$ARROW" ? { at } : { p: at },
    ...(definition === "$CURRENT_ARROW" ? { symbol: "$ARROW_SYMBOL" } : {}),
    at,
    orient: `R${rotate}` as RnlOrient,
  };
}

/** A text's size in RNL units: Analog Canvas's em height, ten to a unit. */
const rnlSize = (fontSize: number) =>
  Math.round((fontSize / AC_UNITS_PER_RNL_UNIT) * 1e4) / 1e4;

/** RNL's counter-clockwise turn (13.3) for an Analog Canvas clockwise rotation. */
function textTurn(rotation: number): number {
  const turn = (((360 - rotation) % 360) + 360) % 360;
  return Math.round(turn * 1e6) / 1e6 + 0;
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
 * Every text says its weight, which the standard style makes bold (9.3), and
 * a keyed one that it is shown, which `rnl-std-no-labels` hides. Returns the
 * glyphs a label of their net's name (`netname`) is written on.
 */
function exportTexts(
  document: SchematicDocument,
  level: string,
  {
    context,
    logical,
    routing,
    placeOf,
    tagOf,
    wireOf,
    netOf,
    nextName,
    report,
    references,
  }: {
    context: ExportContext;
    logical: ReturnType<typeof resolveDocumentLogicalNets>;
    routing: ResolvedDocumentRoutingGeometry;
    placeOf: ReadonlyMap<StableId, { object: string; at: RnlPoint }>;
    /** The net label tag each net label hung on a junction names. */
    tagOf: ReadonlyMap<StableId, { object: string; at: RnlPoint }>;
    /** The wire each route a label hangs on is written as. */
    wireOf: ReadonlyMap<StableId, string>;
    netOf: (baseNetId: string) => string | undefined;
    nextName: (prefix: string) => string;
    report: (
      severity: RnlExportDiagnostic["severity"],
      code: string,
      message: string,
      objectIds: StableId[],
    ) => void;
    /** The name the netlist prints each part with. */
    references: ReadonlyMap<StableId, string | undefined>;
  },
): Set<string> {
  const { ops, resolver } = context;
  const netnames = new Set<string>();
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
    context.packages.add(CANVAS_PACKAGE);
    ops.push({
      level,
      op: "add-usage",
      definition: "$CANVAS_LABEL",
      attach: { label },
      params,
    });
  };
  // A drawing text's typography role, which RNL has no form for, on the
  // text, named for it; its size is written as well.
  const typeset = (text: string, token: string | undefined) => {
    if (!token) return;
    context.packages.add(CANVAS_PACKAGE);
    ops.push({
      level,
      op: "add-usage",
      definition: "$CANVAS_TYPOGRAPHY",
      attach: { text },
      params: { token },
    });
  };
  /**
   * A text, at the turn Analog Canvas gives it, any angle (0.4). Analog
   * Canvas turns a text's glyphs with it and never turns them back to read
   * from below (`upright=false`), but for a drawing text it sets level at a
   * turn it keeps as the bearing of its layout (`level`), whose glyphs RNL
   * then turns: those keep RNL's own reading (`upright`) and are reported.
   * A hidden label is written hidden (`textvisible=false`).
   */
  const write = (
    id: StableId,
    text: Parameters<typeof rnlTextLines>[0],
    rotation: number,
    fields: Omit<
      Extract<RnlOp, { op: "add-text" }>,
      "level" | "op" | "lines" | "rotate"
    >,
    { level: setLevel = false, hidden = false } = {},
  ) => {
    const { lines, formulas: count } = rnlTextLines(text);
    if (count) formulas.push(id);
    const turn = textTurn(rotation);
    if (turn && setLevel) tilted.push(id);
    ops.push({
      level,
      op: "add-text",
      lines,
      ...fields,
      ...(turn
        ? { rotate: turn, ...(setLevel ? {} : { upright: false }) }
        : {}),
      style: {
        ...shownStyle(fields),
        ...(hidden ? { textvisible: false } : {}),
      },
    });
  };

  for (const annotation of document.annotations) {
    // A hidden label is written hidden, where it stands, with what it says
    // (`textvisible=false`, 9.3); a hidden marker, whose arrow or signs RNL
    // cannot hide, is left out.
    const concealed = annotation.visible === false;
    if (concealed && annotation.kind === "route-marker") {
      hidden.push(annotation.id);
      continue;
    }
    // A part the author never named shows its name label empty; it is
    // written with the name the netlist gives the part, which the import,
    // told the part is unnamed, binds to its name again.
    const named =
      annotation.binding?.kind === "instance-reference"
        ? annotation.binding.instanceId
        : undefined;
    const unnamed =
      named &&
      !document.instances.find((instance) => instance.id === named)?.reference
        ? references.get(named)
        : undefined;
    const text = unnamed
      ? labelTextDocument(unnamed, document.presentation)
      : resolveAnnotationText(document, annotation, logical, resolver);
    if (
      !isSchematicAnnotationVisible(
        document,
        concealed ? { ...annotation, visible: true } : annotation,
        logical,
        text,
        resolver,
      )
    )
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
        // The arrow's head alone, on the wire that is its shaft (15.2), the
        // full-size head Analog Canvas draws (the standard rule draws it at
        // half size); the label stands centred beside it, level, as Analog
        // Canvas draws it. At any other than a quarter turn the head is an
        // annotation, which a text cannot hang on: the label is named for it.
        const name = nextName("current");
        const rotate = textTurn(marker.rotation);
        const head = arrowHead(
          level,
          name,
          toRnlPoint(marker.position),
          rotate,
          "$CURRENT_ARROW",
        );
        ops.push(head);
        const onAnnotation = head.op === "add-annotation";
        write(annotation.id, text, 0, {
          ...common,
          halign: "middle",
          ...(onAnnotation ? { name: `${name}_label` } : { attach: name }),
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
            style: shownStyle(common),
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
      // A glyph's name label is the name of its net its symbol shows
      // (`netname`, 13.3), which the label takes the place of.
      const key =
        binding?.kind === "instance-value" && binding.parameter
          ? binding.parameter
          : annotation.kind === "instance-label"
            ? owner.object.startsWith("%")
              ? "netname"
              : "name"
            : "value";
      if (key === "netname") netnames.add(owner.object);
      write(
        annotation.id,
        text,
        shown.rotation,
        {
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
        },
        { hidden: concealed },
      );
      bindLabel(`${owner.object}::${key}`, binding);
      continue;
    }
    // A net label hung on a junction is the name of its tag (`netname`),
    // offset from it, as a glyph's name label is.
    const tag = tagOf.get(annotation.id);
    if (tag) {
      netnames.add(tag.object);
      write(
        annotation.id,
        text,
        shown.rotation,
        {
          ...common,
          valign: "baseline",
          attach: tag.object,
          key: "netname",
          offset: [
            Math.round((anchor[0] - tag.at[0]) * 1e6) / 1e6 + 0,
            Math.round((anchor[1] - tag.at[1]) * 1e6) / 1e6 + 0,
          ],
        },
        { hidden: concealed },
      );
      bindLabel(`${tag.object}::netname`, binding);
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
    // import makes it one again, as it does an instance label that stands
    // free of any part. A bound net label is named to say so.
    const name =
      annotation.kind === "power-label" && net
        ? nextName("power")
        : net && canvasLabel(binding)
          ? nextName("label")
          : annotation.kind === "instance-label" && !net && !binding
            ? nextName("free_label")
            : undefined;
    // Where it hangs (13.3): on the wire of its route, placed where it
    // stands, since a wire has no point to offset from; on the part, glyph
    // or Cell Pin it hangs on, offset from it; else on its net.
    const wire =
      net && annotation.anchor.kind === "route"
        ? wireOf.get(annotation.anchor.routeId)
        : undefined;
    const object =
      net && annotation.anchor.kind === "object"
        ? placeOf.get(annotation.anchor.objectId)
        : undefined;
    write(
      annotation.id,
      text,
      shown.rotation,
      {
        ...common,
        ...(wire
          ? { attach: wire, at: anchor }
          : object
            ? {
                attach: object.object,
                offset: [
                  Math.round((anchor[0] - object.at[0]) * 1e6) / 1e6 + 0,
                  Math.round((anchor[1] - object.at[1]) * 1e6) / 1e6 + 0,
                ],
              }
            : { ...(net ? { attach: rnlName("&", net) } : {}), at: anchor }),
        ...(name ? { name } : {}),
      },
      { hidden: concealed },
    );
    if (name) bindLabel(name, binding);
  }

  // Drawing objects, in the order Analog Canvas stacks them.
  let figures = false;
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
      // A symbol drawn as a picture: a usage of the standard point
      // definition $FIGURE, which takes any symbol.
      const symbol = rnlSymbolFor(object.symbolId, null);
      const turn = rnlOrient(object.transform);
      if (geometry.kind !== "floating-symbol" || !symbol || !turn.ok) {
        drawings.push(object.id);
        continue;
      }
      if (!symbol.inline) context.packages.add(symbol.package);
      const orient = composeOrient(turn.orient, symbol.orient);
      const at = rnlPlace(geometry.position, turn.orient, symbol.offset);
      figures = true;
      ops.push({
        level,
        op: "add-usage",
        name: nextName("figure"),
        definition: "$FIGURE",
        attach: { at },
        symbol: symbol.symbol,
        at,
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
      typeset(`${group}_text`, object.typographyToken);
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
    // Analog Canvas draws drawing text bold unless it is set plain.
    const style: Record<string, string | boolean> = {};
    if (object.styleOverride?.weight !== "normal") style.bold = true;
    if (object.styleOverride?.italic) style.italic = true;
    if (object.styleOverride?.color)
      style.textcolor = object.styleOverride.color;
    // On the part it hangs on (13.3), offset from it, so it moves with it as
    // in the editor; else where it stands. A text on a glyph is written
    // where it stands: one attached to a glyph reads back as its net's label.
    const placed =
      object.anchor.kind === "object"
        ? placeOf.get(object.anchor.objectId)
        : undefined;
    const host = placed?.object.startsWith("#") ? placed : undefined;
    const at = toRnlPoint(anchor.position);
    const name =
      named(null).name ??
      (object.typographyToken ? nextName("text") : undefined);
    const rotation = anchor.rotation + object.rotation;
    write(
      object.id,
      object.content,
      rotation,
      {
        ...(name ? { name } : {}),
        ...(host
          ? {
              attach: host.object,
              offset: [
                Math.round((at[0] - host.at[0]) * 1e6) / 1e6 + 0,
                Math.round((at[1] - host.at[1]) * 1e6) / 1e6 + 0,
              ],
            }
          : { at }),
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
      },
      {
        // Analog Canvas turns a drawing text's glyphs at a quarter turn on
        // its own (`draftTextTurn`), and sets them level at any other.
        level: textTurn(rotation) !== textTurn(draftTextTurn(object)),
      },
    );
    if (name) typeset(name, object.typographyToken);
  }

  // A figure drawn with a device's symbol has no name, value or model for
  // the symbol's labels to read (13.6): they are empty, as the editor draws
  // none.
  if (figures)
    for (const key of ["name", "value", "model"])
      ops.push({
        level,
        op: "add-rule",
        select: { kind: "usage", definition: "$FIGURE" },
        action: { op: "add-text", key, markup: "" },
      });

  const say = (code: string, ids: StableId[], message: string) => {
    if (ids.length) report("warning", code, `${ids.length} ${message}`, ids);
  };
  say(
    "RNL_TEXT_FIXED",
    fixed,
    "labels are written as the text they show, styled as shown; RNL will not follow a rename",
  );
  say(
    "RNL_TEXT_HIDDEN",
    hidden,
    "hidden current or voltage markers are left out: RNL cannot hide their arrows and signs",
  );
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
    "drawing texts are written at the turn Analog Canvas keeps for their layout, whose glyphs it draws level",
  );
  say(
    "RNL_DRAWING_NOT_EXPORTED",
    drawings,
    "drawing objects keep only part of their look: a floating symbol with no RNL symbol is left out",
  );
  return netnames;
}

/**
 * A text's style with its weight, which the standard style makes bold (9.3),
 * as Analog Canvas draws it, and a keyed label shown, which
 * `rnl-std-no-labels` hides.
 */
function shownStyle(fields: {
  key?: string;
  style?: Record<string, string | number | boolean>;
}): Record<string, string | number | boolean> {
  return {
    bold: false,
    ...fields.style,
    ...(fields.key ? { textvisible: true } : {}),
  };
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

/**
 * For a two-pin symbol whose card prints its pins in the other order than
 * the symbol's terminals: the turn of the symbol's own frame that lays each
 * pin on the other's place (a mirror along the pins first), and the
 * terminal each pin then takes, its place in the card. Undefined where the
 * card prints them in the symbol's order or no turn swaps them.
 */
function cardSwap(
  symbol: RnlSymbol,
  nodes: readonly { pinName: string }[],
):
  | { flip: RnlOrient; terminalOf: (pin: string) => number | undefined }
  | undefined {
  const [first, second] = [...symbol.pins].sort(
    (a, b) => a.terminal - b.terminal,
  );
  if (
    symbol.pins.length !== 2 ||
    symbol.undrawnPins.length ||
    nodes.length !== 2 ||
    nodes[0]!.pinName !== second!.acPin ||
    nodes[1]!.pinName !== first!.acPin
  )
    return undefined;
  const lands = (flip: RnlOrient, from: RnlPoint, to: RnlPoint) => {
    const [x, y] = orientPoint(flip, from);
    return x === to[0] && y === to[1];
  };
  const flip = (["MX", "MY", "R180"] as const).find(
    (code) =>
      lands(code, first!.at, second!.at) && lands(code, second!.at, first!.at),
  );
  return flip
    ? {
        flip,
        terminalOf: (pin) => {
          const index = nodes.findIndex((node) => node.pinName === pin);
          return index < 0 ? undefined : index + 1;
        },
      }
    : undefined;
}
