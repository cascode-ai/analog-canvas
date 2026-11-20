import { describe, expect, it } from "vitest";
import { importSpiceSources } from "@icm/spice";

import { analyzeDesignNetlist } from "./extract.js";

/** An imported part naming a model its sources do not define (#2294). */
async function imported(modelTypes?: Record<string, string>) {
  const result = await importSpiceSources(
    [
      {
        path: "top.sp",
        bytes: new TextEncoder().encode(
          "* pdk\n.subckt top d g s b\nM1 d g s b nch_mac w=1u l=30n\n.ends top\n",
        ),
      },
    ],
    "top.sp",
    {},
    modelTypes ? { modelTypes: new Map(Object.entries(modelTypes)) } : {},
  );
  if (!result.project) throw new Error("import failed");
  return result.project;
}

const finding = (
  project: Awaited<ReturnType<typeof imported>>,
  code: string,
  deckSources?: string[],
) =>
  analyzeDesignNetlist(
    project,
    deckSources ? { deckSources } : {},
  ).diagnostics.find((item) => item.code === code);

describe("imported models without cards", () => {
  it.each([
    ["typed by the caller", { nch_mac: "nmos" }],
    ["of unknown type", undefined],
  ])(
    "hands out a part %s with its reference and where it is, carrying no card",
    async (_name, types) => {
      const project = await imported(types);
      expect(finding(project, "IMPORTED_MODEL_EXTERNAL")).toMatchObject({
        severity: "info",
        message: expect.stringContaining("M1 (top.sp:3) names nch_mac"),
      });
      expect(
        (analyzeDesignNetlist(project).ir?.cells ?? []).flatMap(
          (cell) => cell.models ?? [],
        ),
      ).toEqual([]);
    },
  );

  it("refuses a run that defines none, warns where the run includes a library it cannot read, and is silent where it defines the model", async () => {
    const project = await imported({ nch_mac: "nmos" });
    expect(finding(project, "IMPORTED_MODEL_MISSING", [])).toMatchObject({
      severity: "error",
      message: expect.stringContaining("M1 (top.sp:3) names nch_mac"),
    });
    expect(
      finding(project, "IMPORTED_MODEL_MISSING", ['.lib "pdk.lib" tt\n']),
    ).toMatchObject({ severity: "warning" });
    // A library's own section header includes nothing.
    expect(
      finding(project, "IMPORTED_MODEL_MISSING", [".lib tt\n.endl tt\n"]),
    ).toMatchObject({ severity: "error" });
    expect(
      finding(project, "IMPORTED_MODEL_MISSING", [".model nch_mac nmos\n"]),
    ).toBeUndefined();
  });
});
