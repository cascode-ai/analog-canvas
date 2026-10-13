import { useEffect, type RefObject } from "react";

/**
 * Whether an event closes an open `<details>` menu: a press outside it, or
 * Escape anywhere. A press inside, its own summary too, leaves it alone.
 */
export function closesDetails(
  details: Pick<HTMLDetailsElement, "open" | "contains">,
  event: { type: string; key?: string; target: EventTarget | null },
): boolean {
  if (!details.open) return false;
  if (event.type === "keydown") return event.key === "Escape";
  return !details.contains(event.target as Node | null);
}

/** A `<details>` menu closes on a press outside it or on Escape. */
export function useDismissDetails(
  ref: RefObject<HTMLDetailsElement | null>,
): void {
  useEffect(() => {
    const dismiss = (event: Event) => {
      const details = ref.current;
      if (details && closesDetails(details, event as KeyboardEvent))
        details.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [ref]);
}
