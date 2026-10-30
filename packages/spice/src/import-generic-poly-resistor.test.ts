import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { expect, it } from "vitest";

import { convertNetlist } from "./conversion.js";
import { importSpiceSources } from "./importer.js";

it.each(["spi", "scs"])(
  "imports the bootstrap driver's generic poly resistors from %s without empty bodies",
  async (extension) => {
    // Literal calls from #1835; the PDK wrapper is t1 t2 w=1 l=1 at scale=1u.
    const text = (
      extension === "spi"
        ? [
            "* bootstrap driver resistors",
            ".subckt driver VLX VSW CB",
            "XREF VLX VSW sky130_fd_pr__res_generic_po w=1000 l=0.35",
            "XRC CB VLX sky130_fd_pr__res_generic_po w=1.2 l=0.35",
            ".ends driver",
            ".end",
            "",
          ]
        : [
            "simulator lang=spectre",
            "subckt driver (VLX VSW CB)",
            "XREF (VLX VSW) sky130_fd_pr__res_generic_po w=1000 l=0.35",
            "XRC (CB VLX) sky130_fd_pr__res_generic_po w=1.2 l=0.35",
            "ends driver",
            "",
          ]
    ).join("\n");
    const path = `driver.${extension}`;
    // The editor converts Spectre before calling the structural SPICE importer.
    let spice = text;
    if (extension === "scs") {
      const converted = convertNetlist({
        text,
        source: "spectre",
        target: "spice",
      });
      if (converted.status !== "converted")
        throw new Error(JSON.stringify(converted.issues));
      spice = converted.text;
    }
    const imported = await importSpiceSources(
      [{ path, bytes: new TextEncoder().encode(spice) }],
      path,
    );
    expect(
      imported.diagnostics.filter(({ severity }) => severity === "error"),
    ).toEqual([]);
    expect(imported.project).toBeDefined();
    const restored = parseProject(serializeProject(imported.project!));
    const driver = restored.documents.find(({ name }) => name === "driver")!;
    expect(driver.instances.find(({ id }) => id === "XREF")).toMatchObject({
      symbolId: "resistor",
      netlist: {
        binding: { kind: "external-subcircuit" },
        parameters: { w: "1000u", l: "350n" },
      },
    });
    expect(driver.instances.find(({ id }) => id === "XRC")).toMatchObject({
      symbolId: "resistor",
      netlist: { parameters: { w: "1.2u", l: "350n" } },
    });
    const exported = createDesignNetlistExport(restored, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    expect(exported.file.text.split("\n")).toEqual(
      expect.arrayContaining([
        "XREF VLX VSW sky130_fd_pr__res_generic_po w=1000 l=0.35",
        "XRC CB VLX sky130_fd_pr__res_generic_po w=1.2 l=0.35",
      ]),
    );
    expect(exported.file.text).not.toMatch(
      /^\.subckt sky130_fd_pr__res_generic_po\b/mu,
    );
  },
);
