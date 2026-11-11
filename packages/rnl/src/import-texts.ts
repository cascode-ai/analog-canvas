import {
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  richTextMetrics,
} from "@icm/derived";
import { encodeNetName } from "@icm/netlist";
import {
  deriveStableId,
  flattenRichText,
  labelTextDocument,
  sameStyledText,
  type Annotation,
  type Instance,
  type RouteBranch,
  type SchematicDocument,
} from "@icm/model";

import { AC_UNITS_PER_RNL_UNIT } from "./place.js";
import { acRichText } from "./text.js";
import {
  type RnlLevelSnapshot,
  type LevelModel,
  hasCanvasTypesetting,
  type RnlObjectView,
  type RnlTextView,
  rnlIdName,
  acPoint,
  NEAR,
  PART_GRID,
  CORNER_GRID,
  type Junction,
} from "./rnl-snapshot.js";
import { clockedByLabel } from "./import-symbols.js";

/**
 * Whether the netlist spells `name` as `printed`, its node in the file's own
 * dialect, where the two differ: a Greek letter spelled out, a bracket
 * dropped.
 */
function spelledAs(
  name: string,
  printed: string,
  scope: "local" | "global",
  format: "spice" | "spectre",
): boolean {
  if (name === printed) return false;
  const encoded = encodeNetName(name, scope, format);
  return encoded.ok && encoded.token === printed;
}

/** A text's size as the scale of the size Analog Canvas gives that label. */
export function sizeScale(size: number | null, base: number) {
  const scale = size === null ? 1 : (size * AC_UNITS_PER_RNL_UNIT) / base;
  return Math.abs(scale - 1) > 1e-3
    ? { sizeScale: Math.round(scale * 1e4) / 1e4 }
    : {};
}

/** A port drawn on no port of its Cell, and the junction its wires end at. */
export type OpenPort = {
  netId: string;
  object: RnlObjectView;
  junction?: Junction;
  /** Which way from the wire the junction lies. */
  away?: { x: number; y: number };
};

/**
 * The texts a level's RNL writes, as Analog Canvas labels and texts: a
 * part's name and values as its bound labels, a Cell Pin's name as its pin
 * label, a net's as a net label claiming the net by its own name, anything
 * else as a drawing text. Each stands where RNL puts it, on its baseline;
 * a label its symbol alone gives is left to the symbol.
 */
export function importTexts(
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: LevelModel,
  {
    consumed,
    glyphOf,
    ports,
    instanceOf,
    netOf,
    legNear,
    format,
    wiresNamed,
    canvasLooks,
    called,
  }: {
    consumed: ReadonlySet<string>;
    glyphOf: ReadonlyMap<string, { instanceId: string; pinName: string }>;
    /** Ports drawn on no port of the Cell, by glyph: the junction their wires end at. */
    ports: ReadonlyMap<string, OpenPort>;
    instanceOf: (name: string) => Instance | undefined;
    netOf: (id: string) => string | undefined;
    legNear: (
      point: { x: number; y: number },
      netId: string,
      reach: number,
      only?: string,
    ) => {
      route: RouteBranch;
      index: number;
      t: number;
      normalOffset: number;
    } | null;
    /** Whether a call meets the Cell's Pins, which it does by name. */
    /** The dialect the file is written in, which spells its names. */
    format: "spice" | "spectre";
    /** The file says which wire each net label is on (Canvas 0.4). */
    wiresNamed: boolean;
    /** Analog Canvas wrote the file, so its labels keep their looks. */
    canvasLooks: boolean;
    called: boolean;
  },
): void {
  const profile = resolveDocumentStyleProfile(document.presentation);
  const labelled = new Set(
    document.annotations.flatMap((item) =>
      item.anchor.kind === "object" ? [item.anchor.objectId] : [],
    ),
  );
  // What each label shows, where Analog Canvas wrote the level with Canvas
  // 0.2 (it says how the level sets names): the binding `$CANVAS_LABEL`
  // states, and a label without one holds its own text. A level another
  // tool wrote is read as its texts read.
  const canvasWritten = hasCanvasTypesetting(model);
  // Preserve label styles for Canvas-authored levels and source appearance.
  // Other external levels use the Canvas typography at the same positions.
  const scaled = canvasLooks ? sizeScale : () => ({});
  const statedOf = new Map(
    model.objects.flatMap((object) =>
      object.kind === "usage" &&
      object.definition === "$CANVAS_LABEL" &&
      typeof object.attach?.["label"] === "string"
        ? [[object.attach["label"], object.params ?? {}] as const]
        : [],
    ),
  );
  // A drawing text's typography role, where Canvas 0.4 states it.
  const tokenOf = new Map(
    model.objects.flatMap((object) => {
      const text = object.attach?.["text"];
      const token = object.params?.["token"];
      return object.kind === "usage" &&
        object.definition === "$CANVAS_TYPOGRAPHY" &&
        typeof text === "string" &&
        (token === "caption" || token === "body" || token === "label")
        ? [[text, token] as const]
        : [];
    }),
  );
  /** Undefined where the drawing does not say, null for its own text. */
  const stated = (text: RnlTextView) => {
    if (!canvasWritten) return undefined;
    const params = statedOf.get(text.id);
    return params && typeof params["bind"] === "string"
      ? (params as Readonly<Record<string, unknown>> & { bind: string })
      : null;
  };
  /**
   * The drawn text as a format of a bound label, where it differs from what
   * the binding shows anyway: the same text with other styles.
   */
  const boundText = (
    annotation: Omit<
      Annotation,
      "id" | "anchor" | "alignment" | "rotation" | "locked"
    >,
  ) =>
    resolveAnnotationText(document, {
      id: "",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
      ...annotation,
    });
  const formatted = (
    annotation: Parameters<typeof boundText>[0],
    content: NonNullable<Annotation["content"]>,
  ) =>
    !canvasLooks || sameStyledText(boundText(annotation), content)
      ? {}
      : { formatOverride: content };

  /**
   * A port drawn on no port of the Cell as a label of its net, claiming the
   * net by the name it has: on the junction its wires end at, showing what
   * its own text shows, else its net's name beyond the wire's end.
   */
  const portLabel = (
    glyph: string,
    port: OpenPort,
    text?: {
      at: { x: number; y: number };
      content: NonNullable<Annotation["content"]>;
      look: Pick<Annotation, "alignment" | "rotation" | "textColor"> & {
        sizeScale?: number;
      };
    },
  ) => {
    const named = document.importReference?.nets.find(
      (item) => item.id === port.netId,
    );
    if (!named) return;
    const id = deriveStableId("annotation", document.id, level.id, glyph);
    const { junction, away = { x: 0, y: 0 } } = port;
    const gap = 2 * CORNER_GRID;
    const at =
      text?.at ??
      (junction
        ? {
            x: junction.position.x + away.x * gap,
            y: junction.position.y + away.y * 2 * gap,
          }
        : acPoint(port.object.at.value ?? [0, 0]));
    const colour = port.object.style?.["textcolor"];
    const look = text?.look ?? {
      alignment:
        away.x > 0
          ? ("start" as const)
          : away.x < 0
            ? ("end" as const)
            : ("middle" as const),
      rotation: 0 as const,
      ...(typeof colour === "string" ? { textColor: colour } : {}),
    };
    const content =
      text?.content ?? labelTextDocument(named.name, document.presentation);
    const shown = flattenRichText(content);
    const name = spelledAs(shown, named.name, named.scope, format)
      ? shown
      : named.name;
    document.annotations.push({
      id,
      kind: "net-label",
      netId: port.netId,
      ...(shown === name
        ? {
            binding: { kind: "net-name" as const, netId: port.netId },
            ...(!canvasLooks ||
            sameStyledText(
              labelTextDocument(name, document.presentation),
              content,
            )
              ? {}
              : { formatOverride: content }),
          }
        : { content }),
      anchor: junction
        ? {
            kind: "object",
            objectId: junction.id,
            localOffset: {
              x: at.x - junction.position.x,
              y: at.y - junction.position.y,
            },
            fallbackPosition: at,
          }
        : { kind: "free", position: at },
      locked: false,
      ...look,
    });
    document.connectivityEvidence.push({
      id: deriveStableId("connectivity-evidence", document.id, id),
      kind: "name-claim",
      netId: port.netId,
      name,
      owner: { kind: "net-label", annotationId: id },
      scope: named.scope,
    });
  };

  model.texts.forEach((text, index) => {
    if (!text.written || consumed.has(text.id)) return;
    const content = acRichText(text.lines);
    if (!content) return;
    const says = stated(text);
    // Labels and texts stand on whole units.
    const exact = acPoint(text.anchor);
    const at = { x: Math.round(exact.x) + 0, y: Math.round(exact.y) + 0 };
    const id = deriveStableId("annotation", document.id, level.id, text.id);
    const rotation = ((360 - text.rotate) % 360) as 0 | 90 | 180 | 270;
    const alignment = (
      ["start", "middle", "end"].includes(text.halign) ? text.halign : "start"
    ) as "start" | "middle" | "end";
    // A label takes its part's colour as the editor's does from its Instance:
    // the colour its part has is no colour of its own.
    const textcolor = text.style["textcolor"];
    const ownerColour = model.objects.find(
      (object) => object.id === text.attach,
    )?.style?.["textcolor"];
    const color =
      canvasLooks &&
      typeof textcolor === "string" &&
      !(
        typeof ownerColour === "string" &&
        ownerColour.toLowerCase() === textcolor.toLowerCase()
      )
        ? { textColor: textcolor }
        : {};
    const shown = flattenRichText(content);
    const onObject = (instance: Instance) =>
      instance.placement
        ? {
            kind: "object" as const,
            objectId: instance.id,
            localOffset: {
              x: at.x - instance.placement.position.x,
              y: at.y - instance.placement.position.y,
            },
            fallbackPosition: at,
          }
        : { kind: "free" as const, position: at };
    const common = {
      alignment,
      rotation,
      locked: false,
      ...color,
    };

    // A part's labels, bound to its name or values.
    const part = text.attach && rnlIdName(text.attach, "#");
    const instance = part ? instanceOf(part) : undefined;
    const glyph = text.attach ? glyphOf.get(text.attach) : undefined;
    const pin = glyph && instanceOf(glyph.instanceId);
    const terminal = pin
      ? document.netlist?.terminals.find((item) =>
          item.interfaceInstanceIds.includes(pin.id),
        )
      : undefined;
    // A switch or chopper is clocked by the phase its label names: the label
    // holds that text itself, in place of one the import gave it.
    if (instance && text.key === "name" && clockedByLabel(instance)) {
      document.annotations = document.annotations.filter(
        (item) =>
          !(
            item.kind === "instance-label" &&
            !item.binding &&
            item.anchor.kind === "object" &&
            item.anchor.objectId === instance.id
          ),
      );
      labelled.add(instance.id);
      document.annotations.push({
        id: `instance-label-${instance.id}`,
        kind: "instance-label",
        content,
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    if (instance && text.key === "name" && !labelled.has(instance.id)) {
      labelled.add(instance.id);
      const binding = {
        kind: "instance-reference" as const,
        instanceId: instance.id,
      };
      document.annotations.push({
        id: `instance-label-${instance.id}`,
        kind: "instance-label",
        // Bound to the part's reference when it reads as that and the
        // drawing does not say otherwise; a name drawn otherwise (M1 on the
        // card XM1) is the label's own text, as drawn. A part the author
        // never named (Canvas 0.4) shows the name the netlist gave it,
        // which is no name of its own: its label is bound, and shows none.
        // The export says so of every bound label; one that holds the
        // author's own text says nothing, and keeps that text.
        ...(instance.reference === undefined && says?.bind === "name"
          ? { binding }
          : shown === instance.reference &&
              (says === undefined || says?.bind === "name")
            ? {
                binding,
                ...formatted({ kind: "instance-label", binding }, content),
              }
            : { content }),
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    const parameter =
      text.key && text.key !== "value" && text.key !== "name"
        ? text.key
        : undefined;
    if (
      instance &&
      (text.key === "value" ||
        (parameter && instance.netlist?.parameters[parameter] !== undefined))
    ) {
      // A parameter the drawing names says so, also one named `value`.
      const named =
        says?.bind === "parameter" && typeof says["parameter"] === "string"
          ? says["parameter"]
          : undefined;
      const shows = says === undefined ? parameter : named;
      const bound =
        says === undefined || says?.bind === "value" || named !== undefined;
      document.annotations.push({
        id,
        kind: "instance-value",
        ...(bound
          ? {
              binding: {
                kind: "instance-value" as const,
                instanceId: instance.id,
                ...(shows ? { parameter: shows } : {}),
                ...(shows && says?.["show_value"] === false
                  ? { showValue: false as const }
                  : {}),
              },
            }
          : { content }),
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    // A port drawn on no port of the Cell: its name is its net's label.
    const port = text.attach ? ports.get(text.attach) : undefined;
    if (port && text.key === "name" && !labelled.has(text.attach!)) {
      labelled.add(text.attach!);
      const colour = textcolor ?? ownerColour;
      portLabel(text.attach!, port, {
        at,
        content,
        look: {
          alignment,
          rotation,
          ...(canvasLooks && typeof colour === "string"
            ? { textColor: colour }
            : {}),
          ...scaled(text.size, profile.typography.netFontSize),
        },
      });
      return;
    }
    if (pin && terminal && text.key === "name" && !labelled.has(pin.id)) {
      labelled.add(pin.id);
      // A Pin's name the netlist had to spell otherwise (`SEL[3]` prints as
      // `SEL3_`) is the name its label shows, where the netlist spells that
      // so; only in a Cell no call meets, since a call meets Pins by name.
      if (
        (says === undefined || says?.bind === "port") &&
        !called &&
        spelledAs(shown, terminal.name, "local", format)
      )
        terminal.name = shown;
      const binding = {
        kind: "cell-terminal-name" as const,
        terminalId: terminal.id,
      };
      document.annotations.push({
        id: `instance-label-${pin.id}`,
        kind: "instance-label",
        ...(says === undefined || says?.bind === "port"
          ? {
              binding,
              // A name its label sets with a subscript (`N_V` as N with V
              // below) reads without the underscore.
              ...(shown === terminal.name ||
              shown ===
                flattenRichText(boundText({ kind: "instance-label", binding }))
                ? formatted({ kind: "instance-label", binding }, content)
                : {}),
            }
          : { content }),
        anchor: onObject(pin),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }

    // A net's or power label hangs where its record attaches it (13.3): on
    // a wire of its net, on the glyph or Cell Pin it hangs on, or on its net.
    const wire = text.attach
      ? model.wires.find((item) => item.id === text.attach)
      : undefined;
    const hungOn = glyph ? instanceOf(glyph.instanceId) : undefined;
    const netId = text.attach
      ? (netOf(text.attach) ??
        (wire?.nets.length === 1 ? netOf(wire.nets[0]!) : undefined) ??
        (hungOn
          ? document.nets.find((net) =>
              net.terminals.some((item) => item.instanceId === hungOn.id),
            )?.id
          : undefined))
      : undefined;
    /**
     * On the wire it is attached to, where it stands along it; in a file
     * that does not say which wire (before Canvas 0.4, or another tool's),
     * on the wire of its net it stands beside.
     */
    const onWire = (net: string) => {
      const leg = wire
        ? legNear(exact, net, Infinity, wire.id)
        : wiresNamed
          ? null
          : legNear(exact, net, 3 * PART_GRID);
      return leg
        ? {
            kind: "route" as const,
            routeId: leg.route.id,
            legId: leg.route.legs[leg.index]!.id,
            t: Math.round(leg.t * 1e9) / 1e9,
            normalOffset: Math.round(leg.normalOffset * 1e6) / 1e6 + 0,
            direction: "forward" as const,
            orientation: "follow" as const,
            fallbackPosition: at,
          }
        : undefined;
    };

    // A power label, which the export names for what it is: on the junction
    // of its net it stands beside, as Analog Canvas keeps one.
    if (netId && /^%power\d+$/u.test(text.id)) {
      // One that names the Cell Pin of its net shows that Pin's name.
      const port =
        says?.bind === "port"
          ? document.netlist?.terminals.find((item) => item.netId === netId)
          : undefined;
      // It hangs on the junction of its net it stands beside, else on the
      // Cell Pin it names, drawn as a supply, as Analog Canvas keeps one.
      const junction = document.junctions
        .filter((item) => item.netId === netId)
        .map((item) => ({
          id: item.id,
          at: item.position,
          distance: Math.hypot(item.position.x - at.x, item.position.y - at.y),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      const portPin = port?.interfaceInstanceIds
        .map((pinId) => instanceOf(pinId))
        .find((owner) => owner?.placement);
      const near =
        junction && junction.distance <= 4 * PART_GRID
          ? junction
          : portPin?.placement
            ? { id: portPin.id, at: portPin.placement.position }
            : undefined;
      const binding = port
        ? { kind: "cell-terminal-name" as const, terminalId: port.id }
        : undefined;
      document.annotations.push({
        id,
        kind: "power-label",
        netId,
        // Otherwise not bound to its net: a binding takes its name from a
        // claim the junction would have to own, which the netlist import
        // has not made.
        ...(binding && shown === port?.name
          ? {
              binding,
              ...formatted({ kind: "power-label", netId, binding }, content),
            }
          : { content }),
        anchor:
          (wire ? onWire(netId) : undefined) ??
          (hungOn ? onObject(hungOn) : undefined) ??
          (near
            ? {
                kind: "object",
                objectId: near.id,
                localOffset: { x: at.x - near.at.x, y: at.y - near.at.y },
                fallbackPosition: at,
              }
            : { kind: "free", position: at }),
        ...common,
        ...scaled(text.size, profile.typography.powerFontSize),
      });
      return;
    }

    // A net's label: the net named by its own name, which it already has.
    const named = document.importReference?.nets.find(
      (item) => item.id === netId,
    );
    if (netId && named) {
      // A name the netlist had to spell otherwise (`φ1` prints as `phi1`)
      // is the name the label shows, where the netlist spells that so.
      const name = spelledAs(shown, named.name, named.scope, format)
        ? shown
        : named.name;
      // Where its record attaches it: on a wire of its net, on what it hangs
      // on; attached to its net, on the Cell Pin it names, else where it
      // stands.
      const pin = document.netlist?.terminals
        .filter((item) => item.netId === netId)
        .flatMap((item) => item.interfaceInstanceIds)
        .flatMap((pinId) => {
          const owner = instanceOf(pinId);
          const place = owner?.placement?.position;
          return owner && place
            ? [{ owner, distance: Math.hypot(place.x - at.x, place.y - at.y) }]
            : [];
        })
        .sort((a, b) => a.distance - b.distance)[0];
      const anchor =
        (wire ? onWire(netId) : undefined) ??
        (hungOn
          ? onObject(hungOn)
          : pin && pin.distance <= 4 * PART_GRID + NEAR
            ? onObject(pin.owner)
            : (onWire(netId) ?? { kind: "free" as const, position: at }));
      document.annotations.push({
        id,
        kind: "net-label",
        netId,
        // A label Analog Canvas wrote without $CANVAS_LABEL shows a display
        // alias, its own text, and still names its net (#1880).
        ...(says === null
          ? { content }
          : {
              binding: { kind: "net-name" as const, netId },
              // The name its claim gives the net, set as the Cell sets names.
              ...(canvasLooks &&
              shown === name &&
              !sameStyledText(
                labelTextDocument(name, document.presentation),
                content,
              )
                ? { formatOverride: content }
                : {}),
            }),
        anchor,
        ...common,
        ...scaled(text.size, profile.typography.netFontSize),
      });
      document.connectivityEvidence.push({
        id: deriveStableId("connectivity-evidence", document.id, id),
        kind: "name-claim",
        netId,
        name,
        owner: { kind: "net-label", annotationId: id },
        scope: named.scope,
      });
      return;
    }

    // An instance label that stands free of any part, which the export names
    // for what it is.
    if (!text.attach && /^%free_label\d+$/u.test(text.id)) {
      document.annotations.push({
        id,
        kind: "instance-label",
        content,
        anchor: { kind: "free", position: at },
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }

    // Anything else is a drawing text, bold as the export writes one that
    // is not set plain (`bold`); text bold only in its markup is plain text
    // with bold runs, which draws the same.
    document.drafting ??= { objects: [] };
    const bold = text.style["bold"] === true;
    const token = tokenOf.get(text.id);
    const styleOverride = {
      ...(bold ? {} : { weight: "normal" as const }),
      ...(text.style["italic"] === true ? { italic: true } : {}),
      ...(color.textColor ? { color: color.textColor } : {}),
      ...scaled(text.size, richTextMetrics(profile, token).fontSize),
    };
    // On the part RNL hangs it on, as the editor anchors one; else where it
    // stands. The export hangs a drawing text on a part only.
    const host = instance;
    document.drafting.objects.push({
      id: deriveStableId(
        "drafting",
        document.id,
        level.id,
        text.id,
        String(index),
      ),
      locked: false,
      zIndex: document.drafting.objects.length,
      anchor: host ? onObject(host) : { kind: "free", position: at },
      kind: "text",
      content,
      alignment,
      rotation,
      ...(token ? { typographyToken: token } : {}),
      ...(Object.keys(styleOverride).length ? { styleOverride } : {}),
    });
  });
  for (const [glyph, port] of ports)
    if (!labelled.has(glyph)) portLabel(glyph, port);
}
