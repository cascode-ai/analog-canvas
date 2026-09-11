import { razaviTextbookProfile } from "@icm/derived";
import {
  renderSymbolDefinitionBody,
  renderUprightSignalFlowFormula,
  renderVisiblePinNames,
} from "@icm/render-svg";
import type { SymbolDefinition } from "@icm/symbols";

import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";

export function renderSymbolPreviewPinNames(
  symbol: SymbolDefinition,
  hiddenPinNames: readonly string[],
  rotation: 0 | 90 | 180 | 270,
  mirror: "none" | "x" = "none",
): string {
  return renderVisiblePinNames(
    symbol,
    hiddenPinNames,
    {
      id: "symbol-preview",
      symbolId: symbol.id,
      placement: {
        position: { x: 0, y: 0 },
        rotation,
        mirror,
      },
    },
    razaviTextbookProfile,
  );
}

export function SymbolArtwork({
  symbol,
  className,
  rotation,
  /** Fraction of max(viewBox width, height) added around the glyph. */
  paddingRatio = 0.18,
}: {
  symbol: SymbolDefinition;
  className: string;
  rotation?: 0 | 90 | 180 | 270;
  paddingRatio?: number;
}) {
  const variantId = defaultRazaviSymbolVariantId(symbol.id);
  const variant = symbol.variants.find(
    (candidate) => candidate.id === variantId,
  );
  const previewRotation = rotation ?? 0;
  const pinNames = renderSymbolPreviewPinNames(
    symbol,
    variant?.hiddenPinNames ?? [],
    previewRotation,
  );
  const formula = renderUprightSignalFlowFormula(
    symbol.formulaPresentation,
    undefined,
    {
      position: { x: 0, y: 0 },
      rotation: previewRotation,
      mirror: "none",
    },
    {
      foreground: "currentColor",
      profile: razaviTextbookProfile,
    },
  );
  const { x, y, width, height } = symbol.viewBox;
  const padding = Math.max(width, height) * paddingRatio;
  const viewBox =
    rotation === undefined
      ? `${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}`
      : (() => {
          // Insert rotation is around the electrical Symbol origin. Use the
          // union of all quarter-turn bounds so the preview neither clips nor
          // changes scale when R rotates an asymmetric symbol.
          const extent =
            Math.max(
              Math.abs(x),
              Math.abs(x + width),
              Math.abs(y),
              Math.abs(y + height),
            ) + padding;
          return `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
        })();

  return (
    <svg
      className={className}
      viewBox={viewBox}
      data-rotation={rotation}
      aria-hidden="true"
    >
      <g
        transform={rotation === undefined ? undefined : `rotate(${rotation})`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        strokeLinejoin="miter"
        dangerouslySetInnerHTML={{
          __html: renderSymbolDefinitionBody(
            symbol,
            variant?.hiddenPrimitiveParts,
            variant?.additionalPrimitives,
            razaviTextbookProfile,
            undefined,
            undefined,
            { rotation: previewRotation, mirror: "none" },
          ),
        }}
      />
      {formula ? <g dangerouslySetInnerHTML={{ __html: formula }} /> : null}
      {pinNames ? (
        <g
          fill="currentColor"
          stroke="none"
          style={{ fontFamily: razaviTextbookProfile.typography.fontFamily }}
          dangerouslySetInnerHTML={{ __html: pinNames }}
        />
      ) : null}
    </svg>
  );
}
