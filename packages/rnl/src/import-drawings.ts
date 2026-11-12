import {
  arrowArtwork,
  resolveDocumentStyleProfile,
  richTextMetrics,
} from "@icm/derived";
import { deriveStableId, type SchematicDocument } from "@icm/model";

import { AC_UNITS_PER_RNL_UNIT } from "./place.js";
import {
  type RnlLevelSnapshot,
  type LevelModel,
  type Point,
  type RnlShapeView,
  acPoint,
} from "./rnl-snapshot.js";
import type { LevelScope } from "./import-scope.js";

/** Whether every number in a value is finite. */
function finite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object")
    return Object.values(value).every(finite);
  return true;
}

/**
 * The scene's graphics as drawing objects, in the order RNL draws them: a
 * rectangle or circle as one, a closed line that is a turned rectangle as a
 * turned rectangle, a line or curve with an arrow as an arrow, any other as
 * a construction line (a cubic leg as the quadratic it was raised from, or
 * the nearest one), an ellipse or arc as the curve that draws it. The bottom
 * layer is the background plane. The count of shapes not read is returned.
 */
function importShapes(
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  shapes: readonly RnlShapeView[],
): { unread: number; unfilled: number } {
  if (!shapes.length) return { unread: 0, unfilled: 0 };
  const profile = resolveDocumentStyleProfile(document.presentation);
  let unread = 0;
  let unfilled = 0;
  document.drafting ??= { objects: [] };
  const objects = document.drafting.objects;
  const whole = ([x, y]: Point) => {
    const point = acPoint([x, y]);
    return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 };
  };
  // A shape whose numbers do not make one is left unread, and the drawing
  // keeps the rest.
  const keep = (object: (typeof objects)[number]) => {
    if (finite(object)) objects.push(object);
    else unread += 1;
  };
  for (const shape of shapes) {
    const style = shape.style;
    const lineStyle: "solid" | "dashed" | "dotted" =
      style["linestyle"] === "dashed" || style["linestyle"] === "dotted"
        ? style["linestyle"]
        : "solid";
    const color =
      typeof style["linecolor"] === "string" ? style["linecolor"] : undefined;
    const fillColor =
      shape.params["fill"] === "fillcolor" &&
      typeof style["fillcolor"] === "string"
        ? style["fillcolor"]
        : shape.params["fill"] === "linecolor"
          ? (color ?? profile.foreground)
          : undefined;
    const width = Number(style["linewidth"]);
    const strokeScale =
      width > 0
        ? Math.min(
            4,
            Math.max(
              0.25,
              (width * AC_UNITS_PER_RNL_UNIT) / profile.strokes.annotation,
            ),
          )
        : undefined;
    const styleOverride = {
      ...(color ? { color } : {}),
      ...(strokeScale && Math.abs(strokeScale - 1) > 1e-3
        ? { strokeScale: Math.round(strokeScale * 1e3) / 1e3 }
        : {}),
    };
    // An object keeps the line style it is made with, a closed shape solid
    // and a construction line dashed, and the one it is drawn with as its
    // override where they differ, as the editor sets one.
    const drawnOver = (made: "solid" | "dashed") =>
      lineStyle !== made ? { lineStyle } : {};
    const base = (anchor: { x: number; y: number }) => ({
      id: deriveStableId("drafting", document.id, level.id, shape.id),
      locked: false,
      zIndex: objects.length,
      anchor: { kind: "free" as const, position: anchor },
    });
    const layer =
      shape.layer === "bottom" ? { layer: "background" as const } : {};
    const filled = fillColor ? { fillColor } : {};
    const points = shape.points.map(whole);
    // A rectangle, circle or ellipse is written with its size, at its centre,
    // or without it, on two points: a rectangle's or an ellipse's opposite
    // corners, a circle's centre and a point on it (13.4).
    const [from, to] = shape.points.map((point) => acPoint(point));
    const twoPoints =
      shape.params["width"] === undefined &&
      shape.params["radius"] === undefined &&
      from !== undefined &&
      to !== undefined;
    const middle = (point: { x: number; y: number }) => ({
      x: Math.round(point.x) + 0,
      y: Math.round(point.y) + 0,
    });
    const ellipse =
      shape.shape !== "ellipse"
        ? undefined
        : twoPoints
          ? {
              center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
              width: Math.abs(to.x - from.x),
              height: Math.abs(to.y - from.y),
            }
          : {
              center: points[0] ?? { x: 0, y: 0 },
              width: Number(shape.params["width"]) * AC_UNITS_PER_RNL_UNIT,
              height: Number(shape.params["height"]) * AC_UNITS_PER_RNL_UNIT,
            };
    // An ellipse as wide as it is high is a circle.
    const round =
      ellipse !== undefined && Math.abs(ellipse.width - ellipse.height) < 1;
    if (shape.shape === "rectangle" || shape.shape === "circle" || round) {
      const corners = shape.shape === "rectangle" && twoPoints;
      const center = corners
        ? middle({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
        : round
          ? middle(ellipse.center)
          : points[0]!;
      const size = (key: string) =>
        Math.max(
          1,
          Math.round(
            corners
              ? Math.abs(key === "width" ? to.x - from.x : to.y - from.y)
              : round
                ? ellipse.width / 2
                : shape.shape === "circle" && twoPoints
                  ? Math.hypot(to.x - from.x, to.y - from.y)
                  : Number(shape.params[key]) * AC_UNITS_PER_RNL_UNIT,
          ),
        );
      keep(
        shape.shape === "rectangle"
          ? {
              ...base(center),
              kind: "rectangle",
              center,
              width: size("width"),
              height: size("height"),
              rotation: 0,
              lineStyle: "solid",
              ...layer,
              styleOverride: {
                ...styleOverride,
                ...drawnOver("solid"),
                ...filled,
              },
            }
          : {
              ...base(center),
              kind: "circle",
              center,
              radius: size(round ? "width" : "radius"),
              lineStyle: "solid",
              ...layer,
              styleOverride: {
                ...styleOverride,
                ...drawnOver("solid"),
                ...filled,
              },
            },
      );
      continue;
    }
    if (!["line", "bezier", "ellipse", "arc"].includes(shape.shape)) {
      unread += 1;
      continue;
    }
    // Analog Canvas draws no ellipse or arc of its own, nor fills a curve:
    // each is the curve that draws it, without its fill.
    if ((shape.shape === "ellipse" || shape.shape === "arc") && fillColor)
      unfilled += 1;
    const turned =
      shape.shape === "line"
        ? turnedRectangle(shape.points.map((point) => acPoint(point)))
        : null;
    if (turned) {
      keep({
        ...base(turned.center),
        kind: "rectangle",
        ...turned,
        lineStyle: "solid",
        ...layer,
        styleOverride: { ...styleOverride, ...drawnOver("solid"), ...filled },
      });
      continue;
    }
    const path =
      shape.shape === "bezier"
        ? quadraticPath(shape.points.map((point) => acPoint(point)))
        : ellipse
          ? ellipticCurve(
              ellipse.center,
              ellipse.width / 2,
              ellipse.height / 2,
              0,
              2 * Math.PI,
            )
          : shape.shape === "arc"
            ? arcCurve(shape.points.map((point) => acPoint(point)))
            : { points, controls: [] as ({ x: number; y: number } | null)[] };
    const arrow = String(shape.params["arrow"] ?? "none");
    if (arrow !== "none" && path.points.length >= 2) {
      const ends = {
        ...(arrow === "start" || arrow === "both"
          ? { arrowStart: "medium-arrow" as const }
          : {}),
        ...(arrow === "end" || arrow === "both"
          ? { arrowEnd: "medium-arrow" as const }
          : { arrowEnd: "none" as const }),
      };
      keep({
        ...base(path.points[0]!),
        kind: "arrow",
        from: { kind: "free", position: path.points[0]! },
        to: { kind: "free", position: path.points.at(-1)! },
        ...(path.points.length > 2
          ? { waypoints: path.points.slice(1, -1) }
          : {}),
        ...(path.controls.some(Boolean)
          ? { curveControls: path.controls }
          : {}),
        // An arrow is made solid; the line it is drawn with is its own.
        styleOverride: { ...styleOverride, ...drawnOver("solid"), ...ends },
      });
      continue;
    }
    keep({
      ...base(path.points[0]!),
      kind: "construction-line",
      points: path.points,
      ...(path.controls.some(Boolean) ? { curveControls: path.controls } : {}),
      lineStyle: "dashed",
      ...(Object.keys({ ...styleOverride, ...drawnOver("dashed") }).length
        ? { styleOverride: { ...styleOverride, ...drawnOver("dashed") } }
        : {}),
    });
  }
  return { unread, unfilled };
}

/**
 * The name the export writes a drawing object's shapes and texts under, for
 * a kind RNL has no form of its own for: the object's (`%arrow3`), and each
 * part's after it (`%arrow3_end`, `%callout1_text`, `%polarity2_plus1`).
 */
const DRAWING_GROUP =
  /^%(arrow|leader|callout|polarity)(\d+)(?:_([a-z]+\d*))?$/u;

export type DraftingObject = NonNullable<
  SchematicDocument["drafting"]
>["objects"][number];

export type XY = { x: number; y: number };

/** A drawing object's path: a construction line's or an arrow's points. */
function pathOf(
  object: DraftingObject,
): { points: XY[]; controls: (XY | null)[] } | null {
  if (object.kind === "construction-line")
    return {
      points: [...object.points],
      controls: [...(object.curveControls ?? [])],
    };
  if (
    object.kind === "arrow" &&
    object.from.kind === "free" &&
    object.to.kind === "free"
  )
    return {
      points: [
        object.from.position,
        ...(object.waypoints ?? []),
        object.to.position,
      ],
      controls: [...(object.curveControls ?? [])],
    };
  return null;
}

/** A line's look, as a drawing object other than a closed shape keeps it. */
function lineLook(object: DraftingObject) {
  const lineStyle =
    object.styleOverride?.lineStyle ??
    (object.kind === "construction-line" ||
    object.kind === "rectangle" ||
    object.kind === "circle"
      ? object.lineStyle
      : undefined);
  return {
    ...(object.styleOverride?.color
      ? { color: object.styleOverride.color }
      : {}),
    ...(object.styleOverride?.strokeScale
      ? { strokeScale: object.styleOverride.strokeScale }
      : {}),
    ...(lineStyle && lineStyle !== "solid" ? { lineStyle } : {}),
  };
}

/** An arrow head's style for its size against the drawing's own. */
function headStyle(
  scale: number,
): "small-arrow" | "medium-arrow" | "large-arrow" {
  return scale < 0.875
    ? "small-arrow"
    : scale > 1.25
      ? "large-arrow"
      : "medium-arrow";
}

/**
 * Drawing objects of kinds RNL has no form for, which the export writes as
 * shapes and texts named after the object (`DRAWING_GROUP`): what the
 * import made of each group becomes the one object again, where it stood
 * in the stacking order. An arrow's heads and dots are its ends' styles, an
 * outlined arrow the outline it draws, a callout its line and text, a
 * polarity text its words and marks. Returns how many groups stay as drawn.
 */
function regroupDrawings(
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: LevelModel,
): number {
  const objects = document.drafting?.objects;
  if (!objects?.length) return 0;
  const profile = resolveDocumentStyleProfile(document.presentation);
  type Member = {
    role: string | null;
    object: DraftingObject;
    shape?: RnlShapeView;
  };
  const groups = new Map<string, { kind: string; members: Member[] }>();
  const byId = new Map(objects.map((object) => [object.id, object]));
  const join = (rnlId: string, objectId: string, shape?: RnlShapeView) => {
    const match = DRAWING_GROUP.exec(rnlId);
    const object = byId.get(objectId);
    if (!match || !object) return;
    const name = `%${match[1]}${match[2]}`;
    const group = groups.get(name) ?? { kind: match[1] ?? "", members: [] };
    group.members.push({
      role: match[3] ?? null,
      object,
      ...(shape ? { shape } : {}),
    });
    groups.set(name, group);
  };
  for (const shape of model.shapes ?? [])
    join(
      shape.id,
      deriveStableId("drafting", document.id, level.id, shape.id),
      shape,
    );
  model.texts.forEach((text, index) =>
    join(
      text.id,
      deriveStableId("drafting", document.id, level.id, text.id, String(index)),
    ),
  );
  const free = (position: XY) => ({ kind: "free" as const, position });
  const near = (a: XY, b: XY, by: number) =>
    Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by;
  const mid = (a: XY, b: XY) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const span = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

  const rebuild = (
    name: string,
    kind: string,
    members: readonly Member[],
  ): DraftingObject | null => {
    const part = (role: string | null) =>
      members.find((member) => member.role === role);
    const common = (anchor: XY) => ({
      id: deriveStableId("drafting", document.id, level.id, name),
      locked: false,
      zIndex: 0,
      anchor: free(onUnits(anchor)),
    });
    const line = part(null)?.object;
    const path = line ? pathOf(line) : null;
    const first = path?.points[0];
    const last = path?.points.at(-1);
    // An arrow's end with a dot drawn there is a dot, whatever else it is.
    const ends = (start: ArrowEnd, end: ArrowEnd) =>
      ({
        arrowStart: part("start")?.object.kind === "circle" ? "dot" : start,
        arrowEnd: part("end")?.object.kind === "circle" ? "dot" : end,
      }) satisfies Record<string, ArrowEnd>;
    switch (kind) {
      case "leader":
        if (!line || !first || !last) return null;
        return {
          ...common(first),
          kind: "leader",
          target: free(last),
          ...(Object.keys(lineLook(line)).length
            ? { styleOverride: lineLook(line) }
            : {}),
        };
      case "callout": {
        const text = part("text")?.object;
        if (!line || !last || text?.kind !== "text") return null;
        const { color, ...stroke } = lineLook(line);
        const style = {
          ...text.styleOverride,
          ...stroke,
          ...(color && !text.styleOverride?.color ? { color } : {}),
        };
        return {
          ...common(last),
          anchor: text.anchor,
          kind: "callout",
          content: text.content,
          alignment: text.alignment,
          rotation: text.rotation,
          ...(text.typographyToken
            ? { typographyToken: text.typographyToken }
            : {}),
          target: free(last),
          ...(Object.keys(style).length ? { styleOverride: style } : {}),
        };
      }
      case "polarity": {
        const plus = members.some((member) => member.role?.startsWith("plus"));
        const minus = members.some((member) => member.role === "minus");
        const polarity =
          plus && minus
            ? "both"
            : plus
              ? "positive"
              : minus
                ? "negative"
                : null;
        if (!polarity) return null;
        if (line?.kind === "text")
          return { ...line, id: common(first ?? { x: 0, y: 0 }).id, polarity };
        // A mark alone: its stroke across, centred on its anchor, is as
        // long as its words' size makes it, as the file draws it: a drawing
        // object stands on whole units, which would change its size.
        const stroke = part("plus1") ?? part("minus");
        const mark = stroke?.object;
        const [from, to] = (mark && pathOf(mark)?.points) ?? [];
        if (!mark || !from || !to) return null;
        const [start, end] = stroke.shape?.points ?? [];
        const length =
          start && end
            ? Math.hypot(start[0] - end[0], start[1] - end[1]) *
              AC_UNITS_PER_RNL_UNIT
            : span(from, to);
        const fontSize = length / 2 / 0.23;
        const sizeScale =
          Math.round((fontSize / richTextMetrics(profile).fontSize) * 1e3) /
          1e3;
        const { color } = lineLook(mark);
        const style = {
          ...(Math.abs(sizeScale - 1) > 1e-3 ? { sizeScale } : {}),
          ...(color ? { color } : {}),
        };
        return {
          ...common(mid(from, to)),
          kind: "text",
          content: { runs: [{ kind: "line-break" as const }] },
          alignment: "middle",
          rotation: 0,
          polarity,
          ...(Object.keys(style).length ? { styleOverride: style } : {}),
        };
      }
      case "arrow": {
        const outline = part("outline");
        if (outline?.shape) return outlined(outline, outline.shape);
        if (!line || !path || !first || !last) return null;
        // A filled head is the shaft's own, its size the larger head's.
        const drawn = part(null)?.shape;
        const filled = String(drawn?.params["arrow"] ?? "none");
        const scale =
          (Number(drawn?.style["arrowsize"]) * AC_UNITS_PER_RNL_UNIT) /
          (profile.annotations.arrowHeadLength *
            (line.styleOverride?.strokeScale ?? 1));
        const tips = { start: first, end: last };
        const end = (which: "start" | "end"): ArrowEnd => {
          const object = part(which)?.object;
          const tip = object && pathOf(object)?.points;
          // An open head is drawn by itself, the shaft ending at its base.
          if (tip && tip.length >= 4 && tip[0]) {
            tips[which] = tip[0];
            return "open-arrow";
          }
          return filled === which || filled === "both"
            ? headStyle(scale > 0 ? scale : 1)
            : "none";
        };
        const styles = ends(end("start"), end("end"));
        return {
          ...common(tips.start),
          kind: "arrow",
          from: free(tips.start),
          to: free(tips.end),
          ...(path.points.length > 2
            ? { waypoints: path.points.slice(1, -1) }
            : {}),
          ...(path.controls.some(Boolean)
            ? { curveControls: path.controls }
            : {}),
          styleOverride: { ...lineLook(line), ...styles },
        };
      }
      default:
        return null;
    }

    /**
     * An outlined arrow from the outline it draws: its tips and the ends of
     * its shaft are where the outline says, read each way it could be and
     * kept where Analog Canvas draws that arrow so again.
     */
    function outlined(
      outline: Member,
      shape: RnlShapeView,
    ): DraftingObject | null {
      const arrow = (
        from: XY,
        to: XY,
        width: number,
        styles: { arrowStart: ArrowEnd; arrowEnd: ArrowEnd },
      ) => ({
        ...common(from),
        kind: "arrow" as const,
        from: free(onUnits(from)),
        to: free(onUnits(to)),
        outline: { width: Math.round(width * 100) / 100 },
        styleOverride: { ...lineLook(outline.object), ...styles },
      });
      const [center] = shape.points;
      if (shape.shape === "rectangle" && center) {
        // A shaft with no heads, square to the axes, is written as a
        // rectangle: its longer side runs from its start to its end, which
        // a dot at either end tells apart.
        const at = acPoint(center);
        const size = (key: string) =>
          Number(shape.params[key]) * AC_UNITS_PER_RNL_UNIT;
        const long = size("width") >= size("height");
        const half = size(long ? "width" : "height") / 2;
        const a = long
          ? { x: at.x - half, y: at.y }
          : { x: at.x, y: at.y - half };
        const b = long
          ? { x: at.x + half, y: at.y }
          : { x: at.x, y: at.y + half };
        const dot = (role: string) => {
          const object = part(role)?.object;
          return object?.kind === "circle" ? object.center : null;
        };
        const startDot = dot("start");
        const endDot = dot("end");
        const reversed = startDot
          ? span(startDot, b) < span(startDot, a)
          : endDot
            ? span(endDot, a) < span(endDot, b)
            : false;
        const [from, to] = reversed ? [b, a] : [a, b];
        return arrow(
          from,
          to,
          size(long ? "height" : "width") / 0.4,
          ends("none", "none"),
        );
      }
      const drawn = shape.points.map((point) => acPoint(point));
      const [head] = drawn;
      const tail = drawn.at(-1);
      if (head && tail && drawn.length > 1 && near(head, tail, 1e-3))
        drawn.pop();
      // The neck is a fifth of the width each side of the shaft; a head is
      // its scale times the width across.
      const neck = (a: XY, b: XY) => span(a, b) / 0.4;
      const readings: {
        from: XY;
        to: XY;
        width: number;
        start: number;
        end: number;
      }[] = [];
      if (drawn.length === 4) {
        const [a, b, c, d] = drawn as [XY, XY, XY, XY];
        readings.push({
          from: mid(a, d),
          to: mid(b, c),
          width: neck(a, d),
          start: 0,
          end: 0,
        });
      }
      if (drawn.length === 7) {
        const [a, b, c, d, e, , g] = drawn as [XY, XY, XY, XY, XY, XY, XY];
        const toHead = neck(a, g);
        readings.push({
          from: mid(a, g),
          to: d,
          width: toHead,
          start: 0,
          end: span(c, e) / toHead,
        });
        const [, , , , p, q, r] = drawn as [XY, XY, XY, XY, XY, XY, XY];
        const fromHead = neck(b, c);
        readings.push({
          from: q,
          to: mid(b, c),
          width: fromHead,
          start: span(p, r) / fromHead,
          end: 0,
        });
      }
      if (drawn.length === 10) {
        const [, b, c, d, e, f, , h, i, j] = drawn as [
          XY,
          XY,
          XY,
          XY,
          XY,
          XY,
          XY,
          XY,
          XY,
          XY,
        ];
        const both = neck(b, f);
        readings.push({
          from: i,
          to: d,
          width: both,
          start: span(h, j) / both,
          end: span(c, e) / both,
        });
      }
      for (const reading of readings) {
        const candidate = arrow(
          reading.from,
          reading.to,
          reading.width,
          ends(
            reading.start ? headStyle(reading.start) : "none",
            reading.end ? headStyle(reading.end) : "none",
          ),
        );
        const again = arrowArtwork(
          candidate,
          [reading.from, reading.to],
          [],
          profile,
        ).outline;
        if (
          again?.length === drawn.length &&
          again.every((point, index) => {
            const other = drawn[index];
            return other !== undefined && near(point, other, 1.5);
          })
        )
          return candidate;
      }
      return null;
    }
  };

  let unjoined = 0;
  for (const [name, group] of groups) {
    const object = rebuild(name, group.kind, group.members);
    if (!object) {
      unjoined += 1;
      continue;
    }
    // It stands where its first shape stood: shapes come in the order RNL
    // draws them, texts all before them.
    const gone = new Set(group.members.map((member) => member.object));
    const shapes = group.members.filter((member) => member.shape);
    const first = Math.min(
      ...(shapes.length ? shapes : group.members).map((member) =>
        objects.indexOf(member.object),
      ),
    );
    const at = objects.slice(0, first).filter((item) => !gone.has(item)).length;
    const kept = objects.filter((item) => !gone.has(item));
    objects.splice(
      0,
      objects.length,
      ...kept.slice(0, at),
      object,
      ...kept.slice(at),
    );
  }
  objects.forEach((object, index) => {
    object.zIndex = index;
  });
  return unjoined;
}

export type ArrowEnd = NonNullable<
  NonNullable<DraftingObject["styleOverride"]>["arrowStart"]
>;

/** A point on Analog Canvas's whole units. */
const onUnits = (point: { x: number; y: number }) => ({
  x: Math.round(point.x) + 0,
  y: Math.round(point.y) + 0,
});

/**
 * An elliptic arc as Analog Canvas's curve: legs of at most an eighth of a
 * turn, each the quadratic through its ends whose control is where their
 * tangents meet, within a third of a percent of the arc. The radii run
 * along the axes; the arc runs from `start` by `sweep`, in radians.
 */
function ellipticCurve(
  center: { x: number; y: number },
  rx: number,
  ry: number,
  start: number,
  sweep: number,
): {
  points: { x: number; y: number }[];
  controls: ({ x: number; y: number } | null)[];
} {
  const legs = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 4) - 1e-9));
  const step = sweep / legs;
  const at = (angle: number, reach = 1) =>
    onUnits({
      x: center.x + rx * reach * Math.cos(angle),
      y: center.y + ry * reach * Math.sin(angle),
    });
  return {
    points: Array.from({ length: legs + 1 }, (_, leg) =>
      at(start + leg * step),
    ),
    controls: Array.from({ length: legs }, (_, leg) =>
      at(start + (leg + 0.5) * step, 1 / Math.cos(step / 2)),
    ),
  };
}

/**
 * A circular arc from its first point through its second to its third, as
 * Analog Canvas's curve; three points in a line are the line through them.
 */
function arcCurve(points: readonly { x: number; y: number }[]): {
  points: { x: number; y: number }[];
  controls: ({ x: number; y: number } | null)[];
} {
  const [a, b, c] = points as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6)
    return { points: [a, b, c].map(onUnits), controls: [null, null] };
  const square = (p: typeof a) => p.x * p.x + p.y * p.y;
  const center = {
    x:
      (square(a) * (b.y - c.y) +
        square(b) * (c.y - a.y) +
        square(c) * (a.y - b.y)) /
      d,
    y:
      (square(a) * (c.x - b.x) +
        square(b) * (a.x - c.x) +
        square(c) * (b.x - a.x)) /
      d,
  };
  const radius = Math.hypot(a.x - center.x, a.y - center.y);
  const angle = (p: typeof a) => Math.atan2(p.y - center.y, p.x - center.x);
  const turn = 2 * Math.PI;
  const onward = (from: number, to: number) =>
    (((to - from) % turn) + turn) % turn;
  // The way from the first point to the third that passes the second.
  const ahead = onward(angle(a), angle(c));
  const sweep = onward(angle(a), angle(b)) <= ahead ? ahead : ahead - turn;
  return ellipticCurve(center, radius, radius, angle(a), sweep);
}

/** A closed line round four right-angled corners, as a turned rectangle. */
function turnedRectangle(points: readonly { x: number; y: number }[]): {
  center: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
} | null {
  if (points.length !== 5) return null;
  const [a, b, c, d, e] = points as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  if (Math.abs(a.x - e.x) > 1 || Math.abs(a.y - e.y) > 1) return null;
  const side = (p: typeof a, q: typeof a) => ({ x: q.x - p.x, y: q.y - p.y });
  const ab = side(a, b);
  const bc = side(b, c);
  const cd = side(c, d);
  const right = (u: typeof ab, v: typeof ab) =>
    Math.abs(u.x * v.x + u.y * v.y) <=
    2 * (Math.hypot(u.x, u.y) + Math.hypot(v.x, v.y));
  if (
    !right(ab, bc) ||
    !right(bc, cd) ||
    Math.abs(ab.x + cd.x) > 2 ||
    Math.abs(ab.y + cd.y) > 2
  )
    return null;
  const width = Math.round(Math.hypot(ab.x, ab.y));
  const height = Math.round(Math.hypot(bc.x, bc.y));
  if (!width || !height) return null;
  const degrees = (Math.atan2(ab.y, ab.x) * 180) / Math.PI;
  return {
    center: {
      x: Math.round((a.x + c.x) / 2) + 0,
      y: Math.round((a.y + c.y) / 2) + 0,
    },
    width,
    height,
    rotation: Math.round(((degrees % 360) + 360) % 360) % 360,
  };
}

/**
 * A cubic Bézier path as Analog Canvas's: its ends, each leg's quadratic
 * control (null for a straight leg), the one a raised quadratic came from
 * or the nearest. It takes exact points, since a raised control falls
 * between units; the path it returns stands on whole units.
 */
function quadraticPath(points: readonly { x: number; y: number }[]): {
  points: { x: number; y: number }[];
  controls: ({ x: number; y: number } | null)[];
} {
  const whole = ({ x, y }: { x: number; y: number }) => ({
    x: Math.round(x) + 0,
    y: Math.round(y) + 0,
  });
  const ends = [whole(points[0]!)];
  const controls: ({ x: number; y: number } | null)[] = [];
  for (let index = 0; index + 3 < points.length; index += 3) {
    const [from, c1, c2, to] = points.slice(index, index + 4) as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const third = (t: number) => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    const near = (p: typeof from, q: typeof from) =>
      Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1;
    const straight = near(c1, third(1 / 3)) && near(c2, third(2 / 3));
    ends.push(whole(to));
    controls.push(
      straight
        ? null
        : whole({
            x:
              (from.x + 1.5 * (c1.x - from.x) + to.x + 1.5 * (c2.x - to.x)) / 2,
            y:
              (from.y + 1.5 * (c1.y - from.y) + to.y + 1.5 * (c2.y - to.y)) / 2,
          }),
    );
  }
  return { points: ends, controls };
}

/** The level's shapes, and the drawing objects their names group again. */
export function importDrawings({
  document,
  level,
  model,
  warn,
}: LevelScope): void {
  const { unread, unfilled } = importShapes(
    document,
    level,
    model.shapes ?? [],
  );
  if (unread)
    warn(
      "RNL_IMPORT_SHAPE_SKIPPED",
      `${unread} shapes RNL draws are of no kind Analog Canvas reads back, or have sizes that make none`,
    );
  if (unfilled)
    warn(
      "RNL_IMPORT_SHAPE_UNFILLED",
      `${unfilled} filled ellipses and arcs are drawn as curves without their fill: Analog Canvas fills only rectangles and circles`,
    );
  const unjoined = regroupDrawings(document, level, model);
  if (unjoined)
    warn(
      "RNL_IMPORT_DRAWING_UNJOINED",
      `${unjoined} drawing objects named as Analog Canvas writes them do not read back as one; their shapes and texts stay as drawn`,
    );
}
