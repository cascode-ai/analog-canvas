// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GallerySidebarScrollArea } from "./gallery-tag-sidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("updates and clears --gallery-sidebar-max-height without ResizeObserver (#2654)", () => {
  expect(typeof ResizeObserver).toBe("undefined");
  act(() =>
    root.render(
      <main className="gallery-shell">
        <GallerySidebarScrollArea testId="sidebar" ariaLabel="Filters">
          <div>Menu</div>
        </GallerySidebarScrollArea>
      </main>,
    ),
  );
  const shell = container.querySelector<HTMLElement>(".gallery-shell");
  const track = container.querySelector<HTMLElement>(".gallery-sidebar-track");
  const aside = container.querySelector<HTMLElement>('[data-testid="sidebar"]');
  if (!shell || !track || !aside) throw new Error("Sidebar elements missing");

  let trackTop = 168;
  Object.defineProperty(shell, "clientHeight", {
    configurable: true,
    value: 900,
  });
  Object.defineProperty(shell, "clientTop", { configurable: true, value: 0 });
  shell.getBoundingClientRect = () =>
    ({ top: 0, bottom: 900, height: 900 }) as DOMRect;
  track.getBoundingClientRect = () =>
    ({ top: trackTop, bottom: 3000, height: 2832 }) as DOMRect;
  aside.style.position = "sticky";
  aside.style.top = "48px";

  shell.dispatchEvent(new Event("scroll"));
  expect(aside.style.getPropertyValue("--gallery-sidebar-max-height")).toBe(
    "732px",
  );

  trackTop = -120;
  shell.dispatchEvent(new Event("scroll"));
  expect(aside.style.getPropertyValue("--gallery-sidebar-max-height")).toBe(
    "852px",
  );

  // Mobile switches position to static and clears the desktop max-height.
  aside.style.position = "static";
  window.dispatchEvent(new Event("resize"));
  expect(aside.style.getPropertyValue("--gallery-sidebar-max-height")).toBe("");

  // Restoring sticky re-applies the property, and unmount clears it cleanly.
  aside.style.position = "sticky";
  window.dispatchEvent(new Event("resize"));
  expect(aside.style.getPropertyValue("--gallery-sidebar-max-height")).toBe(
    "852px",
  );
  act(() => root.unmount());
  expect(aside.style.getPropertyValue("--gallery-sidebar-max-height")).toBe("");
});
