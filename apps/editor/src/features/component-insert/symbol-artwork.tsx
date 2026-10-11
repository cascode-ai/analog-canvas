import { razaviTextbookProfile } from "@icm/derived";
import { useLayoutEffect, useRef, useState } from "react";
import {
  renderSymbolDefinitionBody,
  renderUprightSignalFlowFormula,
  renderVisiblePinNames,
} from "@icm/render-svg";
import type { Mirror, Rotation } from "@icm/model";
import type { SymbolDefinition } from "@icm/symbols";

import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";

export function renderSymbolPreviewPinNames(
  symbol: SymbolDefinition,
  hiddenPinNames: readonly string[],
  rotation: Rotation,
  mirror: Mirror = "none",
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
  libraryMark,
  /** Fraction of max(viewBox width, height) added around the glyph. */
  paddingRatio = 0.18,
  fitContent = false,
  onPreviewWarning,
}: {
  symbol: SymbolDefinition;
  className: string;
  rotation?: Rotation;
  /** A Library-only source class mark; placed Symbols retain their reviewed artwork. */
  libraryMark?: string;
  paddingRatio?: number;
  /** Library/editor preview only; leaves the stored geometry untouched. */
  fitContent?: boolean;
  onPreviewWarning?: (warning: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const [fitted, setFitted] = useState<string | null>(null);
  const [unusualBounds, setUnusualBounds] = useState(false);
  useLayoutEffect(() => {
    if (!fitContent) return;
    const svg = svgRef.current;
    const content = contentRef.current;
    if (!svg || !content) return;
    let active = true;
    const measure = () => {
      if (!active || !svg.clientWidth || !svg.clientHeight) return;
      const geometry = content.getBBox();
      // SVG getBBox excludes strokes. Include the largest supported stroke join
      // conservatively so custom widths and miter joins remain visible as well.
      let strokeExtent = 0;
      for (const element of content.querySelectorAll<SVGGraphicsElement>(
        "path,line,polyline,polygon,rect,circle,ellipse,text",
      )) {
        const style = getComputedStyle(element);
        if (style.stroke === "none") continue;
        const extent =
          (parseFloat(style.strokeWidth) / 2) *
          (style.strokeLinejoin === "miter"
            ? Math.max(1, parseFloat(style.strokeMiterlimit))
            : 1);
        if (Number.isFinite(extent))
          strokeExtent = Math.max(strokeExtent, extent);
      }
      const box = {
        x: geometry.x - strokeExtent,
        y: geometry.y - strokeExtent,
        width: geometry.width + strokeExtent * 2,
        height: geometry.height + strokeExtent * 2,
      };
      if (
        ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        (!box.width && !box.height)
      )
        return;
      // Fit the actual rendered text and geometry. Eight CSS pixels protect strokes;
      // a magnification cap keeps small glyphs from filling a large detail pane.
      const scale = Math.min(
        3,
        Math.max(1, svg.clientWidth - 16) / Math.max(1, box.width),
        Math.max(1, svg.clientHeight - 16) / Math.max(1, box.height),
      );
      const width = svg.clientWidth / scale;
      const height = svg.clientHeight / scale;
      setFitted(
        `${box.x + box.width / 2 - width / 2} ${box.y + box.height / 2 - height / 2} ${width} ${height}`,
      );
      const declared = symbol.viewBox;
      const unusual =
        Math.max(
          Math.abs(box.x - declared.x),
          Math.abs(box.y - declared.y),
          box.width,
          box.height,
        ) >
        20 * Math.max(declared.width, declared.height);
      setUnusualBounds(unusual);
      onPreviewWarning?.(
        unusual
          ? "Distant geometry: showing all artwork. Inspect the definition to adjust it."
          : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [symbol, rotation, libraryMark, fitContent, onPreviewWarning]);
  const variantId =
    defaultRazaviSymbolVariantId(symbol.id) ?? symbol.defaultVariantId;
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
          // union of all supported-turn bounds so the preview neither clips nor
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
      ref={svgRef}
      className={className}
      viewBox={fitContent && fitted ? fitted : viewBox}
      data-preview-warning={
        unusualBounds
          ? "Unusually distant geometry; showing all artwork."
          : undefined
      }
      data-rotation={rotation}
      aria-hidden="true"
    >
      <g ref={contentRef}>
        <g
          transform={rotation === undefined ? undefined : `rotate(${rotation})`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="square"
          strokeLinejoin="miter"
          dangerouslySetInnerHTML={{
            __html: renderSymbolDefinitionBody(
              libraryMark
                ? {
                    ...symbol,
                    primitives: symbol.primitives.filter(
                      (primitive) =>
                        primitive.kind === "circle" ||
                        (primitive.kind === "line" &&
                          symbol.pins.some(
                            (pin) =>
                              (primitive.from.x === pin.at.x &&
                                primitive.from.y === pin.at.y) ||
                              (primitive.to.x === pin.at.x &&
                                primitive.to.y === pin.at.y),
                          )),
                    ),
                  }
                : symbol,
              variant?.hiddenPrimitiveParts,
              variant?.additionalPrimitives,
              razaviTextbookProfile,
              undefined,
              undefined,
              { rotation: previewRotation, mirror: "none" },
            ),
          }}
        />
        {libraryMark ? (
          <text
            x="0"
            y="0"
            fill="currentColor"
            stroke="none"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={razaviTextbookProfile.typography.fontFamily}
            fontSize="11"
            fontWeight="700"
            data-library-source-mark={libraryMark}
          >
            {libraryMark}
          </text>
        ) : null}
        {formula ? <g dangerouslySetInnerHTML={{ __html: formula }} /> : null}
        {pinNames ? (
          <g
            fill="currentColor"
            stroke="none"
            style={{ fontFamily: razaviTextbookProfile.typography.fontFamily }}
            dangerouslySetInnerHTML={{ __html: pinNames }}
          />
        ) : null}
      </g>
    </svg>
  );
}
