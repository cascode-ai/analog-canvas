import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TimingSimulationPanel } from "./timing-simulation-panel";

describe("TimingSimulationPanel", () => {
  const callbacks = {
    onOpenChange: () => undefined,
    onPickNetsChange: () => undefined,
    onToggleSavedNet: () => undefined,
    onSetSavedNets: () => undefined,
    onPlaceOnCanvas: () => undefined,
    onStatus: () => undefined,
  };

  it("renders nothing while the toolbar-owned window is closed", () => {
    const markup = renderToStaticMarkup(
      <TimingSimulationPanel
        document={createEmptyDocument("main", "Main")}
        open={false}
        savedNetIds={new Set()}
        pickNetsActive={false}
        {...callbacks}
      />,
    );
    expect(markup).toBe("");
  });

  it("keeps setup, saved Nets, waveforms, export, and placement in one flat window", () => {
    const document = createEmptyDocument("main", "Clock divider");
    document.nets.push({ id: "clock", terminals: [] });
    const markup = renderToStaticMarkup(
      <TimingSimulationPanel
        document={document}
        open
        savedNetIds={new Set(["clock"])}
        pickNetsActive={false}
        {...callbacks}
      />,
    );

    expect(markup).toContain('data-testid="timing-simulation-panel"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Digital Simulation");
    expect(markup).toContain("Saved Nets");
    expect(markup).toContain("Pick Nets");
    expect(markup).toContain("Run Simulation");
    expect(markup).toContain("Export SVG");
    expect(markup).toContain("Export PNG");
    expect(markup).toContain("Place on Canvas");
    expect(markup).toContain("Temporary results");
    expect(markup).not.toContain("<details");
  });
});
