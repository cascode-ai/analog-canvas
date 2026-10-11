/** Coupled inductors: their polarity dots and the arrow naming the coupling. */
import {
  arrowArtworkBounds,
  arrowPathData,
  resolveInductorCouplingGeometry,
} from "@icm/derived";
import type {
  ResolvedInductorCoupling,
  SchematicStyleProfile,
} from "@icm/derived";
import type { DerivedRect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { escapeXml } from "./svg-markup.js";

/**
 * The couplings a paint filter keeps: a coupling drawn whole, or one whose
 * two inductors are both painted. One inductor alone shows no dot, since a
 * copy of it alone carries no coupling.
 */
function paintedCouplings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  objectIds: ReadonlySet<string> | undefined,
): ResolvedInductorCoupling[] {
  return resolveInductorCouplingGeometry(document, resolver, profile).filter(
    ({ coupling }) =>
      !objectIds ||
      objectIds.has(coupling.id) ||
      coupling.members.every((member) => objectIds.has(member.instanceId)),
  );
}

/** The name reads as a part's name does: the annotation size, bold italic. */
function labelFontSize(profile: SchematicStyleProfile): number {
  return profile.typography.annotationFontSize;
}

const pair = (point: { x: number; y: number }) => `${point.x} ${point.y}`;

export function renderInductorCouplingLayer(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  objectIds?: ReadonlySet<string>,
): string {
  const couplings = paintedCouplings(document, resolver, profile, objectIds);
  if (!couplings.length) return "";
  const color = profile.foreground;
  // An inductor in several couplings shows one dot per dotted end.
  const drawnDots = new Set<string>();
  const body = couplings
    .map(({ coupling, dots, arrow }) => {
      const [first, second] = coupling.members;
      const dotMarkup = dots
        .filter((dot) => {
          const key = `${dot.instanceId}\u0000${dot.pinName}`;
          if (drawnDots.has(key)) return false;
          drawnDots.add(key);
          return true;
        })
        .map(
          (dot) =>
            `<circle data-role="coupling-dot" data-drag-object-id="${escapeXml(dot.instanceId)}" cx="${dot.center.x}" cy="${dot.center.y}" r="${dot.radius}" fill="${color}"/>`,
        )
        .join("");
      let arrowMarkup = "";
      if (arrow) {
        const { artwork, label } = arrow;
        const fontSize = labelFontSize(profile);
        // Each head is marked with the end it sits at, so a drag moves it
        // with that end's inductor.
        const nearer = (point: { x: number; y: number }) =>
          Math.hypot(
            point.x - arrow.points[0].x,
            point.y - arrow.points[0].y,
          ) <=
          Math.hypot(point.x - arrow.points[1].x, point.y - arrow.points[1].y)
            ? 0
            : 1;
        const heads = artwork.heads
          .map(
            (head) =>
              `<polygon data-coupling-head="${nearer(head.points[0]!)}" points="${head.points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="${color}"/>`,
          )
          .join("");
        const subscript = label.subscript
          ? `<tspan font-size="${fontSize * 0.7}" dy="${fontSize * 0.25}">${escapeXml(label.subscript)}</tspan>`
          : "";
        arrowMarkup = `<path data-role="coupling-arrow" data-p0="${pair(arrow.points[0])}" data-c="${pair(arrow.control)}" data-p1="${pair(arrow.points[1])}" d="${arrowPathData(artwork.shaft, artwork.controls)}" fill="none" stroke="${color}" stroke-width="${artwork.strokeWidth}" stroke-linecap="${profile.lineCap}"/>${heads}<text data-role="coupling-name" x="${label.position.x}" y="${label.position.y}" text-anchor="${label.anchor}" font-size="${fontSize}" font-style="italic" font-weight="bold">${escapeXml(label.base)}${subscript}</text>`;
      }
      // Its ends name their inductors, so a drag bends the arrow end by end.
      return `<g data-object-id="${escapeXml(coupling.id)}" data-kind="inductor-coupling" data-coupling-ends="${escapeXml(first.instanceId)} ${escapeXml(second.instanceId)}">${dotMarkup}${arrowMarkup}</g>`;
    })
    .join("");
  return `<g data-layer="inductor-couplings">${body}</g>`;
}

/** Everything the coupling layer paints, for the scene's formal bounds. */
export function inductorCouplingBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  objectIds?: ReadonlySet<string>,
): DerivedRect[] {
  const fontSize = labelFontSize(profile);
  return paintedCouplings(document, resolver, profile, objectIds).flatMap(
    ({ coupling, dots, arrow }) => {
      const rects: DerivedRect[] = dots.map(({ center, radius }) => ({
        x: center.x - radius,
        y: center.y - radius,
        width: radius * 2,
        height: radius * 2,
      }));
      if (arrow) {
        rects.push(arrowArtworkBounds(arrow.artwork));
        const width = coupling.name.length * fontSize * 0.6;
        const { position, anchor } = arrow.label;
        rects.push({
          x:
            anchor === "start"
              ? position.x
              : anchor === "end"
                ? position.x - width
                : position.x - width / 2,
          y: position.y - fontSize,
          width,
          height: fontSize * 1.4,
        });
      }
      return rects;
    },
  );
}
