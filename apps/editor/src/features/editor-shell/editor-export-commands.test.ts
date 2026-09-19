import { createEmptyProject } from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import {
  describeExportFailure,
  planDesignNetlistExport,
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
  it("blocks structurally incomplete extraction", () => {
    const project = createEmptyProject("project", "Circuit");
    project.documents[0]!.netlist = undefined;
    expect(planDesignNetlistExport({ format: "spice", project })).toEqual({
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    });
  });

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
