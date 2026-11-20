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
  it("brings in the parts whose model an external library hides as calls, and says how to type them (#2294)", async () => {
    const imported = await importLocalCircuit([virtuoso], "top.scs");
    expect(symbols(imported.project)).toEqual([
      expect.stringContaining("external"),
      expect.stringContaining("external"),
    ]);
    expect(
      imported.diagnostics.map(({ message }) => message).join("\n"),
    ).toMatch(
      /No declaration in the design names (?:nch_mac|pch_mac).*give its device type in modelTypes/u,
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

  it("asks a caller that cannot give device types for the library, never for a made-up card", async () => {
    const { importNetlistSources } =
      await import("../features/netlist-export/netlist-source-import");
    const result = await importNetlistSources([virtuoso], "top.scs", {
      compileOptions: { includeRoot: "workspace" },
    });
    const hint = result.diagnostics.find(
      (item) => item.code === "SPICE_IMPORT_EXTERNAL_CALLS",
    )?.message;
    expect(hint).toContain("include the library that defines it");
    expect(hint).not.toContain("modelTypes");
    expect(
      result.diagnostics.map(({ message }) => message).join("\n"),
    ).not.toMatch(/model (?:nch|pch)_mac bsim4|\.model/u);
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
