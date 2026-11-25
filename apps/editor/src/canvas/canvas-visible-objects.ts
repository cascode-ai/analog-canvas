import {
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import {
  buildBoundsSpatialIndex,
  cachedDocumentConnectivityIndex,
  objectStyleProfile,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDraftingObjectGeometry,
  type SchematicStyleProfile,
  type SpatialEntry,
} from "@icm/derived";
import type {
  GridRect,
  Rect,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import { SCHEMATIC_TEXT_FACE_FAMILIES } from "@icm/exporters/browser-fonts";
import { resolveInstanceSymbol, type SymbolResolver } from "@icm/symbols";
import type { WireSource } from "@icm/edit-engine";
import type { RouteGeometryRecord } from "../features/wiring/route-interaction-geometry";
import { registerCanvasObjectRetention } from "./canvas-object-retention";
import { rectContainsRect } from "./canvas-geometry";
import { instanceVisibleHitBox } from "./instance-geometry";
import type { CameraRuntime } from "./camera-runtime";
import { worldViewport } from "./fit-view";

export function usesCanvasViewport(document: SchematicDocument): boolean {
  return (
    document.instances.length +
      document.annotations.length +
      document.routes.length +
      document.junctions.length +
      (document.drafting?.objects.length ?? 0) >=
    512
  );
}

function pad(rect: Rect, length: number): Rect {
  return {
    x: rect.x - length,
    y: rect.y - length,
    width: rect.width + 2 * length,
    height: rect.height + 2 * length,
  };
}

/** Only a single short word in a pinned face has stable browser ink here. */
function simpleLabelFace(
  text: RichTextDocument,
  profile: SchematicStyleProfile,
): string | null {
  let runs = text.runs;
  let style = "normal";
  let weight = profile.typography.plainWeight;
  while (runs.length === 1) {
    const run = runs[0]!;
    if (run.kind === "text" && /^[a-zA-Z0-9]{1,32}$/u.test(run.value)) {
      return `${style} ${weight}`;
    }
    if (run.kind !== "span") break;
    if (run.style === "italic") style = "italic";
    else if (run.style === "bold") weight = profile.typography.mathWeight;
    else break;
    runs = run.children;
  }
  return null;
}

interface DrawingInputs {
  document: SchematicDocument;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  styleProfile: SchematicStyleProfile;
}

// A spatial query returns drawing order within its buckets. Marquee selection
// preserves the original model order, including conservative always-candidates.
function orderedObjects<T>(objects: readonly T[], id: (object: T) => string) {
  const byId = new Map(
    objects.map((object, order) => [id(object), { object, order }]),
  );
  return (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return [];
    const found = [];
    for (const key of ids) {
      const value = byId.get(key);
      if (value) found.push(value);
    }
    return found.sort((a, b) => a.order - b.order).map((item) => item.object);
  };
}

export function createCanvasDrawingQueries(
  { document, resolver, routeGeometryRecords, styleProfile }: DrawingInputs,
  endpoints: readonly WireSource[],
) {
  const entries: SpatialEntry<string>[] = [];
  const always = new Set<string>();
  const labelsByFace = new Map<string, string[]>();
  const add = (id: string, bounds: Rect) => entries.push({ value: id, bounds });
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const symbol = resolveInstanceSymbol(resolver, instance);
    if (!symbol) {
      always.add(instance.id);
      continue;
    }
    const art = [
      ...symbol.definition.primitives,
      ...(symbol.variant?.additionalPrimitives ?? []),
    ];
    // Legacy backgrounds paint the whole definition viewBox. Text, formulas
    // and unbounded paths can also reach beyond the ordinary picking box.
    if (
      instance.styleOverride?.background ||
      symbol.definition.formulaPresentation ||
      symbol.definition.pins.some((pin) => pin.presentation.showName) ||
      art.some(
        (p) =>
          (p.kind === "path" && !p.bounds) || p.part?.startsWith("upright-"),
      )
    ) {
      always.add(instance.id);
      continue;
    }
    const box = instanceVisibleHitBox(instance, symbol);
    if (box) {
      const profile = objectStyleProfile(styleProfile, instance);
      let stroke = Math.max(...Object.values(profile.strokes)),
        miter = Math.max(1, profile.miterLimit);
      for (const primitive of art) {
        stroke = Math.max(stroke, primitive.style?.strokeWidth ?? 0);
        miter = Math.max(miter, primitive.style?.miterLimit ?? 0);
      }
      add(instance.id, pad(box, stroke * miter));
    }
  }
  const committed = cachedDocumentConnectivityIndex(
    document,
    resolver,
    "committed",
  );
  const geometry =
    committed?.directRoutingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  const logicalNets =
    committed?.logicalNetResolution ?? resolveDocumentLogicalNets(document);
  for (const annotation of document.annotations) {
    if (annotation.visible === false) continue;
    const text = resolveAnnotationText(
      document,
      annotation,
      logicalNets,
      resolver,
    );
    const face = simpleLabelFace(text, styleProfile);
    // Formula artifacts arrive asynchronously. Rich layouts and the OS fonts
    // for missing glyphs can paint beyond deterministic model hit bounds.
    if (annotation.kind === "route-marker" || !face) {
      always.add(annotation.id);
      continue;
    }
    const labels = labelsByFace.get(face);
    if (labels) labels.push(annotation.id);
    else labelsByFace.set(face, [annotation.id]);
    const { bounds, inkBounds } = resolveAnnotationPresentation(
      document,
      resolver,
      annotation,
      styleProfile,
      geometry,
      logicalNets,
      text,
    );
    add(annotation.id, bounds);
    // Global badges and text decorations extend past the reserved type box.
    const profile = objectStyleProfile(styleProfile, annotation);
    add(
      annotation.id,
      pad(
        inkBounds,
        Math.max(
          12,
          profile.typography.annotationFontSize * (annotation.sizeScale ?? 1),
        ),
      ),
    );
  }
  for (const { route, geometry: routeGeometry } of routeGeometryRecords) {
    for (const { from, to } of routeGeometry.segments) {
      // Enclose fractional pins on both inclusive edges. Reconstructing an
      // exact maximum as min + abs(delta) can round just inside the endpoint.
      const x = Math.floor(Math.min(from.x, to.x));
      const y = Math.floor(Math.min(from.y, to.y));
      add(route.id, {
        x,
        y,
        width: Math.ceil(Math.max(from.x, to.x)) - x,
        height: Math.ceil(Math.max(from.y, to.y)) - y,
      });
    }
  }
  for (const { endpoint, connection } of endpoints) {
    const point = connection.contactPoint;
    add(
      endpoint.kind === "junction" ? endpoint.junctionId : endpoint.instanceId,
      { ...point, width: 0, height: 0 },
    );
  }
  for (const object of document.drafting?.objects ?? []) {
    // Some drafting marks include independently scaled callouts, symbols or heads.
    // Only plain geometric shapes have all their paint in the resolved body box.
    if (
      object.kind !== "rectangle" &&
      object.kind !== "circle" &&
      object.kind !== "arc"
    ) {
      always.add(object.id);
      continue;
    }
    const resolved = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
      geometry,
    );
    const profile = objectStyleProfile(styleProfile, object);
    add(
      object.id,
      pad(
        resolved.bounds,
        Math.max(...Object.values(profile.strokes)) *
          Math.max(1, profile.miterLimit) *
          (object.styleOverride?.strokeScale ?? 1),
      ),
    );
  }
  const index = buildBoundsSpatialIndex(
    entries,
    Math.max(80, document.presentation.grid * 8),
  );
  const family =
    SCHEMATIC_TEXT_FACE_FAMILIES[styleProfile.typography.face ?? "metropolis"];
  const visibleIds = (bounds: Rect) => {
    const visible = new Set([...always, ...index.queryBounds(bounds)]);
    if (labelsByFace.size) {
      // Web fonts use swap. Until the actual face loads, the OS can choose
      // different advances even for ASCII. A later camera query can cull it.
      const loaded = new Set<string>();
      globalThis.document?.fonts?.forEach((font) => {
        if (
          font.status === "loaded" &&
          font.family.replace(/["']/gu, "") === family
        )
          loaded.add(`${font.style} ${font.weight}`);
      });
      for (const [face, labels] of labelsByFace)
        if (!loaded.has(face)) for (const id of labels) visible.add(id);
    }
    return visible;
  };
  // Rendering uses the currently active terminal tool. A marquee uses every
  // model Junction, even when the tool supplied no pickable endpoints.
  function prepareSelection() {
    const junctionIndex = buildBoundsSpatialIndex(
      document.junctions.map((junction) => ({
        value: junction,
        bounds: { ...junction.position, width: 0, height: 0 },
      })),
      Math.max(80, document.presentation.grid * 8),
    );
    const instances = orderedObjects(document.instances, (item) => item.id);
    const routes = orderedObjects(
      routeGeometryRecords,
      (item) => item.route.id,
    );
    const annotations = orderedObjects(document.annotations, (item) => item.id);
    const drafting = orderedObjects(
      document.drafting?.objects ?? [],
      (item) => item.id,
    );
    const unbounded = new Set(always);
    // Net-label picking combines the reserved advance with the ink ascent.
    // That mixed rectangle can extend beyond either painted box at its corners.
    for (const annotation of document.annotations) {
      if (annotation.kind === "net-label") unbounded.add(annotation.id);
    }
    for (const record of routeGeometryRecords) {
      if (!record.geometry.segments.length) unbounded.add(record.route.id);
    }
    return (bounds: Rect) => {
      const ids = new Set([...unbounded, ...index.queryBounds(bounds)]);
      return {
        instances: instances(ids),
        routeGeometryRecords: routes(ids),
        annotations: annotations(ids),
        drafting: drafting(ids),
        junctions: junctionIndex.queryBounds(bounds),
      };
    };
  }
  let selection: ReturnType<typeof prepareSelection> | undefined;
  return {
    document,
    resolver,
    routeGeometryRecords,
    styleProfile,
    visibleIds,
    marquee: (bounds: Rect) => (selection ??= prepareSelection())(bounds),
  };
}

export type CanvasDrawingQueries = ReturnType<
  typeof createCanvasDrawingQueries
>;

export function useCanvasVisibleObjects(
  inputs: DrawingInputs,
  endpoints: readonly WireSource[],
  runtime: CameraRuntime,
  svg: RefObject<SVGSVGElement | null>,
  retained: ReadonlySet<string>,
  endpointHitRadius: number,
  queriesRef?: RefObject<CanvasDrawingQueries | null>,
) {
  const { document, resolver, routeGeometryRecords, styleProfile } = inputs;
  const index = useMemo(
    () =>
      usesCanvasViewport(document)
        ? createCanvasDrawingQueries(
            { document, resolver, routeGeometryRecords, styleProfile },
            endpoints,
          )
        : null,
    [document, resolver, routeGeometryRecords, styleProfile, endpoints],
  );
  useLayoutEffect(() => {
    if (!queriesRef) return;
    queriesRef.current = index;
    return () => {
      queriesRef.current = null;
    };
  }, [index, queriesRef]);
  const [coverage, setCoverage] = useState<Rect | null>(null);
  const previous = useRef<Rect | null>(null);
  useLayoutEffect(() => {
    if (!index || !svg.current) return;
    const update = (
      camera: GridRect,
      surface: DOMRect,
      animationFrame: boolean,
    ) => {
      const viewport = worldViewport(camera, surface);
      if (!viewport) return;
      const { scale } = viewport;
      const visible = pad(
        viewport.bounds,
        Math.max(24 / scale, endpointHitRadius),
      );
      const current = previous.current;
      if (
        current &&
        rectContainsRect(current, visible) &&
        visible.width * 2 >= current.width &&
        visible.height * 2 >= current.height
      )
        return;
      const next = pad(visible, 96 / scale);
      previous.current = next;
      // A large wheel jump must mount its new window in the same paint as the
      // live SVG camera. Ordinary moves within the overscan do no React work.
      if (animationFrame) flushSync(() => setCoverage(next));
      else setCoverage(next);
    };
    return runtime.observeViewport(update);
  }, [index, runtime, svg, endpointHitRadius]);
  const inWindow = useMemo(
    () => (index && coverage ? index.visibleIds(coverage) : null),
    [index, coverage],
  );
  const visible = useMemo(
    () =>
      inWindow && [...retained].some((id) => !inWindow.has(id))
        ? new Set([...inWindow, ...retained])
        : inWindow,
    [inWindow, retained],
  );
  const base = useRef(visible);
  base.current = visible;
  const holds = useRef(new Set<readonly string[]>());
  const [version, refresh] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => {
    const surface = svg.current;
    if (!surface || !index) return;
    const outside = (ids: readonly string[]) =>
      base.current !== null && ids.some((id) => !base.current!.has(id));
    const keep = (ids: readonly string[]) => {
      holds.current.add(ids);
      // The imperative preview reads its elements immediately after acquiring them.
      if (outside(ids)) flushSync(refresh);
      return () => {
        if (holds.current.delete(ids) && outside(ids)) refresh();
      };
    };
    const releaseRegistry = registerCanvasObjectRetention(surface, keep);
    const captures = new Map<number, () => void>();
    const capture = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const owner = event.target.closest(
        "[data-drag-object-id], [data-terminal-owner]",
      );
      const id =
        owner?.getAttribute("data-drag-object-id") ??
        owner?.getAttribute("data-terminal-owner");
      if (id) captures.set(event.pointerId, keep([id]));
    };
    const release = (event: PointerEvent) => {
      captures.get(event.pointerId)?.();
      captures.delete(event.pointerId);
    };
    surface.addEventListener("gotpointercapture", capture);
    surface.addEventListener("lostpointercapture", release);
    return () => {
      releaseRegistry();
      surface.removeEventListener("gotpointercapture", capture);
      surface.removeEventListener("lostpointercapture", release);
      for (const end of captures.values()) end();
    };
  }, [index, svg]);
  return useMemo(() => {
    if (!visible || !holds.current.size) return visible;
    const result = new Set(visible);
    for (const ids of holds.current) for (const id of ids) result.add(id);
    return result;
  }, [visible, version]);
}
