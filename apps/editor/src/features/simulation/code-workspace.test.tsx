import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimulationCodeWorkspace } from "./code-workspace";

describe("approved simulation Code layout", () => {
  it("opens only circuit/run tabs by default, with output below the editor and configuration on demand", () => {
    const markup = renderToStaticMarkup(
      <SimulationCodeWorkspace
        workspaceKey="s"
        entryPath="run.cir"
        configPath="experiment.json"
        activePath="run.cir"
        files={[
          { path: "circuit.spice", kind: "generated" },
          { path: "run.cir", kind: "authored" },
          { path: "experiment.json", kind: "authored" },
        ]}
        onSelectFile={() => {}}
        actions={<button>Run</button>}
        outputPane="console"
        onSelectOutputPane={() => {}}
        console={<p>Run console</p>}
        results={<p>Plot</p>}
      >
        <div>Source input</div>
      </SimulationCodeWorkspace>,
    );
    expect(markup).toContain("circuit.spice");
    expect(markup).toContain("run.cir");
    expect(markup).not.toContain("experiment.json");
    expect(markup).not.toContain('class="simulation-code-files"');
    expect(markup.indexOf("Source input")).toBeLessThan(
      markup.indexOf("Run console"),
    );
    expect(markup).not.toContain("Settings");
  });
});
