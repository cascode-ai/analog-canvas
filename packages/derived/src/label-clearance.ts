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
    isSchematicAnnotationVisible(document, a, logical, undefined, resolver),
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
  // What the label diagnostics count as drawn over a label: parts and wires.
  const owners = new Map(symbols.map((symbol) => [symbol.id, symbol.bounds]));
  const obstacles = new Set([
    ...owners.keys(),
    ...document.routes.map((route) => route.id),
  ]);
  /** VISUAL_LABEL_CLEARANCE's objects for text at `box`, a dot's wires too. */
  const struckAt = (box: Rect, annotationId: string) =>
    [...new Set([...conflictsAt(box, annotationId), ...dotsAt(box)])]
      .filter((id) => obstacles.has(id))
      .sort();
  /** VISUAL_LABEL_OWNER_DISTANCE's gap for an attached label at `box`. */
  const ownerGapAt = (annotation: Annotation, box: Rect) => {
    const owner =
      annotation.anchor.kind === "object"
        ? owners.get(annotation.anchor.objectId)
        : undefined;
    const gap = owner ? rectangleGap(box, owner) : 0;
    return owner && gap > grid * 8 ? gap : undefined;
  };
  const parts = new Set(document.instances.map((instance) => instance.id));
  const rows = new Map<string, RowLabel | undefined>();
  /** A part's upright name or value, as VISUAL_LABEL_RUN_ON reads it. */
  const rowLabel = (annotation: Annotation) => {
    if (rows.has(annotation.id)) return rows.get(annotation.id);
    const row = runOnRowLabel(annotation, parts, style);
    rows.set(annotation.id, row);
    return row;
  };
  const visibleById = new Map(visible.map((a) => [a.id, a]));
  let reach: number | undefined;
  /** The widest figure of any part's label: no run-on reaches further. */
  const runOnReach = () =>
    (reach ??= Math.max(
      0,
      ...visible.map((annotation) => rowLabel(annotation)?.figure ?? 0),
    ));
  /** Other parts' labels `annotation` at `box` reads on into, or they into it. */
  const runsOnAt = (
    annotation: Annotation,
    box: Rect,
    ignore: ReadonlySet<string> = new Set(),
  ) => {
    const row = rowLabel(annotation);
    if (!row) return [];
    const ids = labelsAt(
      box,
      annotation.id,
      Math.max(row.figure, runOnReach()),
      Math.max(row.figure, runOnReach()),
    ).filter((id) => {
      const theirs = visibleById.get(id);
      const other = theirs && !ignore.has(id) && rowLabel(theirs);
      const ink = other && (moved.get(id) ?? labels.get(id));
      return (
        other &&
        ink &&
        other.owner !== row.owner &&
        (runOnGap({ ...row, ink: box }, { ...other, ink }) !== undefined ||
          runOnGap({ ...other, ink }, { ...row, ink: box }) !== undefined)
      );
    });
    return ids.sort();
  };
  /**
   * What the label diagnostics would report of `annotation` drawn with its
   * ink at `box`: VISUAL_LABEL_CLEARANCE's parts and wires, the labels
   * VISUAL_LABEL_OVERLAP would cluster it with, VISUAL_LABEL_OWNER_DISTANCE's
   * gap and VISUAL_LABEL_RUN_ON's labels. Labels in `ignore` count as not
   * drawn: a planner moving a group tests each member without the stale
   * places of the others. A spot a planner chooses where a clear one exists
   * raises none of these (#1836).
   */
  const findingsAt = (
    annotation: Annotation,
    box: Rect = measure(annotation).inkBounds,
    ignore: ReadonlySet<string> = new Set(),
  ): LabelSpotFindings => {
    const ownerGap = ownerGapAt(annotation, box);
    return {
      struck: struckAt(box, annotation.id),
      overlapped: labelsAt(box, annotation.id)
        .filter((id) => !ignore.has(id))
        .sort(),
      ...(ownerGap === undefined ? {} : { ownerGap }),
      runsOn: runsOnAt(annotation, box, ignore),
    };
  };
  return {
    visible,
    /** The Document's wire geometry this context measured against. */
    routing,
    symbols,
    measure,
    struckAt,
    ownerGapAt,
    runsOnAt,
    findingsAt,
    /** Whether `annotation` at `box` raises none of the label findings. */
    clearAt: (
      annotation: Annotation,
      box?: Rect,
      ignore?: ReadonlySet<string>,
    ) => isClearSpot(findingsAt(annotation, box, ignore)),
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
  return [
    ...labelFindings(),
    ...runOnLabels(document, context, resolver),
    ...struck,
  ];

  function labelFindings() {
    return context.visible.flatMap((annotation) => {
      const bounds = context.measure(annotation).inkBounds;
      // Label/label overlap already has a clustered visual diagnostic. Text
      // on a junction dot is on its wires.
      const conflicts = context.struckAt(bounds, annotation.id);
      const gap = context.ownerGapAt(annotation, bounds);
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
      if (gap !== undefined && annotation.anchor.kind === "object")
        diagnostics.push({
          code: "VISUAL_LABEL_OWNER_DISTANCE",
          severity: "info",
          category: "observation",
          confidence: "low",
          gateEligible: false,
          message:
            "Attached label is far from its owner; this may be intentional",
          objectIds: [annotation.id, annotation.anchor.objectId],
          bounds,
          parameters: { gap, reviewThreshold: document.presentation.grid * 8 },
        });
      return diagnostics;
    });
  }
}

/** What the label diagnostics would report of one label at one spot. */
export interface LabelSpotFindings {
  /** Parts and wires drawn over it, a junction dot's wires among them. */
  readonly struck: readonly string[];
  /** Other labels and free text its ink meets. */
  readonly overlapped: readonly string[];
  /** Its gap from its part, where that is past the review threshold. */
  readonly ownerGap?: number;
  /** Other parts' names or values it runs on with along its row. */
  readonly runsOn: readonly string[];
}

/** Whether a spot raises none of the label findings. */
function isClearSpot(findings: LabelSpotFindings): boolean {
  return (
    !findings.struck.length &&
    !findings.overlapped.length &&
    findings.ownerGap === undefined &&
    !findings.runsOn.length
  );
}

/** A part's name or value, as a run-on reads it. */
interface RowLabel {
  readonly annotation: Annotation;
  readonly owner: string;
  /** A figure's width at the label's size: less between labels runs on. */
  readonly figure: number;
}

/** A part's upright name or value as a run-on reads it, or undefined. */
function runOnRowLabel(
  annotation: Annotation,
  parts: ReadonlySet<string>,
  style: ReturnType<typeof resolveDocumentStyleProfile>,
): RowLabel | undefined {
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
    return undefined;
  const fontSize =
    objectStyleProfile(style, annotation).typography.instanceFontSize *
    (annotation.sizeScale ?? 1);
  return {
    annotation,
    owner,
    figure: measureLabelText(RUN_ON_FIGURE, {
      ...richTextMetrics(style, "label"),
      fontSize,
    }).width,
  };
}

/**
 * The gap at which `right` follows `left` on one row closer than a figure,
 * so the two read as one string, or undefined. Labels drawn over each
 * other are VISUAL_LABEL_OVERLAP's.
 */
function runOnGap(
  left: { readonly ink: Rect; readonly figure: number },
  right: { readonly ink: Rect; readonly figure: number },
): number | undefined {
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
  return gap < 0 || gap >= threshold || !oneRow ? undefined : gap;
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
  resolver: SymbolResolver,
): VisualDiagnostic[] {
  const style = resolveDocumentStyleProfile(document.presentation);
  const parts = new Set(document.instances.map((instance) => instance.id));
  const labels = new Map<string, RowLabel & { readonly ink: Rect }>();
  for (const annotation of context.visible) {
    const row = runOnRowLabel(annotation, parts, style);
    if (row)
      labels.set(annotation.id, {
        ...row,
        ink: context.measure(annotation).inkBounds,
      });
  }
  const reach = Math.max(
    0,
    ...[...labels.values()].map((label) => label.figure),
  );
  const named = ({ annotation, owner }: RowLabel) =>
    `${partName(document, owner)}'s ${
      annotation.kind === "instance-value" ? "value" : "name"
    } "${flattenRichText(resolveAnnotationText(document, annotation, undefined, resolver))}"`;
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
      const gap = runOnGap(left, right);
      if (gap === undefined) continue;
      const threshold = Math.max(left.figure, right.figure);
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
