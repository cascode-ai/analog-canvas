import { useMemo } from "react";
import { razaviTextbookProfile } from "@icm/derived";
import { mirrorScale, type Mirror, type Rotation } from "@icm/model";
import {
  renderSymbolDefinitionBody,
  renderUprightSignalFlowFormula,
} from "@icm/render-svg";
import type { SymbolDefinition } from "@icm/symbols";

import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";
import { findPaletteSymbol } from "./symbol-catalog";
import { renderSymbolPreviewPinNames } from "./symbol-artwork";

export interface ComponentPlacementPreviewProps {
  styleProfileId: string;
  symbolId: string;
  symbol?: SymbolDefinition;
  position: { x: number; y: number };
  rotation: Rotation;
  mirror?: Mirror;
}

export function ComponentPlacementPreview({
  styleProfileId,
  symbolId,
  symbol,
  position,
  rotation,
  mirror = "none",
}: ComponentPlacementPreviewProps) {
  const definition = symbol ?? findPaletteSymbol(styleProfileId, symbolId);
  const variantId = definition
    ? defaultRazaviSymbolVariantId(definition.id)
    : undefined;
  const variant = definition?.variants.find(
    (candidate) => candidate.id === variantId,
  );
  const bodyHtml = useMemo(
    () =>
      definition
        ? {
            __html: renderSymbolDefinitionBody(
              definition,
              variant?.hiddenPrimitiveParts,
              variant?.additionalPrimitives,
              razaviTextbookProfile,
              undefined,
              undefined,
              { rotation, mirror },
            ),
          }
        : null,
    [definition, variant, rotation, mirror],
  );
  const pinNamesHtml = useMemo(() => {
    if (!definition) return null;
    const markup = renderSymbolPreviewPinNames(
      definition,
      variant?.hiddenPinNames ?? [],
      rotation,
      mirror,
    );
    return markup ? { __html: markup } : null;
  }, [definition, variant, rotation, mirror]);
  const formulaHtml = useMemo(() => {
    if (!definition) return null;
    const markup = renderUprightSignalFlowFormula(
      definition.formulaPresentation,
      undefined,
      { position, rotation, mirror },
      { foreground: "currentColor", profile: razaviTextbookProfile },
    );
    return markup ? { __html: markup } : null;
  }, [definition, position.x, position.y, rotation, mirror]);

  if (!definition || !bodyHtml) return null;

  const scale = mirrorScale(mirror);
  const mirrorTransform =
    scale.x === 1 && scale.y === 1 ? "" : ` scale(${scale.x} ${scale.y})`;
  const transform = `translate(${position.x} ${position.y})${mirrorTransform} rotate(${rotation})`;

  return (
    // Upright text lives outside the body's transform, but belongs to the
    // same non-interactive ghost. Otherwise moving the pointer can replace a
    // pressed text node before pointerup and prevent the browser's click.
    <g className="component-placement-preview">
      <g
        data-testid="component-placement-preview"
        transform={transform}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        strokeLinejoin="miter"
        dangerouslySetInnerHTML={bodyHtml}
      />
      {formulaHtml ? <g dangerouslySetInnerHTML={formulaHtml} /> : null}
      {pinNamesHtml ? (
        <g
          transform={`translate(${position.x} ${position.y})`}
          fill="currentColor"
          stroke="none"
          style={{ fontFamily: razaviTextbookProfile.typography.fontFamily }}
          dangerouslySetInnerHTML={pinNamesHtml}
        />
      ) : null}
    </g>
  );
}
