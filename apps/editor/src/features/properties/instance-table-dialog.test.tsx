import { createEmptyProject } from "@icm/model";
import { buildProjectConnectivityIndex } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstanceTableDialog } from "./instance-table-dialog";

describe("InstanceTableDialog", () => {
  it("keeps project review and batch edits in an explicit separate dialog", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
      netlist: { parameters: { l: "60n" } },
    });

    const markup = renderToStaticMarkup(
      <InstanceTableDialog
        open
        project={project}
        connectivityIndex={buildProjectConnectivityIndex(
          project,
          new InMemorySymbolResolver(builtInSymbols),
        )}
        activeDocumentId={project.topDocumentId}
        onClose={() => undefined}
        onOpenInstance={() => undefined}
        onApply={() => true}
      />,
    );

    expect(markup).toContain('aria-labelledby="instance-table-title"');
    expect(markup).toContain("Active Cell");
    expect(markup).toContain("Project");
    expect(markup).toContain(">M1</button>");
    expect(markup).toContain('aria-label="Batch field"');
    expect(markup).toContain("Apply to 0");
  });

  it("does not render when closed", () => {
    const project = createEmptyProject("project", "Project");
    expect(
      renderToStaticMarkup(
        <InstanceTableDialog
          open={false}
          project={project}
          connectivityIndex={buildProjectConnectivityIndex(
            project,
            new InMemorySymbolResolver(builtInSymbols),
          )}
          activeDocumentId={project.topDocumentId}
          onClose={() => undefined}
          onOpenInstance={() => undefined}
          onApply={() => true}
        />,
      ),
    ).toBe("");
  });
});
