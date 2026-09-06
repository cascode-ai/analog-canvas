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
    expect(markup).toContain('<aside class="simulation-saved-nets"');
    expect(markup).toContain('class="simulation-saved-net-list" role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('aria-label="Edit waveform name for clock"');
    expect(markup).toContain(">clock</span>");
    expect(markup).toContain("Names below only affect waveform labels.");
    expect(markup).toContain("Pick Nets");
    expect(markup).toContain("Run Simulation");
    expect(markup).toContain("Export SVG");
    expect(markup).toContain("Export PNG");
    expect(markup).toContain("Place on Canvas");
    expect(markup).toContain("Temporary results");
    expect(markup).not.toContain("<details");
  });

  it("offers repeated Ground Base Nets once and resolves an old member selection", () => {
    const document = createEmptyDocument("main", "Ground choices");
    document.nets.push(
      { id: "net-ground-a", terminals: [] },
      { id: "net-ground-b", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "ground-a",
        kind: "name-claim",
        netId: "net-ground-a",
        owner: { kind: "power-marker", objectId: "GND1" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
      {
        id: "ground-b",
        kind: "name-claim",
        netId: "net-ground-b",
        owner: { kind: "power-marker", objectId: "GND2" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
    );

    const markup = renderToStaticMarkup(
      <TimingSimulationPanel
        document={document}
        open
        savedNetIds={new Set(["net-ground-b"])}
        pickNetsActive={false}
        {...callbacks}
      />,
    );

    expect(markup).not.toContain('<option value="net-ground-b"');
    expect(markup.match(/<strong>0<\/strong>/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Remove saved Net 0"');
  });
});
