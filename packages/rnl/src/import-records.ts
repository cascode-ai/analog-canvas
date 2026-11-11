import { projectLengthToSky130Micrometres } from "@icm/devices";
import { spectreNumber, spectreSourceField } from "@icm/netlist";
import { deriveStableId, type NoConnect, type StableId } from "@icm/model";

import { type RnlObjectView, rnlIdName, terminalOf } from "./rnl-snapshot.js";
import {
  type LevelScope,
  type RnlParameterText,
  type KeptParameter,
} from "./import-scope.js";
import { nameIfFree } from "./import-parts.js";

/** What the Analog Canvas records of a level (`$CANVAS_*`, `$NO_CONNECT`) give back. */
export interface CanvasRecords {
  /** Reads one usage if it is such a record; false for any other. */
  read(object: RnlObjectView): boolean;
  /** The pins left open on purpose, each with its mark. */
  noConnects(): NoConnect[];
  cellNames: { documentId: StableId; name: string }[];
  keptParameters: KeptParameter[];
  parameterTexts: RnlParameterText[];
}

/**
 * The records Analog Canvas writes of what the netlist does not say (Canvas
 * 0.4): parts' and the Cell's names, typesetting, kept parameters, authored
 * parameter texts; and the pins RNL marks as left open.
 */
export function readCanvasRecords(scope: LevelScope): CanvasRecords {
  const { document, level, model, warn, instanceOf, netOf, pinOf } = scope;
  const cellNames: { documentId: StableId; name: string }[] = [];
  const keptParameters: KeptParameter[] = [];
  const parameterTexts: RnlParameterText[] = [];
  /**
   * A part the author never named, as it was (Canvas 0.4): one with no name
   * has no netlist record and emits as its symbol's own body, so the record
   * the netlist import made for its card goes, where it holds no parameter.
   */
  const unnameAgain = (object: RnlObjectView) => {
    const part = object.attach?.["part"];
    const card = typeof part === "string" ? rnlIdName(part, "#") : null;
    const instance = card === null ? undefined : instanceOf(card);
    if (!instance || Object.keys(instance.netlist?.parameters ?? {}).length)
      return;
    delete instance.reference;
    delete instance.netlist;
  };
  /**
   * A part's name where the netlist spells it otherwise (`$CANVAS_NAME`):
   * SPICE starts a subcircuit call's card with X, so M1 prints as XM1. The
   * card's name stays where the name would give the part a Reference issue
   * it does not have: another part of the Cell has it, as SPICE compares
   * names without case, or the part as read takes names of another prefix.
   */
  const nameAgain = (object: RnlObjectView) => {
    const part = object.attach?.["part"];
    const name = object.params?.["name"];
    const card = typeof part === "string" ? rnlIdName(part, "#") : null;
    const instance = card === null ? undefined : instanceOf(card);
    if (!instance || typeof name !== "string" || !name.trim()) return;
    // A netlist name is one token of at most 128 characters.
    if (name.length > 128 || /[\s\p{Cc}]/u.test(name)) {
      warn(
        "RNL_IMPORT_NAME_REFUSED",
        `${instance.reference ?? instance.id} is named ${JSON.stringify(name.slice(0, 40))} in Analog Canvas, which is not a netlist name; it keeps its card's name`,
      );
      return;
    }
    const printed = instance.reference;
    const after = nameIfFree(scope, instance, name);
    if (!after.length) return;
    warn(
      after.includes("DUPLICATE_REFERENCE")
        ? "RNL_IMPORT_NAME_TAKEN"
        : "RNL_IMPORT_NAME_REFUSED",
      after.includes("DUPLICATE_REFERENCE")
        ? `${printed ?? instance.id} is named ${name} in Analog Canvas, which another part of the Cell is; it keeps its card's name`
        : `${printed ?? instance.id} is named ${name} in Analog Canvas, which the part as read cannot be named; it keeps its card's name`,
    );
  };

  /** The Cell's own name, where the netlist had to write it otherwise (Canvas 0.4). */
  const cellNameAgain = (object: RnlObjectView) => {
    const name = object.params?.["name"];
    if (
      object.attach?.["level"] === "#" &&
      typeof name === "string" &&
      name.trim()
    )
      cellNames.push({ documentId: document.id, name });
  };
  /**
   * How the Cell sets names in its labels (`$CANVAS_TYPESETTING` on the
   * level): each setting it writes, and Analog Canvas's default for each
   * it leaves out or writes as nothing Analog Canvas knows. A Cell whose
   * level has none keeps the import's own.
   */
  const typesetAgain = (object: RnlObjectView) => {
    if (object.attach?.["level"] !== "#") return;
    const params = object.params ?? {};
    const presentation = document.presentation;
    // A setting left out is the default; one Analog Canvas does not know
    // leaves the import's own and is reported.
    const set = <K extends keyof typeof presentation>(
      key: K,
      param: string,
      read: (value: unknown) => (typeof presentation)[K] | undefined,
    ) => {
      if (!(param in params)) {
        delete presentation[key];
        return;
      }
      const value = read(params[param]);
      if (value === undefined)
        warn(
          "RNL_IMPORT_TYPESETTING_IGNORED",
          `${param}=${JSON.stringify(params[param])} on ${document.netlist?.name ?? document.id} is not a typesetting Analog Canvas knows; the Cell keeps its own`,
        );
      else presentation[key] = value;
    };
    const flag = (value: unknown) =>
      typeof value === "boolean" ? value : undefined;
    set("labelSubscriptCase", "subscript_case", (value) =>
      value === "preserve" || value === "uppercase" || value === "lowercase"
        ? value
        : undefined,
    );
    set("labelSubscriptItalic", "subscript_italic", flag);
    set("labelUnderscoreSubscript", "underscore_subscript", flag);
    set("labelSubscriptAfterFirst", "subscript_after_first", flag);
    set("labelFirstLetterItalic", "first_letter_italic", flag);
    set("textFace", "face", (value) =>
      value === "serif" ? "serif" : undefined,
    );
    set("crossingStyle", "crossings", (value) =>
      value === "hop" ? "hop" : undefined,
    );
  };

  /**
   * A parameter the editor keeps that the card does not print (Canvas 0.4),
   * given again where the netlist import did not bring it: a source's fields
   * of other waveforms, an op-amp's rails. A parameter the card prints is
   * the card's.
   */
  const keepAgain = (object: RnlObjectView) => {
    const part = object.attach?.["part"];
    const card = typeof part === "string" ? rnlIdName(part, "#") : null;
    const instance = card === null ? undefined : instanceOf(card);
    const name = object.params?.["name"];
    const text = object.params?.["text"];
    const parameters = instance?.netlist?.parameters;
    if (
      !instance ||
      !parameters ||
      typeof name !== "string" ||
      typeof text !== "string" ||
      Object.keys(parameters).some(
        (key) => key.toLowerCase() === name.toLowerCase(),
      )
    )
      return;
    keptParameters.push({
      documentId: document.id,
      instanceId: instance.id,
      name,
      text,
    });
  };
  /**
   * The text the author wrote for a parameter the netlist writes otherwise
   * (`$CANVAS_PARAMETER_TEXT`), named as the netlist names it: a resistor's,
   * capacitor's or inductor's value is its r, c or l. It stands only where
   * it is the number the part has, written as Spectre writes it, or the
   * same size: a SKY130 size prints in micrometres, 0.15 for 0.15u, and
   * reads back as 150n.
   */
  const textAgain = (object: RnlObjectView) => {
    const part = object.attach?.["part"];
    const card = typeof part === "string" ? rnlIdName(part, "#") : null;
    const instance = card === null ? undefined : instanceOf(card);
    const name = object.params?.["name"];
    const text = object.params?.["text"];
    const parameters = instance?.netlist?.parameters;
    if (!parameters || typeof name !== "string" || typeof text !== "string")
      return;
    // What the name stands for: a source's field as Spectre names it (dc a
    // sine's offset, phase the AC phase), a resistor's, capacitor's or
    // inductor's value, or the parameter of that name.
    const folded = name.toLowerCase();
    const field = spectreSourceField(
      name,
      parameters["waveform"]?.trim().toLowerCase(),
    );
    const candidates = field
      ? [field]
      : [name, ...(["r", "c", "l"].includes(folded) ? ["value"] : [])];
    const key = candidates
      .flatMap(
        (candidate) =>
          Object.keys(parameters).find(
            (item) => item.toLowerCase() === candidate.toLowerCase(),
          ) ?? [],
      )
      .find(
        (item) =>
          spectreNumber(parameters[item]!) === spectreNumber(text) ||
          sameSize(parameters[item]!, text),
      );
    if (key)
      parameterTexts.push({
        documentId: document.id,
        instanceId: instance!.id,
        parameter: key,
        text,
      });
    else
      warn(
        "RNL_IMPORT_PARAMETER_TEXT",
        `${instance!.reference ?? instance!.id}'s ${name} was written ${text}, which is not the value it has; it keeps the netlist's`,
      );
  };

  /**
   * A pin left open on purpose (`$NO_CONNECT`, 12.6) takes the mark again.
   * The netlist names such a pin's node alone (NC0001); the net the import
   * made for that node goes. A pin the file connects to anything else keeps
   * its net, without the mark.
   */
  const opened: { node: string; endpoint: NoConnect["endpoint"] }[] = [];
  const openAgain = (object: RnlObjectView) => {
    const attached = object.attach?.["t"];
    const terminal = typeof attached === "string" ? terminalOf(attached) : null;
    const instance = terminal ? instanceOf(terminal.name) : undefined;
    const pinName =
      instance && terminal ? pinOf(instance, terminal.n) : undefined;
    if (!instance || !pinName) {
      warn(
        "RNL_IMPORT_NO_CONNECT_NO_PIN",
        `RNL marks ${String(attached)} as left unconnected, which the netlist import has no pin for`,
      );
      return;
    }
    const net = document.nets.find((item) =>
      item.terminals.some(
        (held) => held.instanceId === instance.id && held.pinName === pinName,
      ),
    );
    if (
      net &&
      (net.terminals.length > 1 ||
        document.netlist?.terminals.some((item) => item.netId === net.id) ||
        model.wires.some((wire) =>
          wire.nets.some((name) => netOf(name) === net.id),
        ) ||
        document.instances.some(
          (item) => item !== instance && item.mosBulkBinding?.netId === net.id,
        ))
    ) {
      warn(
        "RNL_IMPORT_NO_CONNECT_CONNECTED",
        `RNL marks ${instance.reference ?? instance.id}:${pinName} as left unconnected, but the netlist connects it; it keeps its net`,
      );
      return;
    }
    if (net) {
      document.nets = document.nets.filter((item) => item !== net);
      document.connectivityEvidence = document.connectivityEvidence.filter(
        (evidence) => evidence.netId !== net.id,
      );
      // A MOS's open bulk is no Cell's bulk default.
      if (instance.mosBulkBinding?.netId === net.id)
        delete instance.mosBulkBinding;
      const defaults = document.mosBulkDefaults;
      if (defaults?.nmosNetId === net.id) delete defaults.nmosNetId;
      if (defaults?.pmosNetId === net.id) delete defaults.pmosNetId;
      if (defaults && !Object.keys(defaults).length)
        delete document.mosBulkDefaults;
    }
    if (
      !opened.some(
        ({ endpoint }) =>
          endpoint.instanceId === instance.id && endpoint.pinName === pinName,
      )
    )
      opened.push({
        node:
          document.importReference?.nets.find((item) => item.id === net?.id)
            ?.name ?? "",
        endpoint: { kind: "terminal", instanceId: instance.id, pinName },
      });
  };

  const skip = () => undefined;
  /** Each record's reading, by its definition. */
  const readers = new Map<string, (object: RnlObjectView) => void>([
    ["$CANVAS_NAME", nameAgain],
    ["$CANVAS_UNNAMED", unnameAgain],
    ["$CANVAS_TYPESETTING", typesetAgain],
    ["$CANVAS_CELL_NAME", cellNameAgain],
    ["$CANVAS_LABEL", skip], // read with the labels
    ["$CANVAS_TYPOGRAPHY", skip], // with the texts
    ["$CANVAS_VARIANT", skip], // with the parts
    ["$CANVAS_TOP", skip], // read with the file
    ["$CANVAS_PARAMETER_TEXT", textAgain],
    ["$CANVAS_PARAMETER", keepAgain],
    ["$NO_CONNECT", openAgain],
  ]);
  const read = (object: RnlObjectView): boolean => {
    const reader = object.definition
      ? readers.get(object.definition)
      : undefined;
    reader?.(object);
    return reader !== undefined;
  };
  const noConnects = (): NoConnect[] => {
    // The netlist numbers open pins' nodes (NC0001 …) in the order of their
    // marks' ids, so the ids keep the order of the nodes the file has.
    opened.sort((a, b) =>
      a.node.localeCompare(b.node, "en", { numeric: true }),
    );
    const base = deriveStableId("no-connect", document.id, level.id);
    const digits = Math.max(4, String(opened.length).length);
    return opened.map(({ endpoint }, index) => ({
      id: `${base}-${String(index + 1).padStart(digits, "0")}`,
      endpoint,
    }));
  };
  return { read, noConnects, cellNames, keptParameters, parameterTexts };
}

/** Whether two lengths are the same number of micrometres. */
function sameSize(left: string, right: string): boolean {
  try {
    return (
      projectLengthToSky130Micrometres(left) ===
      projectLengthToSky130Micrometres(right)
    );
  } catch {
    return false;
  }
}
