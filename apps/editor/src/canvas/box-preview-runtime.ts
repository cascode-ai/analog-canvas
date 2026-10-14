import { marqueeMode } from "../features/selection/marquee-selection";
import { normalizedRect } from "./canvas-geometry";
import type { BoxPreview } from "./canvas-gesture-model";
import { createPointerPreviewFrame } from "./pointer-preview-frame";

/** Latest raw marquee pose; React owns mounting, not pointer-rate painting. */
export function createBoxPreviewRuntime(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (id: number) => void,
) {
  let latest: BoxPreview | null = null;
  let surface: SVGSVGElement | null = null;
  const paint = (preview: BoxPreview) => {
    if (preview.intent !== "select") return;
    const rectangle = surface?.querySelector('[data-testid="selection-box"]');
    if (!rectangle) return;
    const bounds = normalizedRect(preview.start, preview.end);
    for (const [name, value] of Object.entries(bounds))
      rectangle.setAttribute(name, String(value));
    rectangle.setAttribute(
      "class",
      `selection-box selection-box--${marqueeMode(preview.start, preview.end)}`,
    );
  };
  const frame = createPointerPreviewFrame(paint, requestFrame, cancelFrame);
  return {
    current: () => latest,
    replace(preview: BoxPreview | null) {
      frame.cancel();
      latest = preview;
    },
    preview(preview: BoxPreview) {
      if (
        !latest ||
        latest.pointerId !== preview.pointerId ||
        latest.intent !== preview.intent
      )
        return;
      latest = preview;
      frame.schedule(preview);
    },
    attach(svg: SVGSVGElement) {
      surface = svg;
      // The first pointer can precede React mounting the rectangle.
      if (latest) paint(latest);
    },
    detach(svg: SVGSVGElement) {
      if (surface !== svg) return;
      surface = null;
      frame.cancel();
      latest = null;
    },
    flush: frame.flush,
  };
}

export type BoxPreviewRuntime = ReturnType<typeof createBoxPreviewRuntime>;
