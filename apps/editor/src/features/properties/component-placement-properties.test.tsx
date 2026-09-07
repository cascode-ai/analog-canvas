import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentPlacementProperties } from "./component-placement-properties";

describe("component placement properties", () => {
  it("renders placement transforms, amplifier actions, and discard state", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "A1",
      symbolId: "diff-amp",
      placement: {
        position: { x: 10, y: 20 },
        rotation: 0,
        mirror: "none",
      },
    };
    const markup = renderToStaticMarkup(
      <ComponentPlacementProperties
        instance={instance}
        x="10"
        y="20"
        rotation="0"
        draftChanged
        onXChange={vi.fn()}
        onYChange={vi.fn()}
        onRotate={vi.fn()}
        onMirror={vi.fn()}
        onReturnToTray={vi.fn()}
        onSwapOutputs={vi.fn()}
        onSwapInputs={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(markup).toMatch(
      /<details[^>]*aria-label="Component placement"[^>]*open=""/u,
    );
    expect(markup).toContain('aria-label="Component geometry"');
    expect(markup).toContain("Swap + / − outputs");
    expect(markup).toContain("Discard changes");
  });
});
