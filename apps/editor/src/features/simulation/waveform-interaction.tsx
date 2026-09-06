import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";

export function useWaveformWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export interface WaveformPoint {
  x: number;
  y: number;
}

/** Pointer gestures share the SVG's transform, including letterboxing. */
export function WaveformInteraction({
  children,
  frame,
  onZoom,
  onPick,
  onPan,
  onOpen,
  axes = "xy",
}: {
  children: ReactNode;
  frame: { x: number; y: number; width: number; height: number };
  onZoom(start: WaveformPoint, end: WaveformPoint): void;
  onPick(point: WaveformPoint, traceId?: string): void;
  onPan(delta: WaveformPoint): void;
  onOpen(): void;
  axes?: "xy" | "x" | "y";
}) {
  const drag = useRef<
    | {
        start: WaveformPoint;
        clientX: number;
        clientY: number;
        pan: boolean;
        traceId?: string;
      }
    | undefined
  >(undefined);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const lastPick = useRef<{ time: number; x: number; y: number } | undefined>(
    undefined,
  );
  const pointAt = (
    event: PointerEvent<HTMLDivElement>,
  ): WaveformPoint | undefined => {
    const svg = event.currentTarget.querySelector("svg");
    const transform = svg?.getScreenCTM();
    if (!svg || !transform) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      transform.inverse(),
    );
    return {
      x: Math.max(0, Math.min(1, (point.x - frame.x) / frame.width)),
      y: Math.max(0, Math.min(1, (point.y - frame.y) / frame.height)),
    };
  };
  return (
    <div
      className="spice-ac-plot interactive"
      tabIndex={0}
      aria-label="Waveform: drag to zoom, click to measure, Shift-drag to pan"
      title="Drag to zoom · Click to measure · Shift-drag to pan · Double-click to expand"
      onBlur={() => {
        lastPick.current = undefined;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          drag.current = undefined;
          setBox(undefined);
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const start = pointAt(event);
        if (!start) return;
        const traceId = (event.target as Element)
          .closest("[data-trace-id]")
          ?.getAttribute("data-trace-id");
        drag.current = {
          start,
          clientX: event.clientX,
          clientY: event.clientY,
          pan: event.shiftKey,
          ...(traceId ? { traceId } : {}),
        };
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (
          !start ||
          start.pan ||
          Math.hypot(
            event.clientX - start.clientX,
            event.clientY - start.clientY,
          ) < 5
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const transform = event.currentTarget
          .querySelector("svg")
          ?.getScreenCTM();
        const topLeft = transform
          ? new DOMPoint(frame.x, frame.y).matrixTransform(transform)
          : undefined;
        const bottomRight = transform
          ? new DOMPoint(
              frame.x + frame.width,
              frame.y + frame.height,
            ).matrixTransform(transform)
          : undefined;
        setBox({
          left:
            (axes === "y" && topLeft
              ? topLeft.x
              : Math.min(start.clientX, event.clientX)) - bounds.left,
          top:
            (axes === "x" && topLeft
              ? topLeft.y
              : Math.min(start.clientY, event.clientY)) - bounds.top,
          width:
            axes === "y" && topLeft && bottomRight
              ? bottomRight.x - topLeft.x
              : Math.abs(event.clientX - start.clientX),
          height:
            axes === "x" && topLeft && bottomRight
              ? bottomRight.y - topLeft.y
              : Math.abs(event.clientY - start.clientY),
        });
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        const end = pointAt(event);
        drag.current = undefined;
        setBox(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (!start || !end) return;
        if (
          Math.hypot(
            event.clientX - start.clientX,
            event.clientY - start.clientY,
          ) < 5
        ) {
          const previous = lastPick.current;
          // AC SVG nodes are regenerated when a marker is placed. Recognize
          // the second click on the stable viewport, not a replaced SVG node.
          if (
            previous &&
            event.timeStamp - previous.time < 450 &&
            Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <
              5
          ) {
            lastPick.current = undefined;
            onOpen();
          } else {
            lastPick.current = {
              time: event.timeStamp,
              x: event.clientX,
              y: event.clientY,
            };
            onPick(end, start.traceId);
          }
        } else if (start.pan)
          onPan({ x: end.x - start.start.x, y: end.y - start.start.y });
        else if (
          (axes === "y" || Math.abs(end.x - start.start.x) > 0.005) &&
          (axes === "x" || Math.abs(end.y - start.start.y) > 0.005)
        )
          onZoom(start.start, end);
      }}
      onPointerCancel={() => {
        drag.current = undefined;
        setBox(undefined);
      }}
    >
      {children}
      {box && <div className="waveform-selection" style={box} />}
    </div>
  );
}

/** Bounded, readable 1/2/5 ticks; recomputed from the visible range. */
export function waveformTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const rough = (max - min) / Math.max(2, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((n) => n * power >= rough) ?? 10) * power;
  const first = Math.ceil(min / step - 1e-10);
  const last = Math.floor(max / step + 1e-10);
  return Array.from(
    { length: Math.max(0, Math.min(100, last - first + 1)) },
    (_, i) => Number(((first + i) * step).toPrecision(12)),
  );
}

export function waveformTickLabel(
  value: number,
  step: number,
  unit: string,
): string {
  const exponent = Math.max(
    -15,
    Math.min(
      9,
      Math.floor(Math.log10(Math.abs(value) || Math.abs(step) || 1) / 3) * 3,
    ),
  );
  const scale = 10 ** exponent;
  const prefix =
    new Map([
      [-15, "f"],
      [-12, "p"],
      [-9, "n"],
      [-6, "µ"],
      [-3, "m"],
      [0, ""],
      [3, "k"],
      [6, "M"],
      [9, "G"],
    ]).get(exponent) ?? "";
  const decimals = Math.min(
    15,
    Math.max(0, -Math.floor(Math.log10(Math.abs(step) / scale || 1))),
  );
  return `${(value / scale).toFixed(decimals)} ${prefix}${unit}`;
}
