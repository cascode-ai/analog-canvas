import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a CSS property on an element at the actual chrome's bottom plus
 * `gap` pixels, wrapped toolbar and project tabs included, while `active`:
 * a fixed overlay set by it stands under the chrome at any width instead of
 * under it on a phone, where the tabs took its clicks (#2182, #2194).
 */
export function useBelowChrome(
  ref: RefObject<HTMLElement | null>,
  property: string,
  { gap = 8, active = true }: { gap?: number; active?: boolean } = {},
): void {
  useLayoutEffect(() => {
    const chrome = document.querySelector(".app-chrome");
    if (!active || !chrome) return;
    const update = () =>
      ref.current?.style.setProperty(
        property,
        `${chrome.getBoundingClientRect().bottom + gap}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(chrome);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, property, gap, active]);
}
