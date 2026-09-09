import { createEmptyProject } from "@icm/model";
import type { Capabilities } from "@icm/simulation-service/contract";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationSweepDialog } from "./simulation-sweep-dialog";

describe("SimulationSweepDialog", () => {
  it("offers run-only corner, temperature, and existing parameter axes", () => {
    const project = createEmptyProject("sweep-project", "Sweep");
    const document = project.documents[0]!;
    document.instances.push({
      id: "m1",
      symbolId: "nmos-3t",
      reference: "M1",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "mos" },
        parameters: { w: "1u", l: "0.15u" },
      },
    });
    const setup = {
      id: "setup-ac",
      name: "AC response",
      version: 2 as const,
      input: {
        kind: "structured" as const,
        rootDocumentId: document.id,
        analyses: [
          {
            kind: "ac" as const,
            sweep: "dec" as const,
            points: 10,
            startHz: 1,
            stopHz: 1e6,
          },
        ],
        outputs: [],
        environment: { profileId: "sky130" },
      },
    };
    project.simulationSetups.push(setup);
    const capabilities: Capabilities = {
      configured: true,
      inputs: ["structured"],
      analyses: ["ac"],
      parsedAnalyses: ["ac"],
      profiles: [{ id: "sky130", corners: ["TT", "FF", "SS"] }],
      maxTimeoutMs: 120000,
      maxInputBytes: 1_048_576,
      cancel: true,
      batch: {
        maxItems: 16,
        execution: "sequential",
        sweepAxes: ["corner", "temperature", "parameter"],
      },
    };

    const markup = renderToStaticMarkup(
      <SimulationSweepDialog
        open
        project={project}
        setup={setup}
        capabilities={capabilities}
        onClose={() => undefined}
        onRun={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Sweep · AC response");
    expect(markup).toContain('aria-label="Sweep corner FF"');
    expect(markup).toContain('aria-label="Sweep temperatures"');
    expect(markup).toContain('aria-label="Sweep instance parameter"');
    expect(markup).toContain("Main · M1 · w");
    expect(markup).toContain("Run-only variants");
  });
});
