import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "@icm/model";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { NetlistCodePanel } from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("offers independent format, process and compact device mapping controls", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        portCase="upper"
        profiles={createDefaultNetlistExportPreferences().profiles}
        selectedProcess="abstract"
        onProcessChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onFormatChange={vi.fn()}
        onPortCaseChange={vi.fn()}
        onCopy={vi.fn()}
        onApply={vi.fn()}
        onFocusInstance={vi.fn()}
        onReset={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist format"');
    expect(markup).toContain('aria-label="Netlist process"');
    expect(markup).toContain('value="spectre" selected=""');
    expect(markup).toContain('data-testid="copy-netlist-panel"');
    expect(markup).toContain('aria-label="Port names: uppercase"');
    expect(markup).toContain(">ABC</code>");
    expect(markup).toContain('aria-label="Copy netlist"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain(">Copy</button>");
    expect(markup).toContain('aria-label="NMOS netlist target"');
    expect(markup).toContain('aria-label="L netlist target"');
    expect(markup.match(/<select/g)).toHaveLength(7);
    expect(markup).not.toContain("<input");
    expect(markup).toContain(">Default</button>");
    expect(markup).toMatch(
      /aria-label="Netlist output options"[\s\S]*aria-label="Port names: uppercase"[\s\S]*>Default<\/button><\/div>/u,
    );
    expect(markup).toContain('class="netlist-code-viewport"');
    expect(markup).not.toContain("<h2>Netlist</h2>");
  });
});
