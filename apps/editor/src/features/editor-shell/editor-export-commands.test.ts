import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEmptyProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  describeExportFailure,
  planDesignNetlistExport,
  planRnlNetlistExport,
} from "./editor-export-commands";
import { importChunk } from "../../components/chunk-import";
import { hierarchyParameterFixture } from "../../../../../netlists/hierarchy-parameters/fixture";

describe("editor export commands", () => {
  it("exports a chosen Cell without changing the default Top or including unrelated errors", () => {
    const project = hierarchyParameterFixture();
    const topId = project.topDocumentId;
    project.documents[0]!.netlist = undefined;
    const before = structuredClone(project);
    expect(planDesignNetlistExport({ project, format: "spice" }).status).toBe(
      "blocked",
    );
    const selected = planDesignNetlistExport({
      project,
      format: "spice",
      rootDocumentId: "resistors",
    });
    expect(selected.status).toBe("ready");
    if (selected.status === "ready")
      expect(String(selected.artifact.bytes)).toContain(".subckt Resistors");
    expect(project).toEqual(before);
    expect(project.topDocumentId).toBe(topId);
  });

  it.each(["spice", "spectre"] as const)(
    "preserves authored mixed-case port names in %s",
    (format) => {
      const project = hierarchyParameterFixture();
      const port = project.documents[0]!.netlist!.terminals.find(
        (terminal) => terminal.name === "A",
      )!;
      port.name = "Vb1";
      const plan = planDesignNetlistExport({ project, format });
      expect(plan.status).toBe("ready");
      if (plan.status !== "ready") return;
      expect(String(plan.artifact.bytes)).toContain("Vb1");
      expect(String(plan.artifact.bytes)).not.toContain("VB1");
    },
  );
  it("blocks a netlist whose drawing has a dead-end node", () => {
    // A TODO placeholder is a value somebody will bind later; a node only one
    // pin reaches is a wire nobody drew, and the message names it so the
    // author can go to it.
    const project = createEmptyProject("project", "Circuit");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push(
      { id: "net-a", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "net-b", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    const plan = planDesignNetlistExport({ format: "spice", project });
    expect(plan.status).toBe("blocked");
    if (plan.status !== "blocked") return;
    expect(plan.message).toContain("2 dead-end nodes");
    expect(plan.message).toContain("only R1.1 reaches it");
  });

  it.each(["spice", "spectre"] as const)(
    "prepares clean %s with findings only in the status",
    (format) => {
      const project = createEmptyProject("project", "Circuit");
      const plan = planDesignNetlistExport({
        format,
        project,
        electricalWarningsPresent: true,
      });
      expect(plan.status).toBe("ready");
      if (plan.status !== "ready") return;
      expect(plan.artifact.bytes).not.toContain(
        `${format === "spice" ? "*" : "//"} Electrical findings remain; see Netlist > Check Report.`,
      );
      expect(plan.artifact.report).toContain("see Check Report for findings");
    },
  );

  it("prepares a complete printable artifact without a confirmation step", () => {
    const project = createEmptyProject("project", "My Circuit");
    const plan = planDesignNetlistExport({ format: "spice", project });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.artifact.extension).toBe("spi");
    expect(plan.artifact.mediaType).toBe("application/x-spice");
    expect(plan.artifact.report).toBe("SPICE netlist copied");
  });
});

describe("RNL netlist export", () => {
  const rc = () =>
    parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../examples/simulation-rc.icproj.json",
        ),
        "utf8",
      ),
    );
  const runtime = (
    text: string,
    diagnostics: { severity: string; message: string }[] = [],
  ) => ({
    write: vi.fn(async () => ({ text, document: { diagnostics } })),
  });

  it("copies what the rnl runtime writes, named for its mode", async () => {
    const written = runtime("// written");
    const plan = await planRnlNetlistExport({
      format: "spectre",
      project: rc(),
      runtime: written,
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.artifact.bytes).toBe("// written");
    expect(plan.artifact.extension).toBe("scs");
    expect(plan.artifact.report).toMatch(/^Spectre\+RNL netlist copied/u);
    expect(written.write).toHaveBeenCalledTimes(1);
  });

  it("blocks without the rnl runtime", async () => {
    const plan = await planRnlNetlistExport({
      format: "spice",
      project: rc(),
      runtime: null,
    });
    expect(plan).toEqual({
      status: "blocked",
      message: "RNL formats need the rnl runtime, which this build lacks",
    });
  });

  it("blocks on an RNL error before asking the runtime", async () => {
    const project = rc();
    project.documents[0]!.instances.find(
      (instance) => instance.placement,
    )!.placement!.rotation = 45;
    const written = runtime("unused");
    const plan = await planRnlNetlistExport({
      format: "spice",
      project,
      runtime: written,
    });
    expect(plan.status).toBe("blocked");
    if (plan.status === "blocked")
      expect(plan.message).toContain("quarter turns");
    expect(written.write).not.toHaveBeenCalled();
  });

  it("blocks when the written file has an error", async () => {
    const plan = await planRnlNetlistExport({
      format: "spice",
      project: rc(),
      runtime: runtime("bad", [{ severity: "error", message: "no symbol" }]),
    });
    expect(plan).toEqual({ status: "blocked", message: "RNL: no symbol" });
  });
});

describe("describeExportFailure", () => {
  it("turns a vanished chunk into the refresh remedy and names the feature", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const chunkError = await importChunk("PDF export", () =>
      Promise.reject(
        new TypeError(
          "Failed to fetch dynamically imported module: https://analog-canvas.tokenzhang.com/assets/browser-pdf-D-HT6q.js",
        ),
      ),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    spy.mockRestore();

    const failure = describeExportFailure(chunkError);
    expect(failure.chunkFeature).toBe("PDF export");
    expect(failure.status).toContain("PDF export could not load");
    expect(failure.status).toContain("Refresh");
    expect(failure.status).not.toContain("Failed to fetch");
  });

  it("keeps an ordinary export error's own message without a banner", () => {
    expect(describeExportFailure(new Error("Canvas too large"))).toEqual({
      status: "Canvas too large",
    });
    expect(describeExportFailure("boom")).toEqual({ status: "Export failed" });
  });
});
