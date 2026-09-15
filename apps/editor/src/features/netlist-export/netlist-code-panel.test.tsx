import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "@icm/model";
import { createNetlistExportProfile } from "@icm/netlist";

import { NetlistCodePanel } from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("keeps process and format independently selectable", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        profile={createNetlistExportProfile("tsmc28")}
        onProfileChange={vi.fn()}
        onFormatChange={vi.fn()}
        onCopy={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist process"');
    expect(markup).toContain('aria-label="Netlist format"');
    expect(markup).toContain(">Abstract<");
    expect(markup).toContain(">SKY130 PDK<");
    expect(markup).toContain('value="tsmc28" selected=""');
    expect(markup).toContain(">TSMC 28<");
    expect(markup).toContain(">TSMC 180<");
    expect(markup).toContain(">Custom<");
    expect(markup).toContain('value="spectre" selected=""');
    expect(markup).toContain('data-testid="copy-netlist-panel"');
  });
});
