import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseProject } from "@icm/project-protocol";
import { createRnlExport } from "@icm/rnl";

import { netlistMode, netlistModeParts } from "./netlist-mode";
import { rnlFindings, writeRnlExport } from "./rnl-netlist-view";
import type { RnlRuntime } from "./rnl-runtime";

const rc = () =>
  parseProject(
    readFileSync(
      resolve(import.meta.dirname, "../../examples/simulation-rc.icproj.json"),
      "utf8",
    ),
  );

describe("netlist modes", () => {
  it("splits each mode into its dialect and the RNL flag, and back", () => {
    for (const mode of [
      "spice",
      "spectre",
      "spice+rnl",
      "spectre+rnl",
    ] as const) {
      const { format, rnl } = netlistModeParts(mode);
      expect(netlistMode(format, rnl)).toBe(mode);
    }
    expect(netlistModeParts("spectre+rnl")).toEqual({
      format: "spectre",
      rnl: true,
    });
  });
});

describe("writing the RNL netlist", () => {
  it("hands the runtime the export's request and shows its text", async () => {
    const exported = createRnlExport(rc(), { format: "spice" });
    if (exported.status !== "ready") throw new Error("not ready");
    const write = vi.fn<RnlRuntime["write"]>(async () => ({
      text: "written",
      document: { diagnostics: [] },
    }));
    const state = await writeRnlExport(exported, { write });
    expect(write).toHaveBeenCalledWith({
      write: exported.request,
      svg: false,
      primitives: false,
    });
    expect(state).toEqual({
      status: "written",
      written: { text: "written", document: { diagnostics: [] } },
    });
  });

  it("says there is no runtime, or why it refused, instead of writing", async () => {
    const exported = createRnlExport(rc(), { format: "spice" });
    if (exported.status !== "ready") throw new Error("not ready");
    expect(await writeRnlExport(exported, null)).toEqual({
      status: "no-runtime",
    });
    expect(
      await writeRnlExport(exported, {
        write: () => Promise.reject(new Error("op 3: no such level")),
      }),
    ).toEqual({ status: "failed", message: "op 3: no such level" });
  });

  it("lists the runtime's errors first, then what RNL could not say", () => {
    const exported = createRnlExport(rc(), { format: "spice" });
    if (exported.status !== "ready") throw new Error("not ready");
    const findings = rnlFindings(exported, {
      status: "written",
      written: {
        text: "",
        document: {
          diagnostics: [
            { severity: "warning", message: "runtime warning" },
            { severity: "hint", message: "a hint" },
            { severity: "error", message: "runtime error" },
          ],
        },
      },
    });
    expect(findings[0]).toEqual({
      severity: "error",
      message: "runtime error",
    });
    expect(findings.at(-1)).toEqual({
      severity: "warning",
      message: "runtime warning",
    });
    expect(findings.map((item) => item.message)).not.toContain("a hint");
  });
});
