import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PlacementTrayPanel } from "./placement-tray-panel";

describe("placement tray panel", () => {
  it("keeps retained instances available behind a collapsed count summary", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
    };
    const markup = renderToStaticMarkup(
      <PlacementTrayPanel
        document={document}
        unplaced={[instance]}
        returnablePlaced={[]}
        onPlaceAll={vi.fn()}
        onReturnAll={vi.fn()}
        onSelect={vi.fn()}
        onPlace={vi.fn()}
      />,
    );

    const tray = markup.match(
      /<details[^>]*aria-label="Placement Tray"[^>]*>/u,
    )?.[0];
    expect(tray).toBeDefined();
    expect(tray).toContain('role="region"');
    expect(tray).not.toContain('open=""');
    expect(markup).toContain('aria-label="1 retained Instance"');
    expect(markup).toContain("R1 · resistor");
  });
});
