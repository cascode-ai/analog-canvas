import { describe, expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

async function imported(card: string, givesModelTypes = false) {
  return importSpiceSources(
    [
      {
        path: "top.sp",
        bytes: new TextEncoder().encode(
          `* untyped\n.subckt top a b c d\n${card}\n.ends top\n`,
        ),
      },
    ],
    "top.sp",
    {},
    givesModelTypes ? { undeclaredModels: "give-type" } : {},
  );
}

const finding = (result: Awaited<ReturnType<typeof imported>>) =>
  result.diagnostics.find(({ code }) => code === "SPICE_IMPORT_UNTYPED_DEVICE")
    ?.message;

describe("device cards of unknown type (#2294)", () => {
  it.each([
    ["M1 a b c d nch_mac w=1u", "mos", ["D", "G", "S", "B"]],
    ["Q1 a b c qmod", "bjt", ["C", "B", "E"]],
    ["J1 a b c jmod", "jfet", ["D", "G", "S"]],
  ])(
    "brings in %s as a box of its family, bound to its model",
    async (card, deviceClass, pins) => {
      const result = await imported(card);
      expect(result.successful).toBe(true);
      const part = result.project!.documents.flatMap(
        (document) => document.instances,
      )[0]!;
      expect(
        result.project!.componentDefinitions?.find(
          ({ symbol }) => symbol.id === part.symbolId,
        )?.electrical,
      ).toMatchObject({ deviceClass, pinOrder: pins });
      expect(part.netlist?.binding).toMatchObject({
        kind: "model",
        deviceClass,
      });
    },
  );

  it("asks a caller that gives types for one of the part's own family", async () => {
    // The letter says the family, never which of its types.
    expect(finding(await imported("Q1 a b c qmod", true))).toContain(
      '{"qmod":"npn"} or {"qmod":"pnp"}',
    );
    expect(finding(await imported("J1 a b c jmod", true))).toContain(
      '{"jmod":"njf"} or {"jmod":"pjf"}',
    );
    expect(finding(await imported("M1 a b c d pch_mac", true))).toContain(
      '{"pch_mac":"nmos"} or {"pch_mac":"pmos"}',
    );
  });

  it("asks a caller that cannot give types for the library alone", async () => {
    const message = finding(await imported("M1 a b c d nch_mac"));
    expect(message).toContain("include the library that defines it");
    expect(message).not.toContain("modelTypes");
  });
});
