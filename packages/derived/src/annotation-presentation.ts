import { flattenRichText } from "@icm/model";
import type {
  Annotation,
  DerivedPoint,
  DerivedRect,
  RichTextDocument,
  Rotation,
  SchematicDocument,
} from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import type { SymbolResolver } from "@icm/symbols";

import { resolveVisualAnchor, type ResolvedAnchor } from "./anchor.js";
import { resolveAnnotationText } from "./annotation-text.js";
import {
  labelInkDescentEm,
  uprightTextInkBounds,
  uprightTextInkSpan,
} from "./text-ink.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import {
  formulaExtents,
  fractionExtraAscentEm,
  fractionPartScale,
  measureRichTextDocument,
  richTextMetrics,
} from "./rich-text-layout.js";
import {
  objectStyleProfile,
  type SchematicStyleProfile,
} from "./style-profile.js";
import type { ResolvedDocumentLogicalNets } from "./logical-net.js";

/** Shared SVG, editor-hit, marquee, and export presentation of an annotation. */
export interface AnnotationPresentation {
  readonly anchor: ResolvedAnchor;
  /** Visible SVG text baseline; never substitute fallback while resolved. */
  readonly position: DerivedPoint;
  readonly rotation: Rotation;
  readonly alignment: "start" | "middle" | "end";
  readonly bounds: DerivedRect;
  /**
   * The extent label placement keeps clear of a part: capitals above the
   * baseline and a subscript's figures below it, with a stacked fraction's
   * rise and any further lines, and across from the first glyph's outline
   * to the last one's as the label advance tables set them. `bounds`
   * reserves the font's whole ascent and a descender, most of it empty over
   * capitals.
   */
  readonly inkBounds: DerivedRect;
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
  resolvedText?: RichTextDocument,
): boolean {
  if (annotation.visible === false) return false;
  if (
    !flattenRichText(
      resolvedText ?? resolveAnnotationText(document, annotation, logicalNets),
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
  // A MOS's W/L already carries its ×m (#752): its own ×m label stands in
  // only while the W/L is hidden, so the count is never drawn twice (#1423).
  if (
    binding?.kind === "instance-value" &&
    binding.parameter !== undefined &&
    valuePrintsMultiplier(
      document.instances.find((item) => item.id === binding.instanceId)
        ?.symbolId,
      binding.parameter,
    ) &&
    document.annotations.some(
      (other) =>
        other.binding?.kind === "instance-value" &&
        other.binding.instanceId === binding.instanceId &&
        other.binding.parameter === undefined &&
        isSchematicAnnotationVisible(document, other, logicalNets),
    )
  )
    return false;
  return !(
    binding?.kind === "instance-reference" &&
    document.netlist?.terminals.some((terminal) =>
      terminal.interfaceInstanceIds.includes(binding.instanceId),
    )
  );
}

/**
 * Whether a part's value prints this parameter as its ×m: a MOS's W/L does
 * (#752), so its own ×m label is wanted only while the W/L is hidden.
 */
export function valuePrintsMultiplier(
  symbolId: string | undefined,
  parameterName: string,
): boolean {
  const parameters = symbolId
    ? (deviceDescriptor(symbolId)?.parameters ?? [])
    : [];
  return (
    parameters.some(
      (parameter) =>
        parameter.displayRole === "multiplier" &&
        parameter.name.toLowerCase() === parameterName.toLowerCase(),
    ) && parameters.some((parameter) => parameter.displayRole === "width")
  );
}

export { labelInkDescentEm };

export function resolveAnnotationPresentation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  documentProfile: SchematicStyleProfile,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
  logicalNets?: ResolvedDocumentLogicalNets,
  resolvedText?: RichTextDocument,
): AnnotationPresentation {
  const styleProfile = objectStyleProfile(documentProfile, annotation);
  const anchor = resolveVisualAnchor(
    document,
    resolver,
    annotation.anchor,
    routingGeometry,
  );
  const sizeScale = annotation.sizeScale ?? 1;
  const fontSize = annotationFontSize(annotation, styleProfile) * sizeScale;
  const text =
    resolvedText ?? resolveAnnotationText(document, annotation, logicalNets);
  const metrics = {
    ...richTextMetrics(styleProfile, "label", sizeScale),
    fontSize,
  };
  const textLayout = measureRichTextDocument(text, metrics);
  // A stacked fraction raises its numerator past the plain first-line
  // ascent heuristic; extend the shared bounds so hits and export cover it.
  // The extra ascent is in em of the part font, so it tracks the part scale.
  const fractionExtraAscent =
    fontSize *
    fractionPartScale(styleProfile.typography.subscriptScale) *
    fractionExtraAscentEm(text, styleProfile.typography);
  const width = Math.max(fontSize * 0.6, textLayout.width);
  const height =
    Math.max(fontSize * 1.35, textLayout.height) + fractionExtraAscent;
  const left =
    annotation.alignment === "start"
      ? anchor.position.x
      : annotation.alignment === "end"
        ? anchor.position.x - width
        : anchor.position.x - width / 2;
  // A label that is a formula stands on its baseline by the formula's own
  // extent, as drawing text does.
  const formula = formulaExtents(text, metrics);
  const unrotatedBounds = formula
    ? {
        x:
          annotation.alignment === "start"
            ? anchor.position.x
            : annotation.alignment === "end"
              ? anchor.position.x - formula.width
              : anchor.position.x - formula.width / 2,
        y: anchor.position.y - formula.ascent,
        width: formula.width,
        height: formula.ascent + formula.descent,
      }
    : {
        x: left,
        y: anchor.position.y - fontSize * 1.05 - fractionExtraAscent,
        width,
        height,
      };
  const bounds =
    annotation.rotation === 0
      ? unrotatedBounds
      : rotatedAnnotationBounds(
          unrotatedBounds,
          anchor.position,
          annotation.rotation,
        );
  // A Net Label stands as close over its wire as its own text allows
  // (#1300), so its ink reaches only as low as that text does. A part's
  // labels keep the subscript row their placement rules reserve.
  const descentEm =
    annotation.kind === "net-label"
      ? labelInkDescentEm(text, styleProfile.typography)
      : styleProfile.typography.subscriptScale *
        styleProfile.typography.subscriptBaselineShiftEm;
  // Across, the ink runs from the first glyph's outline to the last one's as
  // the label advance tables set them (#1413); `width` is the room hits and
  // export reserve, 0.6 em a character.
  const span = formula
    ? null
    : uprightTextInkSpan(
        text,
        metrics,
        annotation.alignment,
        anchor.position.x,
      );
  const unrotatedInk = formula
    ? unrotatedBounds
    : uprightTextInkBounds({
        left: span?.left ?? left,
        width: span?.width ?? width,
        baseline: anchor.position.y,
        fontSize,
        fractionAscent: fractionExtraAscent,
        descentEm,
        layoutHeight: textLayout.height,
      });
  return {
    anchor,
    position: anchor.position,
    rotation: annotation.rotation,
    alignment: annotation.alignment,
    bounds,
    inkBounds:
      annotation.rotation === 0
        ? unrotatedInk
        : rotatedAnnotationBounds(
            unrotatedInk,
            anchor.position,
            annotation.rotation,
          ),
  };
}

function rotatedAnnotationBounds(
  bounds: DerivedRect,
  origin: DerivedPoint,
  rotation: Rotation,
): DerivedRect {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
      x: origin.x + dx * cosine - dy * sine,
      y: origin.y + dx * sine + dy * cosine,
    };
  });
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
