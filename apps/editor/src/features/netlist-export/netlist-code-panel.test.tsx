import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "@icm/model";
import { createNetlistExportProfile } from "@icm/netlist";

import { NetlistCodePanel } from "./netlist-code-panel";

describe("live netlist preset selector", () => {
  it("offers each preset in the compact format control", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        profile={createNetlistExportProfile("tsmc28")}
        onProfileChange={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist preset"');
    expect(markup).toContain("Abstract · SCS");
    expect(markup).toContain("SKY130 PDK · SCS");
    expect(markup).toContain('value="tsmc28" selected=""');
    expect(markup).toContain("TSMC 28 · SCS");
    expect(markup).toContain("TSMC 180 · SCS");
    expect(markup).toContain("Custom · SCS");
  });
});
