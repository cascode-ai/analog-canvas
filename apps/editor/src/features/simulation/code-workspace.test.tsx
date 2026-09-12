import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimulationCodeWorkspace } from "./code-workspace";
import { WorkspaceInteractions } from "./workspace-interactions";

describe("approved simulation Code layout", () => {
  it("presents experiments and source beside code without a Setup selector", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceInteractions>
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
        </SimulationCodeWorkspace>
      </WorkspaceInteractions>,
    );
    expect(markup).toContain("OTA AC");
    expect(markup).toContain("OTA transient");
    expect(markup).toContain('data-workspace-new-folder="true"');
    expect(markup).toContain("+ New experiment");
    expect(markup).toContain("Source");
    expect(markup).toContain("Run target");
    expect(markup).not.toContain("New file");
    expect(markup).not.toContain("Setup");
  });
  it("opens only circuit/run tabs by default, with output below the editor and configuration on demand", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceInteractions>
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
        </SimulationCodeWorkspace>
      </WorkspaceInteractions>,
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
    expect(markup).not.toContain(">Files</button>");
    expect(markup).not.toContain(">Results</button>");
    expect(markup).toContain('aria-label="Close run.cir"');
  });
  it("defaults Source open and temporary Prepare/Run files closed in Explorer", () => {
    const artifact = {
      id: "artifact-1",
      name: "prepared.cir",
      mediaType: "text/plain",
      byteLength: 12,
      sha256: "0".repeat(64),
    };
    const markup = renderToStaticMarkup(
      <WorkspaceInteractions>
        <SimulationCodeWorkspace
          workspaceKey="a"
          entryPath="run.cir"
          configPath="experiment.json"
          activePath="run.cir"
          files={[{ path: "run.cir", kind: "authored" }]}
          artifactGroups={[
            {
              key: "prepare",
              label: "Prepare",
              description: "Compiled input",
              artifacts: [artifact],
            },
          ]}
          onSelectFile={() => {}}
          folders={{
            folders: [{ id: "a", name: "Untitled" }],
            activeId: "a",
            onSelect: () => {},
            onAction: () => {},
          }}
          actions={null}
          console={null}
          results={null}
          outputPane="console"
          onSelectOutputPane={() => {}}
        >
          Code
        </SimulationCodeWorkspace>
      </WorkspaceInteractions>,
    );
    expect(markup).toMatch(
      /class="simulation-explorer-section is-source" open=""/,
    );
    expect(markup).toContain(
      'class="simulation-explorer-section is-temporary" aria-label="Prepare temporary files"',
    );
    expect(markup).toContain("Temporary");
    expect(markup).toContain("prepared.cir");
    expect(markup).toContain('aria-label="Download selected files"');
  });
});
