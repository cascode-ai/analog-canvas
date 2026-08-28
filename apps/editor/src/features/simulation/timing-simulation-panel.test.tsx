import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TimingSimulationPanel } from "./timing-simulation-panel";

describe("TimingSimulationPanel", () => {
  it("starts as a zero-layout collapsed launcher", () => {
    const markup = renderToStaticMarkup(
      <TimingSimulationPanel
        document={createEmptyDocument("main", "Main")}
        onPlaceOnCanvas={() => undefined}
        onStatus={() => undefined}
      />,
    );
    expect(markup).toContain('class="timing-panel collapsed"');
    expect(markup).toContain("Timing");
    expect(markup).not.toContain("Simulation stop time");
  });

  it("exposes saved-node selection, run, export, and optional canvas placement", () => {
    const document = createEmptyDocument("main", "Clock divider");
    document.nets.push({ id: "clock", terminals: [] });
    const markup = renderToStaticMarkup(
      <TimingSimulationPanel
        document={document}
        defaultOpen
        onPlaceOnCanvas={() => undefined}
        onStatus={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="timing-simulation-panel"');
    expect(markup).toContain("Saved nodes (0)");
    expect(markup).toContain("Export SVG");
    expect(markup).toContain("Export PNG");
    expect(markup).toContain("Place on Canvas");
    expect(markup).toContain("Temporary results");
  });
});
