import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "@icm/model";
import { createNetlistExportProfile } from "@icm/netlist";

import {
  NetlistCodePanel,
  netlistEditorVisibleLines,
} from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("keeps process and format independently selectable", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        portCase="upper"
        profile={createNetlistExportProfile("tsmc28")}
        onProfileChange={vi.fn()}
        onFormatChange={vi.fn()}
        onPortCaseChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onCopy={vi.fn()}
        onReset={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist process"');
    expect(markup).toContain('aria-label="Netlist format"');
    expect(markup.indexOf("Netlist format")).toBeLessThan(
      markup.indexOf("Netlist process"),
    );
    expect(markup).toContain(">Abstract<");
    expect(markup).toContain(">SKY130 PDK<");
    expect(markup).toContain('value="tsmc28" selected=""');
    expect(markup).toContain(">TSMC 28<");
    expect(markup).toContain(">TSMC 180<");
    expect(markup).toContain(">Custom<");
    expect(markup).toContain('value="spectre" selected=""');
    expect(markup).toContain('data-testid="copy-netlist-panel"');
    expect(markup).toContain('aria-label="Port names: uppercase"');
    expect(markup).toContain(">ABC</code>");
    expect(markup).toContain('aria-label="Copy netlist"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain(">Copy</button>");
    expect(markup).toContain('aria-label="NMOS netlist target"');
    expect(markup).toContain('value="nch_ulvt_mac"');
    expect(markup).toContain('value="nch_lvt_mac"');
    expect(markup).toContain('aria-label="PMOS netlist target"');
    expect(markup).toContain('value="pch_ulvt_mac"');
    expect(markup).toContain('value="pch_lvt_mac"');
    expect(markup).toContain('aria-label="R netlist target"');
    expect(markup).toContain('aria-label="C netlist target"');
    expect(markup).toContain('aria-label="L netlist target"');
    expect(markup.match(/<select/g)).toHaveLength(7);
    expect(markup).not.toContain("<input");
    expect(markup).toContain(">Default</button>");
    expect(markup).toMatch(
      /aria-label="Netlist device mapping"[\s\S]*aria-label="NMOS netlist target"[\s\S]*aria-label="PMOS netlist target"[\s\S]*aria-label="R netlist target"[\s\S]*aria-label="C netlist target"[\s\S]*aria-label="L netlist target"[\s\S]*>Default<\/button><\/div>/u,
    );
    expect(markup).toContain('class="netlist-code-viewport"');
    expect(markup).toContain('data-visible-lines="10"');
    expect(markup).not.toContain("<h2>Netlist</h2>");
  });

  it("sizes the code viewport from ten through twenty visible lines", () => {
    expect(netlistEditorVisibleLines("")).toBe(10);
    expect(netlistEditorVisibleLines(Array(15).fill("line").join("\n"))).toBe(
      15,
    );
    expect(netlistEditorVisibleLines(Array(21).fill("line").join("\n"))).toBe(
      20,
    );
  });
});
