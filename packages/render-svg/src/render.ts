/** Scene assembly: a Document's formal SVG scene and the SVG file around it. */
import { renderFractionText } from "./fraction-text.js";
import { RectSchema, SchematicDocumentSchema } from "@icm/model";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  deriveMosBulkRouteFamily,
  resolveDocumentRoutingGeometry,
  resolveAnnotationPresentation,
  annotationOwningInstanceId,
  resolveAnnotationTextColor,
  isSchematicAnnotationVisible,
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  objectStyleProfile,
  sameDocumentStyle,
  resolveDocumentLogicalNets,
  schematicRoundPeriodFontFaceCss,
} from "@icm/derived";
import type {
  CoincidentContact,
  DocumentContactEvidence,
  DocumentStyleKeeper,
  ResolvedDocumentRoutingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  DerivedRect,
  GridRect,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveInstanceSymbol,
  signalFlowBodyUsesLabelTypography,
} from "@icm/symbols";
import type { SymbolResolver } from "@icm/symbols";

import {
  schematicTextFontSize,
  schematicTextSizeAttribute,
} from "./schematic-text.js";
import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";
import { renderFormulaDocument } from "./formula.js";
import { renderUprightSignalFlowFormula } from "./signal-flow-formula.js";
import {
  drawnRouteMarkerPlacement,
  renderAnnotationText,
  renderPositionedFractionAnnotation,
  rotateOffset,
} from "./annotation-render.js";
import type { ResolvedSvgAnnotation } from "./annotation-render.js";
import { renderDraftingLayer } from "./drafting-render.js";
import {
  junctionMiterBridgePaths,
  renderNoConnectMarkers,
  renderRouteDirectionArrow,
  terminalMiterBridgePaths,
} from "./route-render.js";
import { deriveBounds } from "./scene-bounds.js";
import { escapeXml, pointList } from "./svg-markup.js";
import {
  instanceTransform,
  renderAdaptiveSignalFlowFrame,
  renderSymbolDefinitionBody,
  renderVisiblePinNames,
} from "./symbol-render.js";

export interface SvgRenderOptions {
  /** Read-only paint filter. Geometry and electrical facts still use the full Document. */
  objectIds?: ReadonlySet<string>;
  /** Page background only; explicit object fills are preserved. */
  background?: "document" | "transparent";
  /** Explicit render crop is a caller-owned grid rectangle. */
  bounds?: GridRect;
  margin?: number;
  title?: string;
  /** Revision-scoped routing read model supplied by a shared caller. */
  routingGeometry?: ResolvedDocumentRoutingGeometry;
  /** Contact evidence paired with `routingGeometry`; never persisted. */
  contactEvidence?: DocumentContactEvidence;
}

export interface SvgScene {
  /** Formal visual bounds may include fractional text/curve geometry. */
  viewBox: DerivedRect;
  formalBody: string;
}

function profileMiterAttribute(profile: SchematicStyleProfile): string {
  return ` stroke-miterlimit="${profile.miterLimit}"`;
}

export function buildSvgScene(
  input: SchematicDocument,
  resolver: SymbolResolver,
  options: SvgRenderOptions = {},
): SvgScene {
  const document = SchematicDocumentSchema.parse(input);
  const objectIds = options.objectIds;
  const included = (id: string): boolean => !objectIds || objectIds.has(id);
  const profile = resolveDocumentStyleProfile(document.presentation);
  const margin = options.margin ?? 40;
  if (!Number.isInteger(margin) || margin < 0) {
    throw new Error("SVG margin must be a non-negative integer");
  }
  const routingGeometry =
    options.routingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  if (
    routingGeometry.documentId !== document.id ||
    routingGeometry.documentRevision !== document.revision
  ) {
    throw new Error("SVG renderer received stale routing geometry");
  }
  const instancesById = new Map(
    document.instances.map((instance) => [instance.id, instance] as const),
  );
  const routesById = new Map(
    document.routes.map((route) => [route.id, route] as const),
  );
  const junctionsById = new Map(
    document.junctions.map((junction) => [junction.id, junction] as const),
  );
  const routesAtJunction = new Map<string, RouteBranch[]>();
  for (const route of document.routes) {
    const end = route.legs.at(-1)?.to;
    for (const endpoint of [
      route.start,
      ...(end?.kind === "endpoint" ? [end.endpoint] : []),
    ]) {
      if (endpoint.kind !== "junction") continue;
      const routes = routesAtJunction.get(endpoint.junctionId) ?? [];
      routes.push(route);
      routesAtJunction.set(endpoint.junctionId, routes);
    }
  }
  // Joined objects that all keep one style draw their joint in it.
  const sharedProfile = (
    objects: readonly (DocumentStyleKeeper | undefined)[],
  ) => {
    const [first, ...rest] = objects;
    return first &&
      rest.every((object) =>
        sameDocumentStyle(object?.documentStyle, first.documentStyle),
      )
      ? objectStyleProfile(profile, first)
      : profile;
  };
  // A Junction draws in its own kept style, else like the Routes it joins, so
  // one the engine re-creates under a copied circuit still matches it.
  const junctionProfile = (junctionId: string) => {
    const junction = junctionsById.get(junctionId);
    return junction?.documentStyle
      ? objectStyleProfile(profile, junction)
      : sharedProfile(routesAtJunction.get(junctionId) ?? []);
  };
  const contactProfile = (contact: CoincidentContact) => {
    const junction = contact.endpoints.find(
      (endpoint) => endpoint.kind === "junction",
    );
    if (junction) return junctionProfile(junction.junctionId);
    return sharedProfile(
      contact.incidents.map((incident) =>
        incident.kind === "route"
          ? routesById.get(incident.objectId)
          : instancesById.get(incident.objectId),
      ),
    );
  };
  const logicalNets = resolveDocumentLogicalNets(document);
  const powerRailNetIds = new Set(
    document.routes.flatMap((route) => {
      if (route.presentation !== "power-rail") return [];
      return logicalNets.byBaseNetId.get(route.netId)?.powerDomain === "vdd"
        ? [route.netId]
        : [];
    }),
  );
  const powerRailRouteIds = new Set(
    document.routes
      .filter(
        (route) =>
          route.presentation === "power-rail" &&
          powerRailNetIds.has(route.netId),
      )
      .map((route) => route.id),
  );
  const resolvedAnnotations: ResolvedSvgAnnotation[] = [];
  for (const annotation of document.annotations) {
    if (!included(annotation.id) || annotation.visible === false) continue;
    const content = resolveAnnotationText(document, annotation, logicalNets);
    if (
      !isSchematicAnnotationVisible(document, annotation, logicalNets, content)
    )
      continue;
    resolvedAnnotations.push({
      annotation,
      content,
      presentation: resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        profile,
        routingGeometry,
        logicalNets,
        content,
      ),
    });
  }
  const viewBox = options.bounds
    ? RectSchema.parse(options.bounds)
    : deriveBounds(
        document,
        resolver,
        routingGeometry,
        margin,
        resolvedAnnotations,
        profile,
        objectIds,
      );

  const joinedJunctionIds = new Set(
    routingGeometry.endpointJoins.flatMap((join) =>
      join.kind === "junction-miter" ? [join.junctionId] : [],
    ),
  );
  const bulkRouteIds = new Set<string>();
  const bulkRouteColors = new Map<string, string>();
  for (const route of document.routes) {
    if (bulkRouteIds.has(route.id)) continue;
    const family = deriveMosBulkRouteFamily(document, route);
    if (!family) continue;
    const ownerColors = new Set(
      family.instanceIds.map(
        (instanceId) =>
          document.instances.find((instance) => instance.id === instanceId)
            ?.styleOverride?.foreground ?? profile.foreground,
      ),
    );
    const color =
      ownerColors.size === 1 ? [...ownerColors][0]! : profile.foreground;
    for (const routeId of family.routeIds) {
      bulkRouteIds.add(routeId);
      bulkRouteColors.set(routeId, color);
    }
  }
  const routeStrokeColor = (
    route: SchematicDocument["routes"][number],
  ): string =>
    bulkRouteColors.get(route.id) ??
    route.styleOverride?.color ??
    profile.foreground;
  const junctionColorSets = new Map<string, Set<string>>();
  for (const route of document.routes) {
    const color = routeStrokeColor(route);
    const end = route.legs.at(-1)?.to;
    const endpointJunctionIds = [
      ...(route.start.kind === "junction" ? [route.start.junctionId] : []),
      ...(end?.kind === "endpoint" && end.endpoint.kind === "junction"
        ? [end.endpoint.junctionId]
        : []),
    ];
    for (const junctionId of endpointJunctionIds) {
      if (!joinedJunctionIds.has(junctionId)) continue;
      const colors = junctionColorSets.get(junctionId) ?? new Set<string>();
      colors.add(color);
      junctionColorSets.set(junctionId, colors);
    }
  }
  const junctionBridgeColors = new Map<string, string>();
  for (const [junctionId, colors] of junctionColorSets) {
    if (colors.size === 1)
      junctionBridgeColors.set(junctionId, [...colors][0]!);
  }

  // One conductor run, one shape.
  //
  // A straight run is often several Routes — split at a pin it passes through,
  // or at a retained Junction — and a rasterizer composites every stroked
  // element on its own: two that meet leave a lighter row at the seam, and the
  // miter that covers that seam leaves a darker one, which is the short stray
  // line readers report. Stroking every conductor of one paint as a single
  // path with many subpaths makes the coverage one calculation again, so a run
  // reads as the single line it is. Identity stays with an unpainted polyline
  // per Route: the ink is shared, the objects are not.
  const inkOrder: string[] = [];
  const ink = new Map<
    string,
    { strokeColor: string; strokeWidth: number; dash: string; d: string[] }
  >();
  const addInk = (
    strokeColor: string,
    strokeWidth: number,
    dash: string,
    d: string,
  ) => {
    const key = `${strokeColor}|${strokeWidth}|${dash}`;
    const bucket = ink.get(key);
    if (bucket) {
      bucket.d.push(d);
      return;
    }
    inkOrder.push(key);
    ink.set(key, { strokeColor, strokeWidth, dash, d: [d] });
  };
  const routeIdentities = [...document.routes]
    .filter((route) => included(route.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      if (!geometry) {
        throw new Error(`Cannot render unresolved route: ${route.id}`);
      }
      const strokeColor = routeStrokeColor(route);
      const presentation = bulkRouteIds.has(route.id)
        ? "bulk-dashed"
        : route.presentation === "bulk-dashed"
          ? "wire"
          : (route.presentation ?? "wire");
      const isPowerRail =
        presentation === "power-rail" && powerRailNetIds.has(route.netId);
      const dash =
        presentation === "bulk-dashed"
          ? "3 3"
          : route.styleOverride?.lineStyle === "dashed"
            ? "6 4"
            : route.styleOverride?.lineStyle === "dotted"
              ? "2 3"
              : "";
      const presentationAttribute =
        presentation !== "wire"
          ? ` data-route-presentation="${presentation}"`
          : "";
      const routeProfile = objectStyleProfile(profile, route);
      const strokeWidth = isPowerRail
        ? routeProfile.strokes.powerRail
        : routeProfile.strokes.wire;
      addInk(
        strokeColor,
        strokeWidth,
        dash,
        `M ${geometry.centerline
          .map((point) => `${point.x} ${point.y}`)
          .join(" L ")}`,
      );
      // The bridge belongs to the same paint as the Route it joins, so it
      // merges into that shape instead of being laid over it.
      for (const d of terminalMiterBridgePaths(
        geometry.endpointJoins,
        routeProfile,
      ))
        addInk(strokeColor, routeProfile.strokes.wire, dash, d);
      const directionArrow = renderRouteDirectionArrow(
        geometry.centerline,
        route.styleOverride?.arrow,
        strokeColor,
        routeProfile,
      );
      return `<polyline data-object-id="${escapeXml(route.id)}" data-net-id="${escapeXml(route.netId)}"${presentationAttribute} points="${pointList(geometry.centerline)}" fill="none" stroke="none"/>${directionArrow}`;
    })
    .join("");
  for (const bridge of junctionMiterBridgePaths(
    routingGeometry.endpointJoins.filter((join) => {
      if (!objectIds || join.kind !== "junction-miter") return true;
      return document.routes
        .filter((route) => {
          const end = route.legs.at(-1)?.to;
          return (
            (route.start.kind === "junction" &&
              route.start.junctionId === join.junctionId) ||
            (end?.kind === "endpoint" &&
              end.endpoint.kind === "junction" &&
              end.endpoint.junctionId === join.junctionId)
          );
        })
        .every((route) => included(route.id));
    }),
    junctionProfile,
    junctionBridgeColors,
  ))
    addInk(bridge.strokeColor, bridge.strokeWidth, "", bridge.d);
  const conductorInk = inkOrder
    .map((key) => {
      const bucket = ink.get(key)!;
      return `<path data-role="conductor-ink" d="${bucket.d.join(" ")}" fill="none" stroke="${escapeXml(bucket.strokeColor)}" stroke-width="${bucket.strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${bucket.dash ? ` stroke-dasharray="${bucket.dash}"` : ""}${profileMiterAttribute(profile)}/>`;
    })
    .join("");
  const routes = `${conductorInk}${routeIdentities}`;
  const contactEvidence =
    options.contactEvidence ??
    deriveDocumentContactEvidence(document, resolver, routingGeometry);
  const junctions = contactEvidence.contacts
    .filter(
      (contact) =>
        !objectIds ||
        contact.incidents.some((incident) => included(incident.objectId)) ||
        contact.endpoints.some((endpoint) =>
          endpoint.kind === "junction"
            ? included(endpoint.junctionId)
            : included(endpoint.instanceId),
        ),
    )
    .filter((contact) => {
      if (
        contact.incidents.some(
          (incident) =>
            incident.kind === "route" &&
            powerRailRouteIds.has(incident.objectId),
        )
      ) {
        return false;
      }
      // All terminal kinds consume the shared visible-branch decision.
      return contactRequiresJunctionDot(contact);
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((contact) => {
      const junctionEndpoint = contact.endpoints.find(
        (endpoint): endpoint is Extract<RouteEndpoint, { kind: "junction" }> =>
          endpoint.kind === "junction",
      );
      const objectId = junctionEndpoint?.junctionId ?? contact.id;
      const derivedAttribute = junctionEndpoint
        ? ""
        : ' data-node-kind="contact"';
      const dotProfile = contactProfile(contact);
      const routeColors = new Set(
        contact.incidents.flatMap((incident) => {
          const route =
            incident.kind === "route"
              ? routesById.get(incident.objectId)
              : null;
          return route ? [routeStrokeColor(route)] : [];
        }),
      );
      // A single wire color belongs to the whole contact. Mixed colors have
      // no unambiguous owner, so the dot keeps the Document's foreground.
      const dotColor =
        routeColors.size === 1 ? [...routeColors][0]! : dotProfile.foreground;
      return `<circle data-object-id="${escapeXml(objectId)}"${derivedAttribute} cx="${contact.point.x}" cy="${contact.point.y}" r="${dotProfile.nodes.junctionRadius}" fill="${escapeXml(dotColor)}"/>`;
    })
    .join("");
  const noConnectMarkers = renderNoConnectMarkers(
    document,
    resolver,
    profile,
    objectIds,
  );
  const noConnectLayer = noConnectMarkers
    ? `<g data-layer="no-connects">${noConnectMarkers}</g>`
    : "";
  const symbols = [...document.instances]
    .filter((instance) => included(instance.id))
    .filter((instance) => instance.placement !== null)
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((instance) => {
      const resolved = resolveInstanceSymbol(resolver, instance);
      if (!resolved) {
        throw new Error(`Unresolved symbol: ${instance.symbolId}`);
      }
      const instanceProfile = objectStyleProfile(profile, instance);
      const styleOverride = instance.styleOverride;
      const foregroundOverride = styleOverride?.foreground;
      const primitives = renderSymbolDefinitionBody(
        resolved.definition,
        resolved.variant?.hiddenPrimitiveParts,
        resolved.variant?.additionalPrimitives,
        instanceProfile,
        foregroundOverride,
        instance.signalFlowParameters,
        instance.placement ?? undefined,
      );
      const pinNames = renderVisiblePinNames(
        resolved.definition,
        resolved.variant?.hiddenPinNames ?? [],
        instance,
        instanceProfile,
        foregroundOverride,
        document.presentation,
      );
      const formula = renderUprightSignalFlowFormula(
        resolved.definition.formulaPresentation,
        instance.signalFlowParameters,
        instance.placement!,
        {
          foreground: foregroundOverride ?? instanceProfile.foreground,
          profile: instanceProfile,
          ...(resolved.definition.formulaPresentation &&
          signalFlowBodyUsesLabelTypography(
            resolved.definition.formulaPresentation,
          )
            ? {
                labels: {
                  presentation: document.presentation,
                  profile: instanceProfile,
                },
              }
            : {}),
        },
      );
      const strokeColor = foregroundOverride ?? instanceProfile.foreground;
      // Background fill: drawn inside the instance transform using the
      // symbol's local viewBox so it moves with the instance and stays
      // aligned with the artwork in all orientations and mirrors. When no
      // override is set, no rect is emitted (identical markup to pre-override
      // rendering).
      const viewBox = resolved.definition.viewBox;
      const adaptiveLayout = resolveAdaptiveSignalFlowBlockLayout(
        resolved.definition,
        instance.signalFlowParameters,
      );
      const background = adaptiveLayout?.body ?? viewBox;
      const backgroundRect =
        styleOverride?.background === undefined
          ? ""
          : adaptiveLayout
            ? renderAdaptiveSignalFlowFrame(
                adaptiveLayout,
                `data-role="instance-background" fill="${styleOverride.background}" stroke="none"`,
              )
            : `<rect data-role="instance-background" x="${background.x}" y="${background.y}" width="${background.width}" height="${background.height}" fill="${styleOverride.background}"/>`;
      const symbolRole =
        styleOverride === undefined ? "" : ' data-role="instance-symbol"';
      return `<g data-object-id="${escapeXml(instance.id)}" data-symbol-id="${escapeXml(resolved.definition.id)}"><g transform="${instanceTransform(instance)}">${backgroundRect}<g${symbolRole} fill="none" stroke="${strokeColor}" stroke-width="${instanceProfile.strokes.symbol}" stroke-linecap="${instanceProfile.lineCap}" stroke-linejoin="${instanceProfile.lineJoin}"${profileMiterAttribute(instanceProfile)}>${primitives}</g></g>${formula}${pinNames}</g>`;
    })
    .join("");
  const annotations = resolvedAnnotations
    .sort((left, right) =>
      left.annotation.id.localeCompare(right.annotation.id, "en"),
    )
    .map(({ annotation, content, presentation }) => {
      const annotationProfile = objectStyleProfile(profile, annotation);
      const attachment = ` data-anchor-kind="${annotation.anchor.kind}"`;
      const routeMarkerPlacement = drawnRouteMarkerPlacement(
        annotation,
        presentation,
        routingGeometry,
      );
      const position = routeMarkerPlacement?.position ?? presentation.position;
      const rotation = routeMarkerPlacement?.rotation ?? presentation.rotation;
      const transform = `rotate(${rotation} ${position.x} ${position.y})`;
      const attributes = `data-object-id="${escapeXml(annotation.id)}" data-kind="${annotation.kind}"${attachment}`;
      const annotationFontSize =
        schematicTextFontSize(annotation.kind, annotationProfile) *
        (annotation.sizeScale ?? 1);
      const ownerInstanceId = annotationOwningInstanceId(annotation);
      const resolvedColor = resolveAnnotationTextColor(
        annotation,
        ownerInstanceId ? instancesById.get(ownerInstanceId) : undefined,
        annotationProfile.foreground,
      );
      const colorOverride =
        resolvedColor === annotationProfile.foreground
          ? undefined
          : resolvedColor;
      const globalLabel =
        annotation.kind === "net-label" &&
        document.connectivityEvidence.some(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.scope === "global" &&
            evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id,
        );
      const globalBadge = globalLabel
        ? `<g data-role="global-net-badge" transform="${transform}"><rect x="${position.x - 8}" y="${position.y - annotationFontSize - 2}" width="7" height="7" rx="2" fill="${annotationProfile.background}" stroke="${annotationProfile.foreground}" stroke-width="0.8"/><text x="${position.x - 4.5}" y="${position.y - annotationFontSize + 3.3}" text-anchor="middle" font-size="5px" font-weight="700">G</text></g>`
        : "";
      if (
        annotation.kind === "route-marker" &&
        annotation.markerKind === "current"
      ) {
        const x = position.x;
        const y = position.y;
        const vertical = rotation === 90 || rotation === 270;
        const label = routeMarkerPlacement?.labelPosition;
        const textAnchor = routeMarkerPlacement
          ? "middle"
          : vertical
            ? "start"
            : annotation.alignment;
        const arrow = annotationProfile.annotations;
        // A route-marker is mounted on an existing route, so that route is
        // the arrow shaft. Draw only the triangular head; a separate fixed
        // shaft leaves visible stubs on short or vertical wires.
        const tipX = x + arrow.arrowHeadLength / 2;
        const baseX = x - arrow.arrowHeadLength / 2;
        const halfHeadWidth = arrow.arrowHeadWidth / 2;
        const markerTextX = label
          ? label.x
          : vertical
            ? x + arrow.arrowHeadLength / 2 + arrow.currentLabelGap
            : x;
        const markerTextY = label
          ? label.y
          : vertical
            ? y + 4
            : y - arrow.currentLabelGap;
        const formula = renderFormulaDocument(content, annotationProfile, {
          x: markerTextX,
          baselineY: markerTextY,
          fontSize: annotationFontSize,
          alignment: textAnchor,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? formula
          : `<text x="${markerTextX}" y="${markerTextY}" text-anchor="${textAnchor}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", annotationProfile, annotation.sizeScale)}>${renderAnnotationText(content, annotation, annotationProfile)}</text>`;
        return `<g ${attributes}><g transform="${transform}"><polygon data-role="current-arrow-head" points="${tipX},${y} ${baseX},${y - halfHeadWidth} ${baseX},${y + halfHeadWidth}" fill="${annotationProfile.foreground}"/></g>${text}</g>`;
      }
      if (annotation.kind === "power-label") {
        // The power-rail Route is the complete supply bar. Drawing a second,
        // thinner annotation-owned bar at its endpoint creates the visible
        // terminal stub and makes hit geometry disagree with presentation.
        const formula = renderFormulaDocument(content, annotationProfile, {
          x: position.x,
          baselineY: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? `<g transform="${transform}">${formula}</g>`
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("power-label", annotationProfile, annotation.sizeScale)}>${renderAnnotationText(content, annotation, annotationProfile)}</text>`;
        return `<g ${attributes}>${text}</g>`;
      }
      if (
        annotation.kind === "route-marker" &&
        annotation.markerKind === "voltage"
      ) {
        const polarity = annotationProfile.annotations;
        const positiveOffset = rotateOffset(
          { x: -polarity.polarityOffsetX, y: -polarity.polarityHalfGap },
          rotation,
        );
        const negativeOffset = rotateOffset(
          { x: -polarity.polarityOffsetX, y: polarity.polarityHalfGap },
          rotation,
        );
        const polarityStyle = `font-style:normal;font-weight:${annotationProfile.typography.plainWeight}`;
        const formula = renderFormulaDocument(content, annotationProfile, {
          x: position.x,
          baselineY: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? formula
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", annotationProfile, annotation.sizeScale)}>${renderAnnotationText(content, annotation, annotationProfile)}</text>`;
        return `<g ${attributes}><text data-role="polarity-positive" x="${position.x + positiveOffset.x}" y="${position.y + positiveOffset.y + 4}" text-anchor="middle" font-size="${annotationProfile.typography.polarityFontSize}" style="${polarityStyle}">+</text><text data-role="polarity-negative" x="${position.x + negativeOffset.x}" y="${position.y + negativeOffset.y + 4}" text-anchor="middle" font-size="${annotationProfile.typography.polarityFontSize}" style="${polarityStyle}">−</text>${text}</g>`;
      }
      const emphasis = "";
      const positionedFraction =
        annotation.kind === "instance-value" && annotation.rotation === 0
          ? renderPositionedFractionAnnotation(content, {
              attributes,
              position,
              alignment: annotation.alignment,
              fontSize: annotationFontSize,
              ...(colorOverride ? { color: colorOverride } : {}),
              profile: annotationProfile,
            })
          : null;
      if (positionedFraction) {
        return `<g>${positionedFraction}${globalBadge}</g>`;
      }
      const mixedFractions = renderFractionText(content, annotationProfile, {
        x: position.x,
        y: position.y,
        fontSize: annotationFontSize,
        alignment: annotation.alignment,
        color: colorOverride ?? annotationProfile.foreground,
      });
      if (mixedFractions)
        return `<g ${attributes}><g transform="${transform}">${mixedFractions}</g>${globalBadge}</g>`;
      const formula = renderFormulaDocument(content, annotationProfile, {
        x: position.x,
        baselineY: position.y,
        fontSize: annotationFontSize,
        alignment: annotation.alignment,
        ...(colorOverride ? { color: colorOverride } : {}),
      });
      if (formula) {
        return `<g ${attributes} transform="${transform}">${formula}</g>${globalBadge}`;
      }
      const positioned = renderPositionedOverbarScriptDocument(
        content,
        annotationProfile,
        {
          x: position.x,
          y: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        },
      );
      if (positioned) {
        return `<g transform="${transform}"><text ${attributes} x="${position.x}" y="${position.y}" text-anchor="start"${emphasis}${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, annotationProfile, annotation.sizeScale)}>${positioned.tspans}</text>${positioned.decorations}</g>${globalBadge}`;
      }
      return `<text ${attributes} x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${emphasis}${colorOverride ? ` fill="${colorOverride}" color="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, annotationProfile, annotation.sizeScale)}>${renderAnnotationText(content, annotation, annotationProfile)}</text>${globalBadge}`;
    })
    .join("");

  return {
    viewBox,
    formalBody: `<g data-layer="formal">${renderDraftingLayer(document, resolver, profile, routingGeometry, "background", objectIds)}<g data-layer="routes">${routes}</g><g data-layer="junctions">${junctions}</g><g data-layer="symbols">${symbols}</g>${noConnectLayer}<g data-layer="annotations">${annotations}</g>${renderDraftingLayer(document, resolver, profile, routingGeometry, "foreground", objectIds)}</g>`,
  };
}

export function renderDocumentSvg(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: SvgRenderOptions = {},
): string {
  const scene = buildSvgScene(document, resolver, options);
  if (
    options.objectIds &&
    !/<(?:path|polyline|polygon|circle|ellipse|rect|line|text)\b/u.test(
      scene.formalBody,
    )
  ) {
    throw new Error("Select visible objects before copying");
  }
  const profile = resolveDocumentStyleProfile(document.presentation);
  const title = escapeXml(options.title ?? document.name);
  const { x, y, width, height } = scene.viewBox;
  const background =
    options.background === "transparent"
      ? ""
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${profile.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" role="img" aria-labelledby="title" data-style-profile="${profile.id}"><title id="title">${title}</title>${background}<style>${schematicRoundPeriodFontFaceCss}svg{font-size:${profile.typography.annotationFontSize}px;fill:${profile.foreground}}text{font-family:${profile.typography.fontFamily}}</style>${scene.formalBody}</svg>\n`;
}
