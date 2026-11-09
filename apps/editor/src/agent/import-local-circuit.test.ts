import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importLocalCircuit } from "./import-local-circuit";

const input = (path: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return {
    path,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

// A netlist as Virtuoso writes it: the foundry's models come from an absolute
// library the delivery never carries.
const virtuoso = input(
  "top.scs",
  [
    "// Virtuoso export",
    "simulator lang=spectre",
    'include "/pdk/tsmc28/models/spectre/toplevel.scs" section=tt',
    "subckt inv in out vdd vss",
    "    M1 (out in vdd vdd) pch_mac w=2u l=30n",
    "    M0 (out in vss vss) nch_mac w=1u l=30n",
    "ends inv",
    "",
  ].join("\n"),
);

const symbols = (project: { documents: { instances: unknown[] }[] }) =>
  project.documents
    .flatMap((document) => document.instances)
    .map((instance) => (instance as { symbolId: string }).symbolId)
    .filter((symbol) => symbol !== "port")
    .sort();

describe("Agent local circuit import", () => {
  it("names the model whose type an external library hides", async () => {
    await expect(importLocalCircuit([virtuoso], "top.scs")).rejects.toThrow(
      /(?:nch_mac|pch_mac).*external library may hold its card.*Give its device type in modelTypes/u,
    );
  });

  it("draws an external library's models with the types the Agent gives, leaving the files as written", async () => {
    const imported = await importLocalCircuit([virtuoso], "top.scs", {
      modelTypes: { NCH_MAC: "nmos", pch_mac: "pmos", unused: "npn" },
    });
    expect(symbols(imported.project)).toEqual(["nmos", "pmos"]);
    expect(JSON.stringify(imported.project)).toContain("nch_mac");
    const entry = imported.project.source.files.find(
      (file) => file.path === "top.scs",
    );
    expect(entry?.hash).toBe(`sha256:${virtuoso.sha256}`);
    expect(entry?.originalContent?.text).toContain(
      'include "/pdk/tsmc28/models/spectre/toplevel.scs" section=tt',
    );
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SPICE_SOURCE_INCLUDE_EXTERNAL",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "LOCAL_MODEL_TYPES_GIVEN",
          severity: "warning",
          message: expect.stringMatching(/NCH_MAC=nmos, pch_mac=pmos/u),
        }),
      ]),
    );
    expect(
      imported.diagnostics.find(
        (item) => item.code === "LOCAL_MODEL_TYPES_GIVEN",
      )?.message,
    ).not.toContain("unused");
  });

  it("asks only for a card where the caller cannot give device types", async () => {
    const { importSpiceSources } = await import("@icm/spice");
    const { prepareImportSources } =
      await import("../features/netlist-export/convert-import-sources");
    const prepared = prepareImportSources([virtuoso]);
    const result = await importSpiceSources(prepared.inputs, "top.scs", {
      includeRoot: "workspace",
    });
    const refused = result.diagnostics.find(
      (item) => item.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
    );
    expect(refused?.message).toMatch(/Add "model (?:nch|pch)_mac bsim4/u);
    expect(refused?.message).not.toContain("modelTypes");
  });

  it("draws a delivered native model card it does not convert by its type", async () => {
    const top = input(
      "top.scs",
      [
        "simulator lang=spectre",
        'include "models.scs"',
        "subckt inv in out vdd vss",
        "    M1 (out in vdd vdd) pch w=2u l=180n",
        "    M2 (out in vss vss) nch w=1u l=180n",
        "ends inv",
        "",
      ].join("\n"),
    );
    const models = input(
      "models.scs",
      "simulator lang=spectre\nmodel nch bsim3v3 type=n\nmodel pch bsim3v3 type=p\n",
    );
    const imported = await importLocalCircuit([top, models], "top.scs");
    expect(symbols(imported.project)).toEqual(["nmos", "pmos"]);
    expect(
      imported.diagnostics.filter(
        (item) => item.code === "SPICE_CONVERSION_MODEL_EXTERNAL",
      ),
    ).toHaveLength(2);
    // The Agent's word never overrides a card the sources give.
    const overridden = await importLocalCircuit([top, models], "top.scs", {
      modelTypes: { nch: "pmos" },
    });
    expect(symbols(overridden.project)).toEqual(["nmos", "pmos"]);
  });
});
