import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorRightDock } from "./editor-right-dock";

describe("independent Simulation workspace", () => {
  it("retains hidden Code and exposes a restore rail when minimized", () => {
    const html = renderToStaticMarkup(
      <EditorRightDock
        simulationOpen={false}
        simulationOpened
        maximized={false}
        onRestoreSimulation={() => {}}
        code={<p>draft</p>}
        properties={<p>properties</p>}
      />,
    );
    expect(html).toContain("Restore Sim Code");
    expect(html).toContain("draft");
    expect(html).toContain('class="editor-simulation-content" hidden=""');
  });
});
