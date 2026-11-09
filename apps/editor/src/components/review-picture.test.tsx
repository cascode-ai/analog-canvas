// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewMark } from "../review-queue";
import { MarkablePicture } from "./review-picture";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // jsdom lays nothing out: the picture is 400×300 at the origin.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 300,
  } as DOMRect);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = (onAdd = vi.fn(), onOpen = vi.fn()) => {
  act(() =>
    root.render(
      <MarkablePicture
        src="/redraw.svg"
        alt="Our drawing"
        side="redraw"
        marks={[]}
        onAdd={onAdd}
        onOpen={onOpen}
      />,
    ),
  );
  return { onAdd, onOpen };
};
const picture = () => container.querySelector<HTMLElement>(".review-pic")!;
const stage = () =>
  container.querySelector<HTMLElement>(".review-pic-stage")!.style.transform;
const fit = () => container.querySelector<HTMLButtonElement>(".review-pic-fit");
const wheel = (deltaY: number) => {
  const event = new WheelEvent("wheel", {
    deltaY,
    clientX: 200,
    clientY: 150,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    picture().dispatchEvent(event);
  });
  return event;
};
const pointer = (
  type: string,
  clientX: number,
  clientY: number,
  shiftKey = false,
) =>
  act(() => {
    picture().dispatchEvent(
      new MouseEvent(type, {
        clientX,
        clientY,
        shiftKey,
        button: 0,
        bubbles: true,
      }),
    );
  });
const drag = (from: number, to: number, shiftKey = false) => {
  pointer("pointerdown", from, from, shiftKey);
  pointer("pointermove", to, to, shiftKey);
  pointer("pointerup", to, to, shiftKey);
};

describe("a Review picture zooms in place (#2131)", () => {
  it("zooms at the pointer, and turned away at its fitted size lets the page scroll", () => {
    render();
    expect(wheel(100).defaultPrevented).toBe(false);
    expect(stage()).toBe("");
    expect(fit()).toBeNull();
    expect(wheel(-300).defaultPrevented).toBe(true);
    expect(stage()).toMatch(/scale\(1\.\d+\)/u);
    expect(fit()?.textContent).toMatch(/^\d+% · Fit$/u);
    // Zoomed in, the wheel turned away zooms out instead of scrolling.
    expect(wheel(100).defaultPrevented).toBe(true);
  });

  it("pans when zoomed in, boxes a spot with Shift, and opens nothing on a click", () => {
    const { onAdd, onOpen } = render();
    wheel(-300);
    const zoomed = stage();
    drag(100, 160);
    expect(stage()).not.toBe(zoomed);
    expect(onAdd).not.toHaveBeenCalled();
    drag(40, 120, true);
    expect(onAdd).toHaveBeenCalledWith<[ReviewMark]>(
      expect.objectContaining({ side: "redraw" }),
    );
    drag(50, 51);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("goes back to the whole picture with Fit, where a drag boxes and a click opens it", () => {
    const { onAdd, onOpen } = render();
    wheel(-300);
    act(() => fit()!.click());
    expect(stage()).toBe("");
    expect(fit()).toBeNull();
    drag(40, 120);
    expect(onAdd).toHaveBeenCalledTimes(1);
    drag(50, 51);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
