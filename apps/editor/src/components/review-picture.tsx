import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ReviewMark } from "../review-queue";

type Frame = { left: number; top: number; width: number; height: number };
type View = { scale: number; x: number; y: number };
type Drag =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "pan"; startX: number; startY: number; from: View };

const FIT: View = { scale: 1, x: 0, y: 0 };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A spot of a picture, in fractions of its size. */
export type PictureBox = Omit<ReviewMark, "side">;

/**
 * Where each device sits in one of our drawings: its symbol's box, by
 * instance id, read off the same SVG the picture shows. The SVG is laid
 * out off screen to measure, without its styles, scripts or handlers.
 */
export function useInstanceBoxes(
  src: string,
  fetchLike: typeof fetch = fetch,
): {
  boxes: ReadonlyMap<string, PictureBox>;
  /** The drawing's own coordinates the picture shows (its viewBox). */
  view: { x: number; y: number; w: number; h: number } | null;
} {
  const [boxes, setBoxes] = useState<ReadonlyMap<string, PictureBox>>(
    () => new Map(),
  );
  const [shownView, setShownView] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLike(src, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (cancelled || !text || typeof DOMParser === "undefined") return;
        const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
        for (const element of parsed.querySelectorAll(
          "script, style, foreignObject, image",
        ))
          element.remove();
        for (const element of parsed.querySelectorAll("*"))
          for (const attribute of [...element.attributes])
            if (attribute.name.toLowerCase().startsWith("on"))
              element.removeAttribute(attribute.name);
        const svg = parsed.documentElement;
        if (svg.nodeName.toLowerCase() !== "svg") return;
        const host = document.createElement("div");
        host.style.cssText =
          "position:absolute;left:-10000px;top:0;width:800px;visibility:hidden";
        host.append(document.importNode(svg, true));
        document.body.append(host);
        const placed = host.querySelector("svg")!;
        const view = placed.viewBox.baseVal;
        const next = new Map<string, PictureBox>();
        if (view && view.width > 0 && view.height > 0)
          for (const group of placed.querySelectorAll<SVGGraphicsElement>(
            "g[data-symbol-id][data-object-id]",
          )) {
            const box = group.getBBox();
            const pad = 4;
            const x = clamp((box.x - pad - view.x) / view.width);
            const y = clamp((box.y - pad - view.y) / view.height);
            next.set(group.dataset.objectId!, {
              x,
              y,
              w: clamp((box.x + box.width + pad - view.x) / view.width) - x,
              h: clamp((box.y + box.height + pad - view.y) / view.height) - y,
            });
          }
        host.remove();
        setBoxes(next);
        if (view && view.width > 0 && view.height > 0)
          setShownView({
            x: view.x,
            y: view.y,
            w: view.width,
            h: view.height,
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [src, fetchLike]);
  return { boxes, view: shownView };
}

/**
 * One of Review's two pictures, with the boxes drawn on it. The wheel zooms
 * at the pointer, in place or in the zoomed view (#2131). Inline at its
 * fitted size a drag boxes a spot and a click opens the zoomed view, and the
 * wheel turned away lets the page scroll; zoomed in, a drag pans, Shift-drag
 * boxes and a double-click or Fit returns it. In the zoomed view a drag pans
 * unless the box tool is on or Shift is held. Boxes are fractions of the
 * picture, so they land on the same spot at any size.
 */
export function MarkablePicture({
  src,
  alt,
  side,
  marks,
  shown = null,
  highlight = null,
  hints = [],
  onAdd,
  onOpen,
  zoomed = false,
  boxTool = false,
}: {
  src: string;
  alt: string;
  side: ReviewMark["side"];
  /** The reviewer's own boxes on both pictures, numbered in this order. */
  marks: readonly ReviewMark[];
  /** Another review's boxes, while the reader points at that review. */
  shown?: readonly ReviewMark[] | null;
  /** The device lit in the netlists, where it sits in this picture. */
  highlight?: PictureBox | null;
  /** What the layout checks found, while the reader points at them. */
  hints?: readonly PictureBox[];
  onAdd?: (mark: ReviewMark) => void;
  onOpen?: () => void;
  zoomed?: boolean;
  boxTool?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [view, setView] = useState<View>(FIT);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<ReviewMark | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = view === FIT;

  // Another picture starts fitted.
  useEffect(() => setView(FIT), [src]);

  // Where the picture sits in its box, unzoomed: the boxes' frame.
  const measure = () => {
    const img = image.current;
    if (img && img.offsetWidth > 0)
      setFrame({
        left: img.offsetLeft,
        top: img.offsetTop,
        width: img.offsetWidth,
        height: img.offsetHeight,
      });
  };
  useLayoutEffect(() => {
    measure();
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  // The wheel zooms at the pointer and must not scroll the page meanwhile;
  // inline, at the fitted size, turning it away scrolls the page as before.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current;
      if (!zoomed && current === FIT && event.deltaY >= 0) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const scale = Math.min(
        12,
        Math.max(1, current.scale * Math.exp(-event.deltaY * 0.0015)),
      );
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView(
        scale === 1
          ? FIT
          : {
              scale,
              x: px - ((px - current.x) * scale) / current.scale,
              y: py - ((py - current.y) * scale) / current.scale,
            },
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomed]);

  /** The pointer as a fraction of the picture as drawn now. */
  const fractionAt = (clientX: number, clientY: number) => {
    const rect = image.current!.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp((clientY - rect.top) / rect.height),
    };
  };
  const drawing = (shift: boolean) =>
    !!onAdd && ((!zoomed && fitted) || boxTool || shift);
  const pans = zoomed || !fitted;

  return (
    <div
      ref={box}
      className={`review-pic${zoomed ? " zoomed" : ""}`}
      data-drawing={drawing(false) ? "true" : undefined}
      data-panning={pans && !drawing(false) ? "true" : undefined}
      // How to use it, without taking room beside it.
      title={
        zoomed
          ? undefined
          : !fitted
            ? `Wheel zooms · drag pans${onAdd ? " · Shift-drag boxes a spot" : ""} · double-click fits`
            : onAdd
              ? "Wheel zooms · drag to box a spot · click to open large"
              : "Wheel zooms · click to open large"
      }
      onPointerDown={(event) => {
        if (event.button !== 0 || !image.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag(
          drawing(event.shiftKey)
            ? { kind: "draw", startX: event.clientX, startY: event.clientY }
            : pans
              ? {
                  kind: "pan",
                  startX: event.clientX,
                  startY: event.clientY,
                  from: view,
                }
              : { kind: "draw", startX: event.clientX, startY: event.clientY },
        );
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        if (drag.kind === "pan") {
          setView({
            ...drag.from,
            x: drag.from.x + event.clientX - drag.startX,
            y: drag.from.y + event.clientY - drag.startY,
          });
          return;
        }
        const a = fractionAt(drag.startX, drag.startY);
        const b = fractionAt(event.clientX, event.clientY);
        setDraft({
          side,
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(a.x - b.x),
          h: Math.abs(a.y - b.y),
        });
      }}
      onPointerUp={(event) => {
        const was = drag;
        setDrag(null);
        setDraft(null);
        if (was?.kind !== "draw") return;
        const moved =
          Math.abs(event.clientX - was.startX) +
          Math.abs(event.clientY - was.startY);
        if (moved < 6) {
          if (!zoomed && fitted) onOpen?.();
          return;
        }
        if (draft && onAdd && draft.w > 0.005 && draft.h > 0.005) onAdd(draft);
      }}
      onDoubleClick={() => setView(FIT)}
    >
      <div
        className="review-pic-stage"
        style={
          view === FIT
            ? undefined
            : {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }
        }
      >
        <img
          ref={image}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={measure}
        />
        {frame ? (
          <div
            className="review-marks"
            style={{
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
            }}
          >
            {marks.map((mark, index) =>
              mark.side === side ? (
                <MarkBox key={`own-${index}`} mark={mark} label={index + 1} />
              ) : null,
            )}
            {(shown ?? []).map((mark, index) =>
              mark.side === side ? (
                <MarkBox
                  key={`shown-${index}`}
                  mark={mark}
                  label={index + 1}
                  other
                />
              ) : null,
            )}
            {highlight ? (
              <span
                className="review-lit"
                data-testid="review-lit"
                style={{
                  left: `${highlight.x * 100}%`,
                  top: `${highlight.y * 100}%`,
                  width: `${highlight.w * 100}%`,
                  height: `${highlight.h * 100}%`,
                }}
              />
            ) : null}
            {hints.map((hint, index) => (
              <span
                key={`hint-${index}`}
                className="review-hint-box"
                style={{
                  left: `${hint.x * 100}%`,
                  top: `${hint.y * 100}%`,
                  width: `${hint.w * 100}%`,
                  height: `${hint.h * 100}%`,
                }}
              />
            ))}
            {draft ? <MarkBox mark={draft} label={null} /> : null}
          </div>
        ) : null}
      </div>
      {!zoomed && !fitted ? (
        <button
          type="button"
          className="review-pic-fit"
          data-testid="review-pic-fit"
          // A press here is the button's, never a pan or a box.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setView(FIT)}
        >
          {Math.round(view.scale * 100)}% · Fit
        </button>
      ) : null}
    </div>
  );
}

function MarkBox({
  mark,
  label,
  other = false,
}: {
  mark: ReviewMark;
  label: number | null;
  other?: boolean;
}) {
  return (
    <span
      className={`review-mark${other ? " other" : ""}`}
      style={{
        left: `${mark.x * 100}%`,
        top: `${mark.y * 100}%`,
        width: `${mark.w * 100}%`,
        height: `${mark.h * 100}%`,
      }}
    >
      {label === null ? null : <b>{label}</b>}
    </span>
  );
}

/**
 * Both pictures over the whole window, each zoomed and panned on its own;
 * the box tool boxes spots as the inline pictures do. Esc closes it, and
 * while it is open Review's keys rest.
 */
export function ZoomView({
  title,
  pictures,
  marks,
  shown,
  onAdd,
  onClose,
}: {
  title: string;
  pictures: {
    src: string;
    alt: string;
    side: ReviewMark["side"];
    label: string;
    highlight?: PictureBox | null;
    hints?: readonly PictureBox[];
  }[];
  marks: readonly ReviewMark[];
  shown?: readonly ReviewMark[] | null;
  onAdd?: (mark: ReviewMark) => void;
  onClose: () => void;
}) {
  const [boxTool, setBoxTool] = useState(false);
  useEffect(() => {
    // Captured first, so Review's own keys never see them.
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") onClose();
      else if (event.key.toLowerCase() === "b" && onAdd)
        setBoxTool((on) => !on);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onAdd]);
  return (
    <div
      className="review-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} zoomed`}
      data-testid="review-zoom"
    >
      <div className="review-zoom-head">
        <span className="title">{title}</span>
        <span className="hint">
          Wheel zooms · drag pans · double-click fits
          {onAdd ? " · B or Shift-drag boxes a spot" : ""}
        </span>
        {onAdd ? (
          <button
            type="button"
            aria-pressed={boxTool}
            data-testid="review-zoom-box"
            onClick={() => setBoxTool((on) => !on)}
          >
            ▭ Box
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
      <div className="review-zoom-body">
        {pictures.map((picture) => (
          <div key={picture.side}>
            <h4>{picture.label}</h4>
            <MarkablePicture
              src={picture.src}
              alt={picture.alt}
              side={picture.side}
              marks={marks}
              shown={shown ?? null}
              highlight={picture.highlight ?? null}
              hints={picture.hints ?? []}
              {...(onAdd ? { onAdd } : {})}
              zoomed
              boxTool={boxTool}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
