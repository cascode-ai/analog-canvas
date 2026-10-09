import { flattenRichText, transformPoint } from "@icm/model";
import type {
  Annotation,
  Point,
  Rect,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import { resolveInstanceSymbol, type SymbolResolver } from "@icm/symbols";
import {
  isSchematicAnnotationVisible,
  resolveAnnotationPresentation,
  type AnnotationPresentation,
} from "./annotation-presentation.js";
import { resolveAnnotationText } from "./annotation-text.js";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
} from "./contact.js";
import { instanceLabelInkBounds } from "./instance-label-placement.js";
import {
  drawnFreeTexts,
  resolveDraftingObjectGeometry,
  resolveDraftingTextInkBounds,
} from "./drafting-geometry.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { measureLabelText, richTextMetrics } from "./rich-text-layout.js";
import { intersectSegments } from "./segment-geometry.js";
import {
  buildBoundsSpatialIndex,
  buildDocumentSpatialIndex,
} from "./spatial-index.js";
import {
  objectStyleProfile,
  resolveDocumentStyleProfile,
} from "./style-profile.js";
import { partName, type VisualDiagnostic } from "./visual.js";

/** Least gap between two labels side by side, about a word space. */
const LABEL_WORD_SPACE = 4;
/** Least gap between two labels one above the other. */
const LABEL_LINE_SPACE = 1;
/** One figure: two parts' labels closer than its width on a row run on. */
const RUN_ON_FIGURE: RichTextDocument = {
  runs: [{ kind: "text", value: "0" }],
};

/**
 * Each placed part's drawn extent as a label sees it: the ink the default
 * placement keeps its gap from (instanceLabelInkBounds), padded by one unit.
 * visibleInstanceBounds falls back to the whole viewBox when a path declares
 * no bounds, which put an inductor's coil 4 units wider than its loops and
 * reported its own default labels as drawn over it (#1299). An adder's sign
 * marks are ink too (#1324).
 */
function labelObstacleBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Array<{ id: string; bounds: Rect }> {
  const padding = 1;
  return document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) return [];
    const ink = instanceLabelInkBounds(resolved, instance.signalFlowParameters);
    const corners = [
      { x: ink.x - padding, y: ink.y - padding },
      { x: ink.x + ink.width + padding, y: ink.y - padding },
      { x: ink.x - padding, y: ink.y + ink.height + padding },
      { x: ink.x + ink.width + padding, y: ink.y + ink.height + padding },
    ].map((point) =>
      transformPoint(point, instance.placement!.position, instance.placement!),
    );
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      {
        id: instance.id,
        bounds: {
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
        },
      },
    ];
  });
}

/** One bounded read model shared by optional arrangement and Agent observations. */
export function createLabelClearanceContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const style = resolveDocumentStyleProfile(document.presentation);
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  const logical = resolveDocumentLogicalNets(document);
  const grid = document.presentation.grid;
  const visible = document.annotations.filter((a) =>
    isSchematicAnnotationVisible(document, a, logical),
  );
  const measurements = new WeakMap<Annotation, AnnotationPresentation>();
  const measure = (annotation: Annotation) => {
    let measured = measurements.get(annotation);
    if (!measured) {
      measured = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        style,
        routing,
        logical,
      );
      measurements.set(annotation, measured);
    }
    return measured;
  };
  // Drawn extents, capitals to subscripts, as VISUAL_LABEL_OVERLAP measures:
  // a line box's extra ascent reached into a label's own part.
  const labels = new Map(visible.map((a) => [a.id, measure(a).inkBounds]));
  // Free drawing text is in the way too: a switch's name arranged onto a φ2
  // note read as one smudge with it (#1323). Its box is the text's line box.
  for (const object of document.drafting?.objects ?? [])
    if (object.kind === "text")
      labels.set(
        object.id,
        resolveDraftingObjectGeometry(document, resolver, object, routing)
          .bounds,
      );
  const symbols = labelObstacleBounds(document, resolver);
  const symbolIndex = buildBoundsSpatialIndex(
    symbols.map((s) => ({ bounds: s.bounds, value: s })),
    grid * 8,
  );
  const labelIndex = buildBoundsSpatialIndex(
    [...labels].map(([id, bounds]) => ({ bounds, value: id })),
    grid * 8,
  );
  const segments = buildDocumentSpatialIndex(document, routing).routeSegments;
  // A junction dot is wire ink off the wire's line. In a Schmitt trigger
  // drawn through the Agent, M2's name stood 0.2 units from the dot where
  // the input trunk met its gate, and M5's W/L ran 0.4 units into the dot
  // where its output met the feedback gates. A clear label keeps a line's
  // space from a dot. Dots stay out of conflictsAt: text touching a dot
  // reads better than text struck through by a wire, and a caller weighs
  // the two.
  const railIds = new Set(
    document.routes
      .filter((route) => route.presentation === "power-rail")
      .map((route) => route.id),
  );
  const dotReach = style.nodes.junctionRadius + LABEL_LINE_SPACE;
  const dots = deriveDocumentContactEvidence(
    document,
    resolver,
    routing,
  ).contacts.flatMap((contact) => {
    const routeIds = contact.incidents.flatMap((incident) =>
      incident.kind === "route" ? [incident.objectId] : [],
    );
    return contactRequiresJunctionDot(contact) &&
      !routeIds.some((id) => railIds.has(id))
      ? [
          {
            point: contact.point,
            ids: routeIds.length ? routeIds : [contact.id],
          },
        ]
      : [];
  });
  /** The wires whose junction dots come within a line's space of `box`. */
  const dotsAt = (box: Rect) => [
    ...new Set(
      dots.flatMap((dot) =>
        Math.hypot(
          Math.max(0, box.x - dot.point.x, dot.point.x - box.x - box.width),
          Math.max(0, box.y - dot.point.y, dot.point.y - box.y - box.height),
        ) < dotReach
          ? dot.ids
          : [],
      ),
    ),
  ];
  // A handful of accepted moves in this pass. Avoid rebuilding all geometry
  // for each candidate, and ignore stale index entries for already moved text.
  const moved = new Map<string, Rect>();
  /** Wires drawn across `box`. */
  const wiresAt = (box: Rect) => {
    const ids = new Set<string>();
    for (const segment of segments.queryBounds(box))
      if (segmentCrossesBox(segment.from, segment.to, box))
        ids.add(segment.routeId);
    return [...ids].sort();
  };
  /** Other labels whose ink meets `box`, grown by `x` and `y` each way. */
  const labelsAt = (box: Rect, annotationId: string, x = 0, y = 0) => {
    const grown = {
      x: box.x - x,
      y: box.y - y,
      width: box.width + 2 * x,
      height: box.height + 2 * y,
    };
    const ids = new Set<string>();
    for (const id of labelIndex.queryBounds(grown))
      if (
        id !== annotationId &&
        !moved.has(id) &&
        overlap(grown, labels.get(id)!)
      )
        ids.add(id);
    for (const [id, bounds] of moved)
      if (id !== annotationId && overlap(grown, bounds)) ids.add(id);
    return [...ids];
  };
  /** What a label's ink would meet in `box`, without measuring it there. */
  const conflictsAt = (box: Rect, annotationId: string) => {
    const ids = new Set<string>();
    for (const symbol of symbolIndex.queryBounds(box))
      if (overlap(box, symbol.bounds)) ids.add(symbol.id);
    // Two labels need a word's space between them on a line, and a little
    // between lines: an input Port's name "v_inn" two units before a
    // resistor's "2k" read as "v_inn2k".
    for (const id of labelsAt(
      box,
      annotationId,
      LABEL_WORD_SPACE,
      LABEL_LINE_SPACE,
    ))
      ids.add(id);
    for (const id of wiresAt(box)) ids.add(id);
    return [...ids].sort();
  };
  /** Wires a straight line crosses between its two ends. */
  const crossings = (from: Point, to: Point) => {
    const ids = new Set<string>();
    const span = {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
    for (const segment of segments.queryBounds(span)) {
      const hit = intersectSegments(from, to, segment.from, segment.to);
      if (
        hit?.kind === "crossing" &&
        Math.hypot(hit.point.x - from.x, hit.point.y - from.y) > 1e-6 &&
        Math.hypot(hit.point.x - to.x, hit.point.y - to.y) > 1e-6
      )
        ids.add(segment.routeId);
    }
    return [...ids].sort();
  };
  /**
   * Whether `box` sits inside a closed loop of wire: looking out from its
   * centre, every way meets a wire, or at most one way a part's body, within
   * a few grid squares past its edge. A sideways varactor's name had stood
   * inside its source–drain tie, clear of every wire and still boxed in by
   * them (#1519).
   */
  const enclosedAt = (box: Rect) => {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const reach = grid * 3;
    let bodies = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const length = (dx ? box.width : box.height) / 2 + reach;
      const end = { x: centre.x + dx * length, y: centre.y + dy * length };
      const span = {
        x: Math.min(centre.x, end.x),
        y: Math.min(centre.y, end.y),
        width: Math.abs(end.x - centre.x),
        height: Math.abs(end.y - centre.y),
      };
      if (
        segments
          .queryBounds(span)
          .some((segment) =>
            intersectSegments(centre, end, segment.from, segment.to),
          )
      )
        continue;
      if (
        symbolIndex
          .queryBounds(span)
          .some((symbol) => segmentCrossesBox(centre, end, symbol.bounds)) &&
        (bodies += 1) === 1
      )
        continue;
      return false;
    }
    return true;
  };
  return {
    visible,
    /** The Document's wire geometry this context measured against. */
    routing,
    symbols,
    measure,
    conflicts: (annotation: Annotation) =>
      conflictsAt(measure(annotation).inkBounds, annotation.id),
    conflictsAt,
    /** Other labels drawn over `box` itself, not only too close to it. */
    overlapsAt: (box: Rect, annotationId: string) =>
      labelsAt(box, annotationId).sort(),
    /** Other labels whose ink comes within `reach` of `box`. */
    labelsWithin: (box: Rect, annotationId: string, reach: number) =>
      labelsAt(box, annotationId, reach, reach)
        .filter(
          (id) => rectangleGap(box, moved.get(id) ?? labels.get(id)!) <= reach,
        )
        .sort(),
    /** Where a label or free text is drawn, as moved in this pass. */
    labelBounds: (id: string): Rect | undefined =>
      moved.get(id) ?? labels.get(id),
    wiresAt,
    dotsAt,
    enclosedAt,
    crossings,
    accept: (a: Annotation) => moved.set(a.id, measure(a).inkBounds),
  };
}

/** Observations only; never part of GUI gestures or transaction acceptance.
 * A label drawn over a wire or a part warns as label over label does
 * (#1105); a label far from its owner is information. */
export function diagnoseLabelClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
): VisualDiagnostic[] {
  const notes = drawnFreeTexts(document);
  if (!document.annotations.some((a) => a.visible !== false) && !notes.length)
    return [];
  const context = createLabelClearanceContext(document, resolver);
  const owners = new Map(context.symbols.map((s) => [s.id, s.bounds]));
  const obstacles = new Set([
    ...owners.keys(),
    ...document.routes.map((r) => r.id),
  ]);
  // Free drawing text struck through by a wire, as a label is (#1323). Text
  // over a part's bounds is left alone: notes inside a block's outline and
  // marks beside a terminal are drawn there on purpose.
  const struck = notes.flatMap((object): VisualDiagnostic[] => {
    const ink = resolveDraftingTextInkBounds(
      document,
      resolver,
      object,
      context.routing,
    );
    const wires = context.wiresAt(ink);
    return wires.length
      ? [
          {
            code: "VISUAL_LABEL_CLEARANCE",
            severity: "warning",
            category: "observation",
            confidence: "low",
            gateEligible: false,
            message:
              "Free text is drawn over a wire; move the text or the wire",
            objectIds: [object.id, ...wires],
            bounds: ink,
            parameters: { conflictingObjectCount: wires.length },
          },
        ]
      : [];
  });
  return [...labelFindings(), ...runOnLabels(document, context), ...struck];

  function labelFindings() {
    return context.visible.flatMap((annotation) => {
      const bounds = context.measure(annotation).inkBounds;
      // Label/label overlap already has a clustered visual diagnostic. Text
      // on a junction dot is on its wires.
      const conflicts = [
        ...new Set([
          ...context.conflicts(annotation),
          ...context.dotsAt(bounds),
        ]),
      ]
        .filter((id) => obstacles.has(id))
        .sort();
      const ownerId =
        annotation.anchor.kind === "object"
          ? annotation.anchor.objectId
          : undefined;
      const owner = ownerId ? owners.get(ownerId) : undefined;
      const gap = owner ? rectangleGap(bounds, owner) : 0;
      const maxGap = document.presentation.grid * 8;
      const diagnostics: VisualDiagnostic[] = [];
      if (conflicts.length)
        diagnostics.push({
          code: "VISUAL_LABEL_CLEARANCE",
          severity: "warning",
          category: "observation",
          confidence: "low",
          gateEligible: false,
          message:
            "Label text is drawn over a wire or a part's drawing; move the label or the wire",
          objectIds: [annotation.id, ...conflicts],
          bounds,
          parameters: { conflictingObjectCount: conflicts.length },
        });
      if (owner && gap > maxGap)
        diagnostics.push({
          code: "VISUAL_LABEL_OWNER_DISTANCE",
          severity: "info",
          category: "observation",
          confidence: "low",
          gateEligible: false,
          message:
            "Attached label is far from its owner; this may be intentional",
          objectIds: [annotation.id, ownerId!],
          bounds,
          parameters: { gap, reviewThreshold: maxGap },
        });
      return diagnostics;
    });
  }
}

/** A part's name or value, as a run-on reads it. */
interface RowLabel {
  readonly annotation: Annotation;
  readonly owner: string;
  readonly ink: Rect;
  /** A figure's width at the label's size: less between labels runs on. */
  readonly figure: number;
}

/**
 * Two parts' names or values on one row, less than a figure apart, read as
 * one string, and a reader pairs a name with the wrong value: C3's 637pF
 * beside C5's 197pF read "637pF 197pF", and an LC ladder's values ran along
 * its bottom row as one (#1412). A part's own labels are left alone, and
 * labels drawn over each other are VISUAL_LABEL_OVERLAP's.
 */
function runOnLabels(
  document: SchematicDocument,
  context: ReturnType<typeof createLabelClearanceContext>,
): VisualDiagnostic[] {
  const style = resolveDocumentStyleProfile(document.presentation);
  const parts = new Set(document.instances.map((instance) => instance.id));
  const labels = new Map<string, RowLabel>();
  for (const annotation of context.visible) {
    const owner =
      annotation.anchor.kind === "object"
        ? annotation.anchor.objectId
        : undefined;
    if (
      (annotation.kind !== "instance-label" &&
        annotation.kind !== "instance-value") ||
      annotation.rotation !== 0 ||
      !owner ||
      !parts.has(owner)
    )
      continue;
    const fontSize =
      objectStyleProfile(style, annotation).typography.instanceFontSize *
      (annotation.sizeScale ?? 1);
    labels.set(annotation.id, {
      annotation,
      owner,
      ink: context.measure(annotation).inkBounds,
      figure: measureLabelText(RUN_ON_FIGURE, {
        ...richTextMetrics(style, "label"),
        fontSize,
      }).width,
    });
  }
  const reach = Math.max(
    0,
    ...[...labels.values()].map((label) => label.figure),
  );
  const named = ({ annotation, owner }: RowLabel) =>
    `${partName(document, owner)}'s ${
      annotation.kind === "instance-value" ? "value" : "name"
    } "${flattenRichText(resolveAnnotationText(document, annotation))}"`;
  const findings: VisualDiagnostic[] = [];
  for (const left of labels.values())
    for (const id of context.labelsWithin(
      left.ink,
      left.annotation.id,
      reach,
    )) {
      const right = labels.get(id);
      if (!right || right.owner === left.owner) continue;
      // Each pair once, read from left to right.
      const gap = right.ink.x - (left.ink.x + left.ink.width);
      const threshold = Math.max(left.figure, right.figure);
      const top = Math.max(left.ink.y, right.ink.y);
      const bottom = Math.min(
        left.ink.y + left.ink.height,
        right.ink.y + right.ink.height,
      );
      // One row: the two overlap by half a line or more.
      const oneRow =
        bottom - top >= Math.min(left.ink.height, right.ink.height) / 2;
      if (gap < 0 || gap >= threshold || !oneRow) continue;
      const units = Math.round(gap);
      const y = Math.min(left.ink.y, right.ink.y);
      findings.push({
        code: "VISUAL_LABEL_RUN_ON",
        severity: "info",
        category: "observation",
        confidence: "low",
        gateEligible: false,
        message: `${named(left)} and ${named(right)} share a line ${units} unit${units === 1 ? "" : "s"} apart and read as one`,
        objectIds: [left.annotation.id, right.annotation.id],
        bounds: {
          x: left.ink.x,
          y,
          width: right.ink.x + right.ink.width - left.ink.x,
          height:
            Math.max(
              left.ink.y + left.ink.height,
              right.ink.y + right.ink.height,
            ) - y,
        },
        parameters: { gap, reviewThreshold: threshold },
      });
    }
  return findings;
}

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
function rectangleGap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}
/** Clip any straight segment, including diagonal wires, to the open box. */
function segmentCrossesBox(from: Point, to: Point, box: Rect): boolean {
  let lo = 0,
    hi = 1;
  for (const [start, end, min, max] of [
    [from.x, to.x, box.x, box.x + box.width],
    [from.y, to.y, box.y, box.y + box.height],
  ] as const) {
    const delta = end - start;
    if (delta === 0) {
      if (start <= min || start >= max) return false;
    } else {
      const a = (min - start) / delta,
        b = (max - start) / delta;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (lo >= hi) return false;
    }
  }
  return lo < hi;
}
