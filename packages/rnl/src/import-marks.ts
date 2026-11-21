import { resolveDocumentStyleProfile } from "@icm/derived";
import { deriveStableId } from "@icm/model";

import { acOrientation } from "./orientation.js";
import { acPosition } from "./place.js";
import { acRichText } from "./text.js";
import {
  type Point,
  type RnlObjectView,
  type RnlTextView,
  acPoint,
  isOrient,
} from "./rnl-snapshot.js";
import { acSymbolFor } from "./import-symbols.js";
import { sizeScale } from "./import-texts.js";
import { type LevelScope } from "./import-scope.js";
import { type WireRoutes } from "./import-routes.js";

/**
 * The marks on a level's wires (arrows, current and voltage markers) and its
 * figures, once the wires are routes; returns the texts they take as their
 * labels. A mark read back no way is counted in `marks` and reported.
 */
export function readMarks(
  { document, level, model, symbols, warn }: LevelScope,
  { legAt }: Pick<WireRoutes, "legAt">,
  later: readonly RnlObjectView[],
  marks: Map<string, number>,
): Set<string> {
  // Marks on wires, and figures. A current marker's label is the marker's.
  const consumed = new Set<string>();
  const headLength = resolveDocumentStyleProfile(document.presentation)
    .annotations.arrowHeadLength;
  /** A marker's label size and colour, as the export wrote them. */
  const markerLook = (text: RnlTextView) => ({
    ...(typeof text.style["textcolor"] === "string"
      ? { textColor: text.style["textcolor"] }
      : {}),
    ...sizeScale(
      text.size,
      resolveDocumentStyleProfile(document.presentation).typography
        .annotationFontSize,
    ),
  });
  /**
   * A wire's direction arrow, or a current marker with its label, whose
   * head stands centred on `point` pointing along `unit` (Analog Canvas axes).
   */
  const readArrow = (
    definition: "$ARROW" | "$CURRENT_ARROW",
    point: { x: number; y: number },
    unit: { x: number; y: number },
    label: RnlTextView | undefined,
    id: string,
  ) => {
    if (definition === "$ARROW") {
      // The head's tip, half a head ahead of its point, on the wire.
      const tip = {
        x: point.x + unit.x * (headLength / 2),
        y: point.y + unit.y * (headLength / 2),
      };
      const leg = legAt(tip);
      if (!leg) {
        marks.set("$ARROW", (marks.get("$ARROW") ?? 0) + 1);
        return;
      }
      leg.route.styleOverride = {
        ...leg.route.styleOverride,
        arrow: leg.atSourceEnd ? "end" : "middle",
      };
      return;
    }
    // A current marker on the wire it sits on, its label beside.
    const leg = legAt(point);
    const content = label ? acRichText(label.lines) : null;
    if (!leg || !content) {
      marks.set("$CURRENT_ARROW", (marks.get("$CURRENT_ARROW") ?? 0) + 1);
      return;
    }
    const dx = (leg.to.x - leg.from.x) / leg.length;
    const dy = (leg.to.y - leg.from.y) / leg.length;
    const along = dx * unit.x + dy * unit.y;
    const labelPoint = acPoint(label!.anchor);
    // RNL keeps a millionth of its unit, which a slanted wire's label point
    // rounds: to a ten-thousandth of Analog Canvas's.
    const normalOffset =
      Math.round(
        ((labelPoint.x - point.x) * -dy + (labelPoint.y - point.y) * dx) * 1e4,
      ) /
        1e4 +
      0;
    document.annotations.push({
      id: deriveStableId("annotation", document.id, level.id, id),
      kind: "route-marker",
      content,
      anchor: {
        kind: "route",
        routeId: leg.route.id,
        legId: leg.route.legs[leg.index]!.id,
        t: Math.round(leg.t * 1e9) / 1e9,
        normalOffset: Math.abs(along) > 0.5 ? normalOffset : 0,
        direction: along < 0 ? "reverse" : "forward",
        // An arrow across its wire is the one set level.
        orientation: Math.abs(along) > 0.5 ? "follow" : "horizontal",
        fallbackPosition: { x: Math.round(point.x), y: Math.round(point.y) },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      markerKind: "current",
      ...markerLook(label!),
    });
    consumed.add(label!.id);
  };
  for (const object of later) {
    const at = object.at.value ?? null;
    // A current arrow marks its point `p`; an arrow head or a figure is drawn
    // on its point `at`.
    const attached =
      object.attach?.[object.definition === "$CURRENT_ARROW" ? "p" : "at"];
    const place = Array.isArray(attached) ? (attached as Point) : at;
    const orient = object.orient.value ?? "R0";
    if (!place || !isOrient(orient) || orient.startsWith("M")) {
      marks.set(object.definition!, (marks.get(object.definition!) ?? 0) + 1);
      continue;
    }
    const unit = UNIT[orient as "R0" | "R90" | "R180" | "R270"];
    const point = acPoint(place);
    if (object.definition === "$FIGURE") {
      const symbol = object.symbol.value
        ? symbols.get(object.symbol.value)
        : undefined;
      const mapped =
        symbol && acSymbolFor(symbol, orient, { symbolId: "" }, []);
      if (!mapped) {
        marks.set("$FIGURE", (marks.get("$FIGURE") ?? 0) + 1);
        continue;
      }
      document.drafting ??= { objects: [] };
      const position = acPosition(place, mapped.orient, mapped.row.offset);
      document.drafting.objects.push({
        id: deriveStableId("drafting", document.id, level.id, object.id),
        locked: false,
        zIndex: document.drafting.objects.length,
        anchor: { kind: "free", position },
        kind: "floating-symbol",
        symbolId: mapped.row.ac!,
        transform: acOrientation(mapped.orient),
      });
      continue;
    }
    if (
      object.definition === "$ARROW" ||
      object.definition === "$CURRENT_ARROW"
    )
      readArrow(
        object.definition,
        point,
        unit,
        object.definition === "$CURRENT_ARROW"
          ? model.texts.find((text) => text.attach === object.id)
          : undefined,
        object.id,
      );
  }
  // An arrow head at any other angle, an annotation of the arrow symbol
  // (13.5): a current marker where its label stands by it, named for it
  // (`%current1`, `%current1_label`), else a wire's direction arrow.
  for (const annotation of model.annotations ?? []) {
    if (
      annotation.source !== "$ARROW_SYMBOL" ||
      annotation.anchor_kind !== "independent" ||
      annotation.mirror
    )
      continue;
    const radians = (annotation.rotate * Math.PI) / 180;
    const unit = { x: Math.cos(radians), y: -Math.sin(radians) };
    const label = /^%current\d+$/u.test(annotation.id)
      ? model.texts.find((text) => text.id === `${annotation.id}_label`)
      : undefined;
    readArrow(
      label ? "$CURRENT_ARROW" : "$ARROW",
      acPoint(annotation.anchor),
      unit,
      label,
      annotation.id,
    );
  }
  for (const [definition, count] of marks)
    warn(
      "RNL_IMPORT_MARK_SKIPPED",
      `${count} ${definition} marks are not read back yet`,
    );

  // Voltage markers: a label on a wire with + and − beside it, where
  // Analog Canvas puts them, is the marker it wrote.
  const polarity = resolveDocumentStyleProfile(
    document.presentation,
  ).annotations;
  const plainText = (text: RnlTextView) => {
    const run = text.lines.length === 1 ? text.lines[0]![0] : undefined;
    return text.lines[0]!.length === 1 && run?.kind === "text"
      ? run.text
      : null;
  };
  const signs = model.texts.filter(
    (text) =>
      text.attach === null &&
      text.written &&
      ["+", "−", "-"].includes(plainText(text) ?? ""),
  );
  for (const text of model.texts) {
    if (text.attach !== null || !text.written || signs.includes(text)) continue;
    const point = acPoint(text.anchor);
    const leg = legAt(point);
    const content = acRichText(text.lines);
    if (!leg || !content) continue;
    const angle =
      (Math.atan2(leg.to.y - leg.from.y, leg.to.x - leg.from.x) * 180) /
      Math.PI;
    for (const way of [
      { rotation: angle, direction: "forward", orientation: "follow" },
      { rotation: angle + 180, direction: "reverse", orientation: "follow" },
      { rotation: 0, direction: "forward", orientation: "horizontal" },
    ] as const) {
      const besideAt = (side: number) => {
        const offset = turnedBy(
          { x: -polarity.polarityOffsetX, y: side * polarity.polarityHalfGap },
          way.rotation,
        );
        return { x: point.x + offset.x, y: point.y + offset.y + 4 };
      };
      const signAt = (place: { x: number; y: number }, plus: boolean) =>
        signs.find((sign) => {
          const at = acPoint(sign.anchor);
          return (
            !consumed.has(sign.id) &&
            (plainText(sign) === "+") === plus &&
            Math.abs(at.x - place.x) < 0.6 &&
            Math.abs(at.y - place.y) < 0.6
          );
        });
      const plus = signAt(besideAt(-1), true);
      const minus = signAt(besideAt(1), false);
      if (!plus || !minus) continue;
      document.annotations.push({
        id: deriveStableId("annotation", document.id, level.id, text.id),
        kind: "route-marker",
        content,
        anchor: {
          kind: "route",
          routeId: leg.route.id,
          legId: leg.route.legs[leg.index]!.id,
          t: Math.round(leg.t * 1e9) / 1e9,
          normalOffset: 0,
          direction: way.direction,
          orientation: way.orientation,
          fallbackPosition: { x: Math.round(point.x), y: Math.round(point.y) },
        },
        alignment: (["start", "middle", "end"].includes(text.halign)
          ? text.halign
          : "middle") as "start" | "middle" | "end",
        rotation: 0,
        locked: false,
        markerKind: "voltage",
        ...markerLook(text),
      });
      consumed.add(text.id);
      consumed.add(plus.id);
      consumed.add(minus.id);
      break;
    }
  }
  return consumed;
}

/** Marks read once the wires are routes, and figures. */
export const LATER = new Set(["$ARROW", "$CURRENT_ARROW", "$FIGURE"]);

/** Which way a mark turned by a quarter turn points, in Analog Canvas axes. */
const UNIT = {
  R0: { x: 1, y: 0 },
  R90: { x: 0, y: -1 },
  R180: { x: -1, y: 0 },
  R270: { x: 0, y: 1 },
} as const;

/** An offset turned clockwise by `rotation` degrees, y down, as Analog Canvas turns. */
function turnedBy(
  offset: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: offset.x * Math.cos(radians) - offset.y * Math.sin(radians),
    y: offset.x * Math.sin(radians) + offset.y * Math.cos(radians),
  };
}
