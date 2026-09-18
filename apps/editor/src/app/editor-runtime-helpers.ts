export function dismissOpenCommandMenus(): boolean {
  const openMenus = Array.from(
    globalThis.document.querySelectorAll<HTMLDetailsElement>(
      ".command-menu[open]",
    ),
  );
  for (const menu of openMenus) {
    menu.open = false;
  }
  return openMenus.length > 0;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export function compactLayoutMatches(mediaQuery: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(mediaQuery).matches
  );
}

/** DEV-only render probe for the root error-boundary browser tests. */
export function RenderCrashProbe(): never {
  throw new Error("render crashed (test hook)");
}
