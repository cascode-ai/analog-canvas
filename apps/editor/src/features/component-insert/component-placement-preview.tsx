import { razaviTextbookProfile } from "@icm/derived";
import { renderSymbolDefinitionBody } from "@icm/render-svg";
import type { SymbolDefinition } from "@icm/symbols";

import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";
import { annotationPresetText } from "./annotation-preview-symbols";
import { findPaletteSymbol } from "./symbol-catalog";
import { renderSymbolPreviewPinNames } from "./symbol-artwork";

export interface ComponentPlacementPreviewProps {
  styleProfileId: string;
  symbolId: string;
  symbol?: SymbolDefinition;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  mirror?: "none" | "x";
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
  const presetText = annotationPresetText(symbolId);
  if (presetText) {
    // WYSIWYG: a preset sign lands as an ordinary drafting text, so its ghost
    // is that exact glyph — same font, size, and baseline-at-cursor placement
    // the drafting renderer commits — not the palette's vector sketch.
    return (
      <g
        data-testid="component-placement-preview"
        className="component-placement-preview"
        transform={`translate(${position.x} ${position.y}) rotate(${rotation})`}
      >
        <text
          x={0}
          y={0}
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize={razaviTextbookProfile.typography.annotationFontSize}
          style={{ fontFamily: razaviTextbookProfile.typography.fontFamily }}
        >
          {presetText}
        </text>
      </g>
    );
  }
  const variantId = defaultRazaviSymbolVariantId(definition.id);
  const variant = definition.variants.find(
    (candidate) => candidate.id === variantId,
  );

  const transform = `translate(${position.x} ${position.y}) rotate(${rotation})${
    mirror === "x" ? " scale(-1 1)" : ""
  }`;
  const pinNames = renderSymbolPreviewPinNames(
    definition,
    variant?.hiddenPinNames ?? [],
    rotation,
    mirror,
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
          ),
        }}
      />
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
