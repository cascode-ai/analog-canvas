import { describe, expect, it } from "vitest";

import { displayableInstanceValue } from "@icm/derived";
import { flattenRichText, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { importSpiceSources } from "@icm/spice";

import { createLibraryExampleProject } from "../../examples/library-examples";
import { prepareImportSources } from "./convert-import-sources";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { prepareNetlistExample } from "./netlist-process";

/** What each part's value label shows, Cell by Cell: reference to text. */
function valueLabels(project: CircuitProject) {
  return Object.fromEntries(
    project.documents.map((document) => [
      (document.netlist?.name ?? document.name).toLowerCase(),
      Object.fromEntries(
        document.instances.flatMap((instance) => {
          const shown = displayableInstanceValue(instance);
          return shown.kind === "displayable" && instance.reference
            ? [
                [
                  instance.reference.toLowerCase(),
                  flattenRichText(shown.content),
                ],
              ]
            : [];
        }),
      ),
    ]),
  );
}

// The value labels of an example, and the fields of its sources, as they were
// drawn: a number keeps the digits and suffix it was written with through SCS
// (15u, not 0.000015), and a source's card keeps its DC value, AC clause and
// pulse apart (0.9, not 0.9 AC 1 0 PULSE(...)).
describe("the value labels of a circuit imported from the netlist it was exported to", () => {
  it.each(["spice", "spectre"] as const)(
    "show what they showed through %s",
    async (format) => {
      const project = prepareNetlistExample(
        createLibraryExampleProject("five-transistor-ota-sky130")!,
        createDefaultNetlistExportPreferences().profiles.sky130,
      );
      const out = createDesignNetlistExport(project, { format });
      expect(out.status).toBe("ready");
      if (out.status !== "ready") return;
      const path = format === "spice" ? "circuit.sp" : "circuit.scs";
      const inputs = [{ path, bytes: new TextEncoder().encode(out.file.text) }];
      const result = await importSpiceSources(
        prepareImportSources(inputs).inputs,
        path,
        {},
        { namingProfile: "native", originalSources: inputs },
      );
      expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
      const drawn = valueLabels(project);
      const read = valueLabels(result.project!);
      // The Cells the netlist carries: the testbench and the OTA it calls.
      expect(Object.keys(read).sort()).toEqual(["ota_5t", "testbench"]);
      for (const cell of Object.keys(read))
        for (const [reference, text] of Object.entries(read[cell]!))
          expect(text, `${cell} ${reference}`).toBe(drawn[cell]![reference]);
      // The testbench's sources are among them (a vacuous loop shows nothing).
      expect(read["testbench"]).toMatchObject({
        vdd: "1.8",
        vinp: "0.9",
        vinn: "0.9",
        ibias: "15u",
        cl: "1p",
      });
      expect(Object.keys(read["ota_5t"]!)).toHaveLength(6);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "come back as the same %s card when the circuit is exported again",
    async (format) => {
      const project = prepareNetlistExample(
        createLibraryExampleProject("five-transistor-ota-sky130")!,
        createDefaultNetlistExportPreferences().profiles.sky130,
      );
      const first = createDesignNetlistExport(project, { format });
      if (first.status !== "ready") throw new Error("blocked");
      const path = format === "spice" ? "circuit.sp" : "circuit.scs";
      const inputs = [
        { path, bytes: new TextEncoder().encode(first.file.text) },
      ];
      const imported = await importSpiceSources(
        prepareImportSources(inputs).inputs,
        path,
        {},
        { namingProfile: "native", originalSources: inputs },
      );
      const second = createDesignNetlistExport(imported.project!, { format });
      if (second.status !== "ready") throw new Error("blocked");
      const cards = (text: string) =>
        text
          .split("\n")
          .filter((line) => /^(?:VINP|VINN|VDD|IBIAS|CL)\b/u.test(line));
      expect(cards(second.file.text).length).toBe(5);
      // The pulse source's card is the same card, AC phase and all.
      const pulse = (text: string) =>
        cards(text).find((line) => line.startsWith("VINP"))!;
      expect(pulse(second.file.text)).toBe(pulse(first.file.text));
      expect(
        cards(second.file.text).filter((line) => !line.startsWith("VINP")),
      ).toEqual(
        cards(first.file.text).filter((line) => !line.startsWith("VINP")),
      );
    },
  );
});
