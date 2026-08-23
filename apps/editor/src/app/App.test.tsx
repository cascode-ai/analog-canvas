import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { EditTransactionSchema } from "@icm/edit-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import {
  defaultRazaviSymbolVariantId,
  razaviHiddenBulkRisk,
  razaviMosPresentationEdits,
} from "../presentation/razavi-presentation";
import { createDemoProject } from "../demos/demo-project";
import { createRoutingDemoProject } from "../demos/routing-demo";

describe("editor shell", () => {
  it("uses one canonical Razavi presentation for manually placed MOS", () => {
    expect(defaultRazaviSymbolVariantId("nmos")).toBe("textbook-3terminal");
    expect(defaultRazaviSymbolVariantId("pmos")).toBe("textbook-3terminal");
    expect(defaultRazaviSymbolVariantId("resistor")).toBeUndefined();
  });

  it("fixes every canonical MOS to Razavi three-terminal display", () => {
    const document = createEmptyProject("razavi-migration", "Razavi")
      .documents[0]!;
    document.instances.push(
      {
        id: "Mimplicit",
        symbolId: "nmos",
        placement: null,
      },
      {
        id: "Msupply",
        symbolId: "pmos",
        placement: null,
      },
      {
        id: "MbodyBias",
        symbolId: "nmos",
        placement: null,
      },
    );
    document.nets.push(
      {
        id: "net-vdd",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        terminals: [{ instanceId: "Msupply", pinName: "B" }],
      },
      {
        id: "net-body-bias",
        name: "Vbody",
        scope: "local",
        terminals: [{ instanceId: "MbodyBias", pinName: "B" }],
      },
    );

    expect(razaviMosPresentationEdits(document)).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "Mimplicit",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
      },
      {
        kind: "set_instance_symbol",
        instanceId: "Msupply",
        symbolId: "pmos",
        symbolVariantId: "textbook-3terminal",
      },
      {
        kind: "set_instance_symbol",
        instanceId: "MbodyBias",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
      },
    ]);
    expect(razaviHiddenBulkRisk(document, "Mimplicit")).toBeUndefined();
    expect(razaviHiddenBulkRisk(document, "Msupply")?.id).toBe("net-vdd");
    expect(razaviHiddenBulkRisk(document, "MbodyBias")?.id).toBe(
      "net-body-bias",
    );
  });

  it("renders an empty project without owning model state", () => {
    const project = createEmptyProject("project-smoke", "Smoke Project");
    const markup = renderToStaticMarkup(<App project={project} />);
    expect(markup).toContain("Smoke Project");
    expect(markup).toContain("Schematic canvas");
    expect(markup).toContain("Export SPICE netlist");
    expect(markup).toContain("Export Spectre netlist");
    expect(markup).not.toContain("Cell netlist interface");
    expect(markup).not.toContain("Component reference");
    expect(markup).not.toContain("Component model");
    // Cell navigation is hierarchy navigation, so a flat Project does not
    // carry a row of controls that cannot do anything yet. Manage Cells… stays
    // reachable from Edit.
    expect(markup).not.toContain('data-testid="cell-navigation"');
    expect(markup).toContain('data-testid="edit-manage-cells"');
    expect(markup).not.toContain('data-testid="cell-command-menu"');
    expect(markup).toContain("Manage Cells…");
    expect(markup).toContain("Instance Table…");
    expect(markup).toContain("<summary>Netlist</summary>");
    expect(markup).toContain("Check Report…");
    // "Preflight" named a stage of a netlist pipeline, not the question the
    // person is asking; the toolbar carries the plain action.
    expect(markup).not.toContain("Preflight…");
    expect(markup).toContain('data-testid="check-and-save-button"');
    expect(markup).not.toContain("Edit Cell Interface…");
  });

  it("shows a resolvable imported subcircuit in Cell navigation", () => {
    const project = createEmptyProject("imported-hierarchy", "Imported");
    const topDocument = project.documents[0]!;
    const childDocument = {
      ...topDocument,
      id: "document-child",
      name: "child",
      netlist: { name: "child", terminals: [], formalParameters: [] },
      instances: [],
      nets: [],
      routes: [],
      junctions: [],
      annotations: [],
    };
    topDocument.instances.push({
      id: "X1",
      symbolId: "hierarchical-child",
      placement: null,
      netlist: {
        reference: "X1",
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: childDocument.id,
        },
      },
    });
    project.documents.push(childDocument);

    const markup = renderToStaticMarkup(<App project={project} />);
    expect(markup).toContain('data-testid="cell-navigation"');
    expect(markup).toContain("Enter Cell");
    expect(markup).toContain("Main (top)");
  });

  it("provides one Help entry without rendering its dialog by default", () => {
    const project = createEmptyProject("help-tutorial", "Help Tutorial");
    const markup = renderToStaticMarkup(<App project={project} />);

    expect(markup).toContain('aria-haspopup="dialog"');
    // About folded into Help: one entry, not two saying the same thing.
    expect(markup).not.toContain(">About</button>");
    expect(markup).toContain(">Help</button>");
    expect(markup).toContain('class="app-chrome-actions"');
    const navigationEnd = markup.indexOf("</nav>");
    const analyticsLink = markup.indexOf('href="/analytics"');
    const helpButton = markup.indexOf(">Help</button>");
    expect(analyticsLink).toBeGreaterThan(navigationEnd);
    expect(helpButton).toBeGreaterThan(analyticsLink);
    expect(markup).not.toContain('role="dialog"');
    // The Connect Agent command is available (WP-WA5), but the authorization
    // panel itself must not render until the user opens it.
    expect(markup).toContain("Connect Agent");
    expect(markup).not.toContain('data-testid="connect-agent-panel"');
  });

  it("removes all public Agent controls and accessibility affordances when dormant", () => {
    const project = createEmptyProject("agent-ui-dormant", "Dormant");
    const markup = renderToStaticMarkup(
      <App project={project} publicAgentUiEnabled={false} />,
    );

    expect(markup).not.toContain("<summary>Agent</summary>");
    expect(markup).not.toContain("Connect Agent");
    expect(markup).not.toContain("Manage Agent");
    expect(markup).not.toContain("agent-shelf-indicator");
    expect(markup).not.toContain("Agent:");
    expect(markup).not.toContain("Approve Agent file import");
  });

  it("links to first-party visitor analytics without crowding editor commands", () => {
    const project = createEmptyProject("analytics-entry", "Analytics Entry");
    const markup = renderToStaticMarkup(
      <App project={project} visitStats={{ pv: 42, uv: 17 }} />,
    );

    expect(markup).toContain('href="/analytics"');
    expect(markup).toContain("17 visitors");
    expect(markup).toContain("42 views");
    expect(markup).not.toContain("<summary>Analytics</summary>");
  });

  it("keeps Properties docked with shapes quick-place, not a searchable catalog", () => {
    const project = createEmptyProject("selection-shelf", "Selection Shelf");
    const markup = renderToStaticMarkup(<App project={project} />);

    expect(markup).toContain(
      '<section class="selection-shelf" aria-label="Selection">',
    );
    expect(markup).toContain('data-testid="selection-shelf"');
    expect(markup).toContain('aria-label="Properties"');
    // The panel toggles live in the horizontal toolbar; there is no rail.
    expect(markup).not.toContain('aria-label="Tool rail"');
    expect(markup).toContain('aria-label="Shapes"');
    expect(markup).toContain('data-testid="shapes-chip-resistor"');
    expect(markup).toContain('data-testid="shapes-insert"');
    expect(markup).toContain('data-testid="library-toggle"');
    expect(markup).toContain('data-testid="shapes-library-panel"');
    expect(markup).toContain('data-testid="examples-toggle"');
    expect(markup).not.toContain('data-testid="shapes-fold-examples"');
    expect(markup).not.toContain("Common-Source Amplifier");
    expect(markup).not.toContain("Two-Stage Op Amp");
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain(">Library</span>");
    expect(markup).toContain('class="app-statusbar"');
    expect(markup).toContain("Insert component (I)");
    expect(markup).not.toContain("Symbols &amp; Tools");
    expect(markup).not.toContain("Search components");
    expect(markup).not.toContain("Browse all");
  });

  it("does not create an implicit instance-label selection surface", () => {
    const project = createEmptyProject("implicit-label", "Implicit label");
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 160, y: 160 },
        rotation: 0,
        mirror: "none",
      },
    });

    const markup = renderToStaticMarkup(<App project={project} />);
    expect(markup).not.toContain('data-testid="default-label-hit-M1"');
  });

  it("uses the compact four-unit endpoint hit target", () => {
    const project = createEmptyProject("endpoint-hit", "Endpoint Hit");
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 160, y: 160 },
        rotation: 0,
        mirror: "none",
      },
    });

    const markup = renderToStaticMarkup(<App project={project} />);
    expect(markup).toMatch(/data-testid="terminal-M1-D"[^>]*r="4"/u);
  });

  it("accepts a voltage source and its canonical label in one transaction", () => {
    const result = EditTransactionSchema.safeParse({
      transactionId: "place-voltage-source",
      documentId: "document-main",
      expectedRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "V1",
            symbolId: "voltage-source",
            placement: {
              position: { x: 100, y: 100 },
              rotation: 0,
              mirror: "none",
            },
          },
        },
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "instance-label-V1",
            kind: "instance-label",
            content: { runs: [{ kind: "text", value: "V1" }] },
            anchor: {
              kind: "object",
              objectId: "V1",
              localOffset: { x: 0, y: 48 },
              fallbackPosition: { x: 100, y: 148 },
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("keeps the bundled demo equal to the canonical Project fixture", () => {
    const fixture = readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-1-manual/project.icproj.json",
      ),
      "utf8",
    );
    expect(serializeProject(createDemoProject())).toBe(fixture);
    expect(fixture).not.toMatch(/selection|viewport|dragPreview/u);
  });

  it("keeps the routing demo equal to its canonical Project fixture", () => {
    const fixture = readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    );
    expect(serializeProject(createRoutingDemoProject())).toBe(fixture);
  });
});
