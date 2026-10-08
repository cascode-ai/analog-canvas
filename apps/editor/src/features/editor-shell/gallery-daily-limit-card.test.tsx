import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GalleryDailyLimitCard } from "./gallery-daily-limit-card";

const limit = { limit: 100, resetAt: "2026-10-09T00:00:00.000Z" };

/** Every element in a rendered tree, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function click(modifiers: Partial<MouseEvent> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
    preventDefault: vi.fn(),
  };
}

describe("Gallery daily-limit card", () => {
  it("says the day's circuits are used and when more open, without trapping the canvas", () => {
    const markup = renderToStaticMarkup(
      <GalleryDailyLimitCard
        limit={limit}
        onBackToGallery={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain("You’ve opened 100 Gallery circuits today");
    expect(markup).toMatch(/You can open more after [^<]*\d:\d\d[^<]*\./u);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('href="/"');
  });

  it("leaves through the editor's own guard on a plain click and closes on Close", () => {
    const onBackToGallery = vi.fn();
    const onClose = vi.fn();
    const tree = elements(
      GalleryDailyLimitCard({ limit, onBackToGallery, onClose }),
    );
    const back = tree.find((element) => element.type === "a")!;
    const close = tree.find((element) => element.type === "button")!;
    const onBack = back.props.onClick as (event: unknown) => void;

    const modified = click({ metaKey: true });
    onBack(modified);
    expect(modified.preventDefault).not.toHaveBeenCalled();
    expect(onBackToGallery).not.toHaveBeenCalled();

    const plain = click();
    onBack(plain);
    expect(plain.preventDefault).toHaveBeenCalled();
    expect(onBackToGallery).toHaveBeenCalledTimes(1);

    (close.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
