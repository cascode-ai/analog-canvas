import type { DesignNetlistIR } from "@icm/netlist";
import { describe, expect, it, vi } from "vitest";

import {
  describeExportFailure,
  planDesignNetlistExport,
} from "./editor-export-commands";
import { importChunk } from "../../components/chunk-import";

const emptyIr: DesignNetlistIR = {
  topCellId: "top",
  cells: [],
  externalMasters: [],
  globals: [],
};

describe("editor export commands", () => {
  it("blocks design netlist export until findings are resolved", () => {
    expect(
      planDesignNetlistExport({
        format: "spice",
        ir: null,
        warningsPresent: false,
        warningsReviewed: false,
        projectName: "Circuit",
      }),
    ).toEqual({
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    });
  });

  it("requires explicit review when warnings remain", () => {
    expect(
      planDesignNetlistExport({
        format: "spectre",
        ir: emptyIr,
        warningsPresent: true,
        warningsReviewed: false,
        projectName: "Circuit",
      }),
    ).toEqual({
      status: "blocked",
      message: "Review the Check Report warnings before export",
    });
  });

  it("prepares a printable artifact after warning review", () => {
    const plan = planDesignNetlistExport({
      format: "spice",
      ir: emptyIr,
      warningsPresent: true,
      warningsReviewed: true,
      projectName: "My Circuit",
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.artifact.extension).toBe("spi");
    expect(plan.artifact.mediaType).toBe("application/x-spice");
    expect(plan.artifact.report).toBe("Download requested: my-circuit.spi");
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
