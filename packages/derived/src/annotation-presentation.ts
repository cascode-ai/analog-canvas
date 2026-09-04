import { flattenRichText } from "@icm/model";
import type {
  Annotation,
  DerivedPoint,
  DerivedRect,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveVisualAnchor, type ResolvedAnchor } from "./anchor.js";
import {
  resolveAnnotationDisplayText,
  resolveAnnotationText,
} from "./annotation-text.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import {
  containsFractionRun,
  fractionGeometry,
  fractionPartScale,
  measureRichTextDocument,
  richTextMetrics,
} from "./rich-text-layout.js";
import type { SchematicStyleProfile } from "./style-profile.js";
import type { ResolvedDocumentLogicalNets } from "./logical-net.js";

/** Shared SVG, editor-hit, marquee, and export presentation of an annotation. */
export interface AnnotationPresentation {
  readonly anchor: ResolvedAnchor;
  /** Visible SVG text baseline; never substitute fallback while resolved. */
  readonly position: DerivedPoint;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly alignment: "start" | "middle" | "end";
  readonly bounds: DerivedRect;
}

/**
 * Shared canvas/export visibility policy for persisted annotations. A retained
 * Instance keeps its object-anchored labels for a later re-placement, but its
 * labels are not floating drawing objects while the Instance is in the Tray.
 * Formal Cell Pins use their terminal name as their sole visible identity.
 *
 * An annotation with no resolved text is not visible either. It paints no
 * glyph, so anything the canvas hangs on it — a hit box, a marquee target — is
 * a control nobody can see. Empty text is always a projection that came back
 * with nothing (a designator for an Instance the device registry gives no
 * reference prefix, a value the Instance does not carry), never something a
 * person authored: `proposeTextEditingCommit` deletes an annotation the moment
 * its content is emptied, and an open editing session holds its text in the
 * session rather than in the annotation. So there is no empty-but-wanted
 * annotation to exempt, including one mid-edit.
 */
export function isSchematicAnnotationVisible(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
): boolean {
  if (annotation.visible === false) return false;
  if (
    !flattenRichText(
      resolveAnnotationText(document, annotation, logicalNets),
    ).trim()
  ) {
    return false;
  }
  const anchoredInstanceId =
    annotation.anchor.kind === "object"
      ? annotation.anchor.objectId
      : undefined;
  if (
    anchoredInstanceId !== undefined &&
    document.instances.some(
      (instance) =>
        instance.id === anchoredInstanceId && instance.placement === null,
    )
  ) {
    return false;
  }
  const binding = annotation.binding;
  return !(
    binding?.kind === "instance-reference" &&
    document.netlist?.terminals.some((terminal) =>
      terminal.interfaceInstanceIds.includes(binding.instanceId),
    )
  );
}

export function resolveAnnotationPresentation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  styleProfile: SchematicStyleProfile,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
  logicalNets?: ResolvedDocumentLogicalNets,
): AnnotationPresentation {
  const anchor = resolveVisualAnchor(
    document,
    resolver,
    annotation.anchor,
    routingGeometry,
  );
  const sizeScale = annotation.sizeScale ?? 1;
  const fontSize = annotationFontSize(annotation, styleProfile) * sizeScale;
  // Bounds are measured from what is painted, so a hidden Reference prefix
  // shrinks the hit box and the export extent with the glyphs.
  const text = resolveAnnotationDisplayText(document, annotation, logicalNets);
  const textLayout = measureRichTextDocument(text, {
    ...richTextMetrics(styleProfile, "label", sizeScale),
    fontSize,
  });
  // A stacked fraction raises its numerator past the plain first-line
  // ascent heuristic; extend the shared bounds so hits and export cover it.
  // The extra ascent is in em of the part font, so it tracks the part scale.
  const fractionExtraAscent = containsFractionRun(text)
    ? fontSize *
      fractionPartScale(styleProfile.typography.subscriptScale) *
      fractionGeometry.extraAscentEm
    : 0;
  const width = Math.max(fontSize * 0.6, textLayout.width);
  const height =
    Math.max(fontSize * 1.35, textLayout.height) + fractionExtraAscent;
  const left =
    annotation.alignment === "start"
      ? anchor.position.x
      : annotation.alignment === "end"
        ? anchor.position.x - width
        : anchor.position.x - width / 2;
  const bounds =
    annotation.rotation === 90 || annotation.rotation === 270
      ? {
          x: anchor.position.x - height / 2,
          y: anchor.position.y - width / 2,
          width: height,
          height: width,
        }
      : {
          x: left,
          y: anchor.position.y - fontSize * 1.05 - fractionExtraAscent,
          width,
          height,
        };
  return {
    anchor,
    position: anchor.position,
    rotation: annotation.rotation,
    alignment: annotation.alignment,
    bounds,
  };
}

function annotationFontSize(
  annotation: Annotation,
  profile: SchematicStyleProfile,
): number {
  switch (annotation.kind) {
    case "instance-label":
    case "instance-value":
      return profile.typography.instanceFontSize;
    case "net-label":
      return profile.typography.netFontSize;
    case "power-label":
      return profile.typography.powerFontSize;
    default:
      return profile.typography.annotationFontSize;
  }
}
