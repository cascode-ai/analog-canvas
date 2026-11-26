import {
  expandedDeviceCatalogEntry,
  expandedDeviceSymbols,
  EXTENDED_DEVICE_CATEGORY,
  normalizeSignalFlowFormula,
  razaviProductSymbols,
} from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";

import {
  ANNOTATION_CATEGORY,
  annotationPreviewSymbols,
  isAnnotationPaletteSymbol,
} from "./annotation-preview-symbols";
import { vddRailPreviewSymbol } from "./vdd-rail-preview-symbol";
import { noConnectPreviewSymbol } from "./no-connect-preview-symbol";

/**
 * Reach order rather than taxonomy order: the devices placed most often in a
 * Razavi-style schematic come first, and the composite blocks and logic gates
 * that are reached for least often sit at the end.
 */
interface CatalogSection {
  readonly category: string;
}

const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { category: "Transistors" },
  { category: "Passives" },
  { category: "Power and Ports" },
  { category: "Sources" },
  { category: "Switches" },
  { category: "Analog Blocks" },
  { category: "Logic Gates" },
  { category: "Signal Flow" },
  { category: ANNOTATION_CATEGORY },
  { category: EXTENDED_DEVICE_CATEGORY },
];

export interface ComponentCatalogGroup {
  category: string;
  symbols: SymbolDefinition[];
}

export function symbolCategory(symbolId: string): string {
  if (isAnnotationPaletteSymbol(symbolId)) return ANNOTATION_CATEGORY;
  // Keep diode, JFET and adjustable-passive tiles in Extended Devices,
  // leaving the everyday transistor and passive groups compact.
  if (
    [
      "variable-resistor",
      "photoresistor",
      "variable-capacitor",
      "polarized-capacitor",
      "mos-varactor",
      "variable-inductor",
      "diode",
      "zener-diode",
      "led",
      "schottky-diode",
      "shockley-diode",
      "put",
      "njfet",
      "pjfet",
      "ujt",
      "tcoil",
      "center-tap-inductor",
      "xfmr",
      "center-tap-xfmr",
      "relay",
      "crystal",
      "transmission-line",
      "impedance",
      "speaker",
      "microphone",
      "ammeter",
      "potentiometer",
      "photodiode",
      "varactor-diode",
      "current-regulative-diode",
      "thyristor",
      "phototransistor",
      "schottky-npn",
      "igbt",
      "mesfet",
      "fuse",
      "shunt-regulator",
      "voltage-regulator",
      "voltage-reference",
      "voltmeter",
      "dc-motor",
      "buzzer",
      "antenna",
      "solar-cell",
      "thermocouple",
      "noise-voltage-source",
      "controlled-current-source",
    ].includes(symbolId)
  ) {
    return EXTENDED_DEVICE_CATEGORY;
  }
  const expanded = expandedDeviceCatalogEntry(symbolId);
  if (expanded) return expanded.category;
  if (["nmos", "pmos", "npn", "pnp"].includes(symbolId)) {
    return "Transistors";
  }
  if (
    ["resistor", "capacitor", "inductor-compact", "inductor"].includes(symbolId)
  ) {
    return "Passives";
  }
  if (
    [
      "adc",
      "dac",
      "adc-differential",
      "dac-differential",
      "opamp",
      "opamp-wide",
      "opamp-lettered",
      "voltage-amplifier-lettered",
      "transconductance",
      "differential-transconductance",
      "fully-differential-transconductance",
      "opamp-differential",
      "opamp-differential-wide",
      "opamp-differential-lettered",
      "opamp-differential-crossed",
      "opamp-differential-wide-crossed",
      "opamp-differential-crossed-lettered",
      "opamp-compensated",
      "opamp-enable",
      "opamp-bias",
      "single-to-diff-amplifier",
      "differential-video-amplifier",
      "differential-line-driver",
      "voltage-amplifier",
      "comparator",
      "comparator-unmarked",
      "comparator-differential",
      "comparator-differential-unmarked",
      "two-port",
    ].includes(symbolId)
  ) {
    return "Analog Blocks";
  }
  if (
    [
      "inverter",
      "buffer",
      "delay-cell",
      "d-flip-flop",
      "d-flip-flop-reset",
      "d-flip-flop-q",
      "and-gate",
      "or-gate",
      "nand-gate",
      "nor-gate",
      "xor-gate",
      "xnor-gate",
    ].includes(symbolId)
  ) {
    return "Logic Gates";
  }
  if (
    [
      "adder",
      "multiplier",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
    ].includes(symbolId)
  ) {
    return "Signal Flow";
  }
  if (
    [
      "voltage-source",
      "sine-voltage-source",
      "pulse-voltage-source",
      "current-source",
      "vcvs",
      "vccs",
      "cccs",
      "ccvs",
    ].includes(symbolId)
  ) {
    return "Sources";
  }
  if (
    [
      "ideal-switch",
      "closed-switch",
      "externally-controlled-switch",
      "simple-switch",
      "spdt-switch",
      "voltage-controlled-switch",
      "chopper",
    ].includes(symbolId)
  ) {
    return "Switches";
  }
  return "Power and Ports";
}

/**
 * Library display names, where the catalog's own name does not say what the
 * entry is *for*.
 *
 * The hollow Port is a Cell Pin. The filled marker is a Bias Voltage Port.
 * Both remain independently authored interface objects in the current model.
 */
const LIBRARY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "no-connect": "NoConn",
  opamp: "Op Amp S",
  "opamp-wide": "Op Amp",
  "opamp-differential-crossed": "FD Amp S",
  "opamp-differential-wide-crossed": "FD Amp",
  "comparator-differential": "FD Comp",
  "depletion-nmos": "D-NMOS",
  "depletion-pmos": "D-PMOS",
  "externally-controlled-switch": "Ctrl SW",
  vcvs: "VCVS",
  vccs: "VCCS",
  cccs: "CCCS",
  ccvs: "CCVS",
  port: "Cell Pin",
  "zener-diode": "Zener",
  led: "LED",
  "schottky-diode": "Schottky",
  "polarized-capacitor": "Pol Cap",
  photoresistor: "LDR",
  "sine-voltage-source": "Sine Src",
  potentiometer: "Pot",
  ujt: "UJT",
  put: "PUT",
  "shockley-diode": "Shockley",
  microphone: "Mic",
  "center-tap-inductor": "CT Coil",
  "center-tap-xfmr": "CT XFMR",
  relay: "Relay",
  "opamp-compensated": "Comp Amp",
  "opamp-enable": "En Amp",
  "opamp-bias": "Bias Amp",
  "single-to-diff-amplifier": "S2D Amp",
  "fully-differential-transconductance": "FD gm",
  "differential-video-amplifier": "Video Amp",
  "differential-line-driver": "Line Drv",
  "mos-varactor": "MOS Var",
  "transmission-line": "T-Line",
  impedance: "Z",
  "two-port": "2-Port",
  photodiode: "Photo D",
  "varactor-diode": "Varactor",
  "current-regulative-diode": "CRD",
  thyristor: "SCR",
  phototransistor: "Photo Q",
  "schottky-npn": "Sch NPN",
  igbt: "IGBT",
  mesfet: "MESFET",
  fuse: "Fuse",
  "shunt-regulator": "TL431",
  "voltage-regulator": "78xx",
  "voltage-reference": "V Ref",
  voltmeter: "Voltmeter",
  "dc-motor": "Motor",
  buzzer: "Buzzer",
  antenna: "Antenna",
  "solar-cell": "Solar",
  thermocouple: "Thermo",
  "noise-voltage-source": "Noise Src",
  "controlled-current-source": "Ctrl I",
};

/** One line saying what an entry does, where the name alone leaves a doubt. */
const LIBRARY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "no-connect":
    "No Connect: mark intentionally unused pins; activates a tool, not a device",
  "comparator-differential":
    "Fully differential comparator — complementary OUT+ / OUT−; input/output pin spacing: 20",
  "adc-differential":
    "ADC with a differential input — IN+ / IN−; pin spacing: 20",
  "dac-differential":
    "DAC with a differential output — OUT+ / OUT−; pin spacing: 20",
  tcoil:
    "Bridged T-coil: two coupled windings with a bridge capacitor across the ends",
  "center-tap-inductor":
    "Center-tapped inductor: two series halves meeting at the tap, no bridge capacitor",
  "center-tap-xfmr":
    "Center-tapped transformer: secondary tap SC by default; dual-tap variant also exposes primary tap PC",
  relay:
    "Electromagnetic SPDT relay: coil rcoil; COM switches from NC to NO when |V(COIL+, COIL−)| exceeds von",
  "opamp-compensated":
    "Op-amp with frequency-compensation pins COMP1/COMP2 (LM108/LM101A style); single-comp variant hides COMP2",
  "opamp-enable":
    "Op-amp with enable/mute pin EN (and optional GND pin via gnd-pin variant for power op-amps such as LM3876)",
  "opamp-bias":
    "Op-amp with bias voltage output pin VBIAS (and optional EN pin via en-pin variant)",
  "single-to-diff-amplifier":
    "Single-ended input, differential output amplifier — OUT+ / OUT− centered on vocm",
  "fully-differential-transconductance":
    "Fully differential transconductor (gₘ) — IN+/IN− to complementary OUT+/OUT− currents",
  "differential-video-amplifier":
    "Differential video amplifier (NE592 style) — IN+/IN−, OUT+/OUT−, and gain-select pins G1/G2",
  "differential-line-driver":
    "Tri-state differential line driver — single IN, complementary OUT+/OUT− (inverting bubble), and enable EN",
  "transmission-line":
    "Lossless transmission line: impedance z0, delay td; port 1 is P1/N1, port 2 is P2/N2",
  impedance:
    "Generic impedance or two-terminal block: a call of the subcircuit its model names",
  "two-port":
    "Generic two-port block: port 1 is P1/N1, port 2 is P2/N2; a call of the subcircuit its model names",
  opamp: "Compact Op Amp — input pin spacing: 20",
  "opamp-wide": "Op Amp — input pin spacing: 40",
  "opamp-differential-crossed":
    "Compact FD Amp — input/output pin spacing: 20; each row pairs + with −",
  "opamp-differential-wide-crossed":
    "FD Amp — input/output pin spacing: 40; each row pairs + with −",
  "d-flip-flop-reset":
    "Rising-edge D flip-flop with an active-high asynchronous reset",
  "voltage-controlled-switch":
    "Four-terminal switch: P/N carry the switched path; CP/CN sense the control voltage",
  "externally-controlled-switch":
    "Three-terminal switch: P/N carry the path; CTRL is one external logic-control pin",
  vcvs: "Voltage-controlled voltage source",
  vccs: "Voltage-controlled current source",
  cccs: "Current-controlled current source",
  ccvs: "Current-controlled voltage source",
  port: "A terminal on this Cell interface — the parent circuit connects to it",
  "port-filled":
    "A solid bias-voltage port, typically used for VB-style bias nodes",
  led: "Light-emitting or laser diode — electrically the Diode",
  "sine-voltage-source":
    "Sine voltage source — the Independent Voltage Source with SIN as its waveform",
  photoresistor:
    "Photoresistor (light-dependent resistor) — electrically the Resistor",
  "polarized-capacitor":
    "Polarized (electrolytic) capacitor — electrically the Capacitor, + on pin 1",
  "mos-varactor":
    "Two-gate MOS varactor drawn as IHP's: gates G2 left and G1 right, n-well control W on top; takes a PDK model (IHP sg13_hv_svaricap)",
  "schottky-diode":
    "Schottky barrier diode — electrically a diode, on the generic DSCH model",
  speaker: "Loudspeaker — electrically a Resistor, 8 Ω by default",
  microphone:
    "Microphone — electrically an independent voltage source (DC, AC, SIN…)",
  ammeter: "Ammeter — a 0 V source in series; probe the current through it",
  potentiometer:
    "Potentiometer — total resistance r, wiper W at fraction pos from end 1",
  ujt: "Unijunction transistor — base bar rbb split at eta, emitter diode onto it",
  put: "Programmable unijunction transistor — fires when A rises a diode drop above G",
  "shockley-diode":
    "Shockley (four-layer) diode — blocks until vbo, then latches on",
  photodiode: "Photodiode — electrically the Diode, on the generic DIODE model",
  "varactor-diode":
    "Varactor diode — electrically the Diode; bind a model with CJO for its capacitance",
  "current-regulative-diode":
    "Current-regulative diode — a JFET with its gate on its source, about idss from A to K",
  thyristor:
    "Thyristor (SCR) — latches on from A to K when G draws current, holds until the current falls",
  phototransistor:
    "NPN phototransistor — electrically the NPN; mark B No Connect where the figure draws none",
  "schottky-npn":
    "Schottky-clamped NPN — an NPN with a Schottky diode from base to collector",
  igbt: "IGBT — an NMOS gate driving a PNP, on from C to E above about 4 V on G",
  mesfet:
    "N-channel MESFET or HEMT — electrically the N-Channel JFET, on the generic NJF model",
  fuse: "Fuse — electrically a Resistor, 10 mΩ by default; it never opens",
  "shunt-regulator":
    "Adjustable shunt regulator (TL431) — sinks K to A to hold REF at 2.495 V above A",
  "voltage-regulator":
    "Three-terminal regulator (78xx) — OUT held at vout above GND while IN is higher",
  "voltage-reference":
    "Three-terminal voltage reference — OUT held at vout (2.5 V) above GND",
  voltmeter:
    "Voltmeter — a 10 MΩ resistance across; probe the voltage across it",
  "dc-motor":
    "DC motor — electrically a Resistor, its winding, 10 Ω by default",
  buzzer:
    "Piezo buzzer or earphone — electrically a Capacitor, 20 nF by default",
  antenna: "Antenna — one pin; electrically 1 GΩ to ground, no reception",
  "solar-cell": "Solar cell — a photocurrent isc in parallel with a diode",
  thermocouple: "Thermocouple — electrically a voltage source, 1 mV by default",
  "noise-voltage-source":
    "Noise voltage source — electrically a voltage source, AC 1 for noise-like AC analysis",
  "controlled-current-source":
    "Current source with a control input — gm times V(CTRL) from + to −",
};

export function libraryDisplayName(symbolId: string, fallback: string): string {
  return LIBRARY_DISPLAY_NAMES[symbolId] ?? fallback;
}

export function libraryDescription(symbolId: string): string | undefined {
  return LIBRARY_DESCRIPTIONS[symbolId];
}

/**
 * Catalog parts the Library leaves out. The FD amps it offers are the
 * crossed ones, each row pairing + with −; the straight ones stay in the
 * catalog for the Agent and for drawings, and Swap outputs reaches them.
 */
const LIBRARY_LEAVES_OUT = new Set([
  "pulse-voltage-source",
  "opamp-differential",
  "opamp-differential-wide",
]);

export function paletteSymbols(_styleProfileId: string): SymbolDefinition[] {
  const symbols = [
    vddRailPreviewSymbol,
    noConnectPreviewSymbol,
    ...razaviProductSymbols,
    ...annotationPreviewSymbols,
    ...expandedDeviceSymbols,
  ];
  return symbols.filter((symbol) => !LIBRARY_LEAVES_OUT.has(symbol.id));
}

/**
 * Reach order inside a category. Alphabetical order separated devices that are
 * used together — NMOS from PMOS, the supply Port from its Rail — so the
 * frequently placed pair leads and the rest keep alphabetical order after it.
 */
const SYMBOL_ORDER: readonly string[] = [
  "nmos",
  "pmos",
  "npn",
  "pnp",
  // Passives in the order they are taught and reached for, not alphabetical.
  "resistor",
  "capacitor",
  "inductor-compact",
  "inductor",
  // Independent sources lead; controlled sources follow in electrical order.
  "voltage-source",
  "sine-voltage-source",
  "current-source",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
  // Switches: textbook two-terminal forms, then explicit-control forms.
  "ideal-switch",
  "closed-switch",
  "externally-controlled-switch",
  "voltage-controlled-switch",
  // Logic gates likewise: the two single-input gates, then the combinational
  // family, then the sequential blocks that are reached for least often.
  "inverter",
  "buffer",
  "and-gate",
  "or-gate",
  "nand-gate",
  "nor-gate",
  "xor-gate",
  "xnor-gate",
  "d-flip-flop",
  "d-flip-flop-reset",
  "d-flip-flop-q",
  "delay-cell",
  "variable-resistor",
  "potentiometer",
  "photoresistor",
  "fuse",
  "variable-capacitor",
  "polarized-capacitor",
  "mos-varactor",
  "variable-inductor",
  "diode",
  "zener-diode",
  "shunt-regulator",
  "led",
  "photodiode",
  "varactor-diode",
  "current-regulative-diode",
  "schottky-diode",
  "shockley-diode",
  "thyristor",
  "put",
  "njfet",
  "pjfet",
  "ujt",
  "phototransistor",
  "schottky-npn",
  "igbt",
  "mesfet",
  "tcoil",
  "center-tap-inductor",
  "xfmr",
  "center-tap-xfmr",
  "relay",
  "crystal",
  "transmission-line",
  "impedance",
  "speaker",
  "dc-motor",
  "buzzer",
  "antenna",
  "solar-cell",
  "thermocouple",
  "noise-voltage-source",
  "controlled-current-source",
  "microphone",
  "voltage-regulator",
  "voltage-reference",
  "ammeter",
  "voltmeter",
  "depletion-nmos",
  "depletion-pmos",
  "ndmos",
  "pdmos",
  "vdd-port",
  "vdd",
  "ground",
  "named-ground",
  "no-connect",
  // Signal-flow blocks in signal-chain order, not alphabetical.
  "adder",
  "multiplier",
  "integrator",
  "unit-delay",
  "discrete-time-integrator",
  "quantizer",
  // Annotations: drawing tools first (toolbar order), then the polarity
  // label, standalone signs, and fixed decorative marks last.
  // Analog Blocks. Alphabetical order split the two converters apart, putting
  // ADC at the head of the group and DAC four tiles later with comparators and
  // a differential amplifier between them. A reader looking for one converter
  // is looking for the pair, so they sit together, after the amplifiers and
  // comparators an analog schematic reaches for far more often.
  "opamp-wide",
  "opamp",
  "opamp-differential-wide-crossed",
  "opamp-differential-crossed",
  "opamp-compensated",
  "opamp-enable",
  "opamp-bias",
  "single-to-diff-amplifier",
  "differential-video-amplifier",
  "differential-line-driver",
  "voltage-amplifier",
  "transconductance",
  "differential-transconductance",
  "fully-differential-transconductance",
  "comparator",
  "comparator-differential",
  "adc",
  "dac",
  "adc-differential",
  "dac-differential",
  "two-port",
  "annotation-arrow",
  "annotation-line",
  "annotation-polyline",
  "annotation-rectangle",
  "annotation-circle",
  "annotation-arc",
  "annotation-polarity-both",
  "annotation-text-plus",
  "annotation-text-minus",
  "annotation-ellipsis",
];

function symbolRank(symbolId: string): number {
  const index = SYMBOL_ORDER.indexOf(symbolId);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

function searchableText(symbol: SymbolDefinition): string {
  const formula = symbol.formulaPresentation?.defaultFormula ?? "";
  return normalizeSignalFlowFormula(
    `${libraryDisplayName(symbol.id, symbol.name)} ${symbol.name} ${symbol.id} ${formula} ${symbol.id === "no-connect" ? "nc noconn" : ""}`,
  ).toLowerCase();
}

export function componentCatalog(
  styleProfileId: string,
  query: string,
  recentSymbolIds: readonly string[] = [],
): ComponentCatalogGroup[] {
  const normalizedQuery = normalizeSignalFlowFormula(
    query.trim(),
  ).toLowerCase();
  const recentRank = new Map(
    recentSymbolIds.map((symbolId, index) => [symbolId, index]),
  );
  const symbols = paletteSymbols(styleProfileId)
    .filter(
      (symbol) =>
        normalizedQuery.length === 0 ||
        searchableText(symbol).includes(normalizedQuery),
    )
    .sort((left, right) => {
      const leftRank = recentRank.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightRank = recentRank.get(right.id) ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const leftOrder = symbolRank(left.id);
      const rightOrder = symbolRank(right.id);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name);
    });

  return CATALOG_SECTIONS.map(({ category }) => ({
    category,
    symbols: symbols.filter((symbol) => symbolCategory(symbol.id) === category),
  })).filter((group) => group.symbols.length > 0);
}

export function findPaletteSymbol(
  styleProfileId: string,
  symbolId: string,
): SymbolDefinition | undefined {
  return paletteSymbols(styleProfileId).find(
    (symbol) => symbol.id === symbolId,
  );
}
