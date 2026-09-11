import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimulationCodeWorkspace } from "./code-workspace";

describe("approved simulation Code layout", () => {
  it("presents execution folders beside code without a Setup selector", () => {
    const markup = renderToStaticMarkup(
      <SimulationCodeWorkspace
        workspaceKey="a"
        entryPath="run.cir"
        configPath="experiment.json"
        activePath="run.cir"
        files={[{ path: "run.cir", kind: "authored" }]}
        onSelectFile={() => {}}
        folders={{
          folders: [
            { id: "a", name: "OTA AC" },
            { id: "b", name: "OTA transient" },
          ],
          activeId: "a",
          onSelect: () => {},
          onAction: () => {},
        }}
        actions={<button>Run</button>}
        console={null}
        results={null}
        outputPane="console"
        onSelectOutputPane={() => {}}
      >
        <div>Code</div>
      </SimulationCodeWorkspace>,
    );
    expect(markup).toContain("OTA AC");
    expect(markup).toContain("OTA transient");
    expect(markup).not.toContain("New folder");
    expect(markup).not.toContain("New file");
    expect(markup).not.toContain("Setup");
  });
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
    expect(markup).toContain(">Compare</button>");
    expect(markup).toContain(">OP</button>");
    expect(markup).not.toContain(">Results</button>");
  });
});
