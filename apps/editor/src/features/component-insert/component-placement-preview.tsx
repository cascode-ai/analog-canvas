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
  if (!definition) return null;
  const variantId = defaultRazaviSymbolVariantId(definition.id);
  const variant = definition.variants.find(
    (candidate) => candidate.id === variantId,
  );

  const scale = mirrorScale(mirror);
  const mirrorTransform =
    scale.x === 1 && scale.y === 1 ? "" : ` scale(${scale.x} ${scale.y})`;
  const transform = `translate(${position.x} ${position.y})${mirrorTransform} rotate(${rotation})`;
  const pinNames = renderSymbolPreviewPinNames(
    definition,
    variant?.hiddenPinNames ?? [],
    rotation,
    mirror,
  );
  const formula = renderUprightSignalFlowFormula(
    definition.formulaPresentation,
    undefined,
    { position, rotation, mirror },
    { foreground: "currentColor", profile: razaviTextbookProfile },
  );

  return (
    <>
      <g
        data-testid="component-placement-preview"
        className="component-placement-preview"
        transform={transform}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        strokeLinejoin="miter"
        dangerouslySetInnerHTML={{
          __html: renderSymbolDefinitionBody(
            definition,
            variant?.hiddenPrimitiveParts,
            variant?.additionalPrimitives,
            razaviTextbookProfile,
            undefined,
            undefined,
            { rotation, mirror },
          ),
        }}
      />
      {formula ? <g dangerouslySetInnerHTML={{ __html: formula }} /> : null}
      {pinNames ? (
        <g
          transform={`translate(${position.x} ${position.y})`}
          fill="currentColor"
          stroke="none"
          style={{ fontFamily: razaviTextbookProfile.typography.fontFamily }}
          dangerouslySetInnerHTML={{ __html: pinNames }}
        />
      ) : null}
    </>
  );
}
