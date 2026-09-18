import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "@icm/model";
import {
  NetlistCodePanel,
  netlistEditorVisibleLines,
} from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("offers output choices without an electrical process remap", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        portCase="upper"
        onFormatChange={vi.fn()}
        onPortCaseChange={vi.fn()}
        onCopy={vi.fn()}
        onReset={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist format"');
    expect(markup).not.toContain('aria-label="Netlist process"');
    expect(markup).toContain('value="spectre" selected=""');
    expect(markup).toContain('data-testid="copy-netlist-panel"');
    expect(markup).toContain('aria-label="Port names: uppercase"');
    expect(markup).toContain(">ABC</code>");
    expect(markup).toContain('aria-label="Copy netlist"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain(">Copy</button>");
    expect(markup).not.toContain("netlist target");
    expect(markup.match(/<select/g)).toHaveLength(1);
    expect(markup).not.toContain("<input");
    expect(markup).toContain(">Default</button>");
    expect(markup).toMatch(
      /aria-label="Netlist output options"[\s\S]*aria-label="Port names: uppercase"[\s\S]*>Default<\/button><\/div>/u,
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
