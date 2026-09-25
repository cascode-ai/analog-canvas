import { describe, expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const source = (secondPmosBulk: string) =>
  [
    "MOS bulk defaults",
    ".model NM NMOS (level=1)",
    ".model PM PMOS (level=1)",
    ".subckt amp IN OUT AVDD VSS BIAS",
    "MP1 OUT IN AVDD AVDD PM",
    `MP2 OUT IN AVDD ${secondPmosBulk} PM`,
    "MN1 OUT IN VSS VSS NM",
    "MN2 OUT IN VSS VSS NM",
    ".ends amp",
    ".end",
    "",
  ].join("\n");

async function importedAmp(secondPmosBulk: string) {
  const result = await importSpiceSources(
    [
      {
        path: "amp.spi",
        bytes: new TextEncoder().encode(source(secondPmosBulk)),
      },
    ],
    "amp.spi",
  );
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return result.project!.documents.find((document) => document.name === "amp")!;
}

describe("imported MOS bulk defaults", () => {
  it("uses unanimous fourth-node evidence as the same Cell defaults later MOSes use", async () => {
    const document = await importedAmp("AVDD");
    const portNetId = (name: string) =>
      document.netlist!.terminals.find((terminal) => terminal.name === name)!
        .netId;
    expect(document.mosBulkDefaults).toEqual({
      nmosNetId: portNetId("VSS"),
      pmosNetId: portNetId("AVDD"),
    });
    for (const reference of ["MP1", "MP2", "MN1", "MN2"]) {
      const instance = document.instances.find(
        (candidate) => candidate.reference === reference,
      )!;
      const expectedNetId = portNetId(
        reference.startsWith("MP") ? "AVDD" : "VSS",
      );
      expect(
        document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id && terminal.pinName === "B",
          ),
        )?.id,
      ).toBe(expectedNetId);
    }
  });

  it("leaves a polarity without a common fourth node explicit", async () => {
    const document = await importedAmp("BIAS");
    expect(document.mosBulkDefaults).toEqual({
      nmosNetId: document.netlist!.terminals.find(
        (terminal) => terminal.name === "VSS",
      )!.netId,
    });
  });
});
