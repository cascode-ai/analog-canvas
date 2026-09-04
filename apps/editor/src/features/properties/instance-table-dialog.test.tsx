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

  it("offers one prefix switch per device that draws a prefixed Reference", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "RG1",
        netlist: { parameters: { value: "1k" } },
      },
      // Drawn with no Reference annotation: nothing to shorten.
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R2",
        netlist: { parameters: { value: "2k" } },
      },
    );
    document.annotations.push({
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: { kind: "free", position: { x: 10, y: 10 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      referencePrefixHidden: true,
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

    expect(markup).toContain("<th>Reference</th>");
    expect(markup).toContain(">Prefix</th>");
    // R1 hides its prefix, so its switch is cleared; R2 has no drawn
    // Reference at all, so it has no switch.
    expect(markup).toContain('aria-label="Show the R prefix on RG1"');
    expect(markup).not.toContain('aria-label="Show the R prefix on R2"');
    expect(
      /aria-label="Show the R prefix on RG1"[^>]*checked/u.test(markup),
    ).toBe(false);
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
