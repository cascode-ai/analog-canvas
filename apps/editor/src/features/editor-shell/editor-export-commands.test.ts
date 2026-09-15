import { createEmptyProject } from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import {
  describeExportFailure,
  planDesignNetlistExport,
} from "./editor-export-commands";
import { importChunk } from "../../components/chunk-import";

describe("editor export commands", () => {
  it("blocks structurally incomplete extraction", () => {
    const project = createEmptyProject("project", "Circuit");
    project.documents[0]!.netlist = undefined;
    expect(planDesignNetlistExport({ format: "spice", project })).toEqual({
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    });
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
