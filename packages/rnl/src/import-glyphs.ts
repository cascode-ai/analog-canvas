import { supplyMarkerForSymbol } from "@icm/derived";
import { deriveStableId } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { acOrientation } from "./orientation.js";
import { acPosition } from "./place.js";
import { applyNativeRnlAppearance } from "./native-terminals.js";
import {
  type RnlObjectView,
  rnlIdName,
  isOrient,
  PART_GRID,
} from "./rnl-snapshot.js";
import { acSymbolFor, paintOf } from "./import-symbols.js";
import {
  GROUND_PIN_NAME,
  pinKey,
  removeGroundPin,
  type RnlPowerLabelPort,
} from "./import-pins.js";
import { type LevelScope, type RnlHiddenLabels } from "./import-scope.js";

/** The glyphs a level draws, by usage, and the Cell Pins they place. */
export interface Glyphs {
  /** Each glyph drawn as a Cell Pin or a ground or supply glyph: the pin it is. */
  glyphOf: ReadonlyMap<string, { instanceId: string; pinName: string }>;
  /** Glyphs drawn as no glyph of their net: their net, and the port drawn as its label. */
  openGlyphs: ReadonlyMap<string, { netId: string; label?: RnlObjectView }>;
  /** The Cell Pins a glyph stands for, and those of them it places. */
  movedPins: ReadonlySet<string>;
  placedPins: ReadonlySet<string>;
  /** The marks not read back, by definition. */
  marks: Map<string, number>;
  /** Reads one usage of a virtual element (a port, supply or ground) or counts it unread. */
  read(object: RnlObjectView): void;
}

/**
 * Ground pins Analog Canvas adds, taken out again; returns their nets. A
 * Cell printed as a subcircuit that meets ground takes a pin for it, VSS (or
 * GND, GND__2 …), which its drawing shows as ground, never as a port, and
 * its calls tie to ground. On such a pin the Cell's ground is ground again,
 * as drawn; its callers' ground reaches it as before. A pin a call ties
 * elsewhere stays a port.
 */
export function reclaimGroundPins(
  { project, document, model, netOf }: LevelScope,
  tiedToGround: ReadonlySet<string>,
): ReadonlySet<string> {
  const usagesOn = (definition: string) =>
    new Set(
      model.objects.flatMap((object) => {
        const attached = object.attach?.["p"];
        const netId =
          object.kind === "usage" &&
          object.definition === definition &&
          typeof attached === "string"
            ? netOf(attached)
            : undefined;
        return netId ? [netId] : [];
      }),
    );
  const groundNets = usagesOn("$GROUND");
  const portNets = usagesOn("$IO_PORT");
  const groundPins = new Set<string>();
  for (const terminal of [...(document.netlist?.terminals ?? [])])
    if (
      groundNets.has(terminal.netId) &&
      !portNets.has(terminal.netId) &&
      GROUND_PIN_NAME.test(terminal.name) &&
      tiedToGround.has(pinKey(document.id, terminal.name))
    ) {
      removeGroundPin(project, document, terminal);
      groundPins.add(terminal.netId);
    }
  return groundPins;
}

/**
 * Each usage of a virtual element on an Analog Canvas glyph, read one by one
 * in the file's order. A Cell Pin is the importer's own, moved where RNL
 * draws it; ground and supply glyphs are added on their nets, each claiming
 * its supply; a ground goes only on `groundPins` or the global 0.
 */
export function readGlyphs(
  { document, level, symbols, warn, instanceOf, netOf, snap }: LevelScope,
  groundPins: ReadonlySet<string>,
): Glyphs {
  const glyphOf = new Map<string, { instanceId: string; pinName: string }>();
  /** Glyphs drawn as no glyph of their net: their net, and the port drawn as its label. */
  const openGlyphs = new Map<
    string,
    { netId: string; label?: RnlObjectView }
  >();
  const movedPins = new Set<string>();
  const placedPins = new Set<string>();
  const marks = new Map<string, number>();
  const read = (object: RnlObjectView) => {
    if (!object.definition) return;
    const attached = object.attach?.["p"];
    const netId = typeof attached === "string" ? netOf(attached) : undefined;
    const at = object.at.value;
    const orient = object.orient.value;
    const symbol = object.symbol.value
      ? symbols.get(object.symbol.value)
      : undefined;
    if (object.definition === "$JUNCTION") return; // dots are derived
    const mapped =
      symbol && isOrient(orient)
        ? acSymbolFor(symbol, orient, { symbolId: "" }, [])
        : null;
    const placementOf = () =>
      at && mapped
        ? {
            position: snap(
              acPosition(at, mapped.orient, mapped.row.offset),
              PART_GRID,
            ),
            ...acOrientation(mapped.orient),
          }
        : null;
    // A port the Cell has, drawn as a port or as a supply: the importer's
    // own Cell Pin, moved where RNL draws it, in the glyph RNL draws.
    if (object.definition === "$IO_PORT" || object.definition === "$SUPPLY") {
      const terminal = document.netlist?.terminals.find(
        (item) =>
          item.netId === netId &&
          item.interfaceInstanceIds.some((id) => !movedPins.has(id)),
      );
      const pinId = terminal?.interfaceInstanceIds.find(
        (id) => !movedPins.has(id),
      );
      const pin = pinId === undefined ? undefined : instanceOf(pinId);
      if (pin) {
        const placement = placementOf();
        movedPins.add(pin.id);
        if (placement) placedPins.add(pin.id);
        glyphOf.set(object.id, { instanceId: pin.id, pinName: "P" });
        if (mapped) pin.symbolId = mapped.row.ac!;
        pin.placement = placement ?? pin.placement;
        Object.assign(pin, paintOf(object));
        return;
      }
      // The same port drawn again: one more Cell terminal of the port's name,
      // which joins it in the one port the netlist prints.
      const drawn = document.netlist?.terminals.find(
        (item) => item.netId === netId,
      );
      if (object.definition === "$IO_PORT" && drawn && netId) {
        const id = deriveStableId("cell-pin", document.id, level.id, object.id);
        const placement = placementOf();
        document.instances.push({
          id,
          symbolId: mapped?.row.ac ?? "port",
          placement,
          ...paintOf(object),
        });
        document.nets
          .find((item) => item.id === netId)
          ?.terminals.push({ instanceId: id, pinName: "P" });
        document.netlist!.terminals.push({
          id: deriveStableId("cell-terminal", document.id, level.id, object.id),
          name: drawn.name,
          netId,
          direction: drawn.direction,
          interfaceInstanceIds: [id],
        });
        movedPins.add(id);
        if (placement) placedPins.add(id);
        glyphOf.set(object.id, { instanceId: id, pinName: "P" });
        return;
      }
      // A port on a net the Cell has but not as a port (a flat file's
      // inputs) is a label of its net, where its wires end.
      if (object.definition === "$IO_PORT") {
        if (netId) openGlyphs.set(object.id, { netId, label: object });
        warn(
          "RNL_IMPORT_PORT_UNMATCHED",
          `${object.id} draws a port on ${String(attached)}, which is not one of the Cell's ports${netId ? "; it is drawn as a label of its net" : ""}`,
        );
        return;
      }
    }
    if (object.definition === "$GROUND" || object.definition === "$SUPPLY") {
      // A ground glyph names its net 0, so it goes only on ground; a supply
      // glyph claims its net by the net's own name. Anything else is drawn
      // as a picture, which the netlist does not read.
      const net = document.nets.find((item) => item.id === netId);
      const named = document.importReference?.nets.find(
        (item) => item.id === netId,
      );
      const ground = object.definition === "$GROUND";
      const isGround =
        (netId !== undefined && groundPins.has(netId)) ||
        (named?.name === "0" && named.scope === "global");
      const pinName = mapped?.row.pins[0]?.acPin;
      if (!net || !mapped || !pinName || (ground && !isGround)) {
        if (net) openGlyphs.set(object.id, { netId: net.id });
        if (mapped && at) {
          document.drafting ??= { objects: [] };
          document.drafting.objects.push({
            id: deriveStableId("drafting", document.id, level.id, object.id),
            locked: false,
            zIndex: document.drafting.objects.length,
            anchor: { kind: "free", position: placementOf()!.position },
            kind: "floating-symbol",
            symbolId: mapped.row.ac!,
            transform: acOrientation(mapped.orient),
          });
        }
        warn(
          "RNL_IMPORT_GLYPH_AS_PICTURE",
          `${object.id} draws ${object.definition} on ${String(attached)}, which is not ${ground ? "ground" : "a net of this Cell"}; it is drawn as a picture`,
        );
        return;
      }
      const id = deriveStableId("glyph", document.id, level.id, object.id);
      document.instances.push({
        id,
        symbolId: mapped.row.ac!,
        placement: placementOf(),
        ...paintOf(object),
      });
      net.terminals.push({ instanceId: id, pinName });
      const supply = supplyMarkerForSymbol(mapped.row.ac!);
      if (supply)
        document.connectivityEvidence.push({
          id: deriveStableId("connectivity-evidence", document.id, id),
          kind: "name-claim",
          netId: net.id,
          owner: { kind: "power-marker", objectId: id },
          powerDomain: supply.domain,
          ...(ground
            ? { name: supply.name, scope: supply.scope }
            : {
                name: named?.name ?? rnlIdName(String(attached), "&") ?? "VDD",
                scope: named?.scope ?? "local",
              }),
        });
      glyphOf.set(object.id, { instanceId: id, pinName });
      return;
    }
    marks.set(object.definition, (marks.get(object.definition) ?? 0) + 1);
  };
  return { glyphOf, openGlyphs, movedPins, placedPins, marks, read };
}

/**
 * What the drawing leaves of the Cell's Pins once its texts are read: the
 * Pins it does not place, the ports it shows only as a power label that
 * names them (#1783), and the placed Pins whose name label stays hidden;
 * with the native appearance, the Pins and grounds placed on their wires.
 */
export function drawnPins(
  { project, document, warn }: LevelScope,
  { movedPins, placedPins }: Pick<Glyphs, "movedPins" | "placedPins">,
  nativeAppearance: boolean,
): {
  undrawnPins: string[];
  powerLabelPorts: RnlPowerLabelPort[];
  hiddenLabels: RnlHiddenLabels[];
} {
  const undrawnPins: string[] = [];
  const powerLabelPorts: RnlPowerLabelPort[] = [];
  const hiddenLabels: RnlHiddenLabels[] = [];
  for (const terminal of document.netlist?.terminals ?? [])
    for (const id of terminal.interfaceInstanceIds)
      if (!movedPins.has(id)) undrawnPins.push(pinKey(document.id, id));
  // A port the drawing shows only as a power label that names it, no Pin
  // drawn (#1783): the label is the port, as the editor keeps a local power
  // label (withPowerLabelPorts, once the drawing is known to keep the
  // circuit).
  for (const terminal of document.netlist?.terminals ?? []) {
    const pinId = terminal.interfaceInstanceIds[0];
    if (!pinId || movedPins.has(pinId)) continue;
    const label = document.annotations.find(
      (item) =>
        item.kind === "power-label" &&
        item.netId === terminal.netId &&
        item.binding?.kind === "cell-terminal-name" &&
        item.binding.terminalId === terminal.id,
    );
    if (label)
      powerLabelPorts.push({
        documentId: document.id,
        terminalId: terminal.id,
        labelId: label.id,
      });
  }
  // A Cell Pin the drawing places but gives no name of its own keeps the
  // editor's default name label hidden, as a part's labels are; a net label
  // beside it may be what shows the name.
  for (const id of movedPins) {
    if (nativeAppearance && !placedPins.has(id)) continue;
    const terminal = document.netlist?.terminals.find((item) =>
      item.interfaceInstanceIds.includes(id),
    );
    if (
      terminal &&
      !document.annotations.some(
        (item) =>
          item.binding?.kind === "cell-terminal-name" &&
          item.binding.terminalId === terminal.id,
      )
    )
      hiddenLabels.push({
        documentId: document.id,
        instanceId: id,
        name: true,
        values: false,
      });
  }
  if (nativeAppearance) {
    const { unplacedPins, unplacedGrounds } = applyNativeRnlAppearance(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      placedPins,
    );
    if (unplacedPins.length)
      warn(
        "RNL_IMPORT_PIN_NOT_ROUTED",
        `No existing wire end could place Cell Pins on their Nets: ${unplacedPins.join(", ")}`,
      );
    if (unplacedGrounds)
      warn(
        "RNL_IMPORT_GROUND_NOT_PLACED",
        `${unplacedGrounds} ground wire ends kept their source labels because a native Ground could not land there`,
      );
  }
  return { undrawnPins, powerLabelPorts, hiddenLabels };
}
