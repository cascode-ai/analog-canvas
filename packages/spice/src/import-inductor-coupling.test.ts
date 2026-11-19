import { describe, expect, it } from "vitest";

import { convertNetlist } from "./conversion.js";
import { importSpiceSources } from "./importer.js";

async function imported(lines: readonly string[], path = "tf.spi") {
  const result = await importSpiceSources(
    [
      {
        path,
        bytes: new TextEncoder().encode(
          ["Coupled inductors", ...lines, ".end", ""].join("\n"),
        ),
      },
    ],
    path,
  );
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  const document = result.project!.documents.find(
    (candidate) => candidate.name === "tf",
  )!;
  const id = (reference: string) =>
    document.instances.find((instance) => instance.reference === reference)!.id;
  return { result, document, id };
}

const subckt = (...cards: string[]) => [
  ".subckt tf a b c d",
  "L1 a b 1u",
  "L2 d c 4u",
  "L3 c 0 2u",
  ...cards,
  ".ends tf",
];

describe("SPICE K cards (#1648)", () => {
  it("import as couplings dotted at each inductor's first node", async () => {
    const { result, document, id } = await imported(
      subckt("K1 L1 L2 0.9", "KX L3 L1 {kx}"),
    );
    expect(document.inductorCouplings).toEqual([
      {
        id: expect.any(String),
        name: "K1",
        members: [
          { instanceId: id("L1"), dotPin: "1" },
          { instanceId: id("L2"), dotPin: "1" },
        ],
        k: "0.9",
      },
      {
        id: expect.any(String),
        name: "KX",
        members: [
          { instanceId: id("L3"), dotPin: "1" },
          { instanceId: id("L1"), dotPin: "1" },
        ],
        k: "{kx}",
      },
    ]);
    // L2's first node, d, is on its pin 1: the dot follows the card.
    const l2NetOfPin1 = document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === id("L2") && terminal.pinName === "1",
      ),
    )!.id;
    expect(
      document.netlist!.terminals.find((terminal) => terminal.name === "d")!
        .netId,
    ).toBe(l2NetOfPin1);
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      "SPICE_IMPORT_NON_VISUAL_INSTANCE",
    );
  });

  it("leave a Cell without K cards as it was", async () => {
    const { document } = await imported(subckt());
    expect(document).not.toHaveProperty("inductorCouplings");
  });

  it("are skipped with a warning when they cannot be one coupling", async () => {
    const { result, document } = await imported(
      subckt(
        "K1 L1 L9 0.5",
        "K2 L1 L1 0.5",
        "K3 L1 L2 L3 0.5",
        "K4 L1 L2 0.9",
        "K5 L2 L1 0.8",
      ),
    );
    expect(document.inductorCouplings?.map((item) => item.name)).toEqual([
      "K4",
    ]);
    const skipped = result.diagnostics
      .filter((item) => item.code === "SPICE_IMPORT_COUPLING_SKIPPED")
      .map((item) => [item.severity, item.message]);
    expect(skipped).toEqual([
      ["warning", "K1 is not imported: L9 is not an inductor of tf"],
      ["warning", "K2 is not imported: it couples L1 with itself"],
      [
        "warning",
        "K3 is not imported: it couples 3 inductors, and a coupling joins exactly two",
      ],
      ["warning", "K5 is not imported: K4 already couples L2 and L1"],
    ]);
  });

  it("import from Spectre's mutual_inductor through its SPICE form", async () => {
    const spectre = [
      "subckt tf (a b c d)",
      "L1 (a b) inductor l=1u",
      "L2 (c d) inductor l=4u",
      "TF1 mutual_inductor coupling=0.7 ind1=L1 ind2=L2",
      "ends tf",
      "",
    ].join("\n");
    const converted = convertNetlist({
      text: spectre,
      source: "spectre",
      target: "spice",
      fragment: true,
    });
    if (converted.status === "blocked")
      throw new Error(JSON.stringify(converted.issues));
    expect(converted.text).toContain("KTF1 L1 L2 0.7");
    const path = "tf.scs";
    const result = await importSpiceSources(
      [{ path, bytes: new TextEncoder().encode(converted.text) }],
      path,
      undefined,
      {
        originalSources: [{ path, bytes: new TextEncoder().encode(spectre) }],
      },
    );
    expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
    const document = result.project!.documents.find(
      (candidate) => candidate.name === "tf",
    )!;
    const id = (reference: string) =>
      document.instances.find((instance) => instance.reference === reference)!
        .id;
    // The coupling keeps the name Spectre wrote, not its SPICE form's.
    expect(document.inductorCouplings).toEqual([
      expect.objectContaining({
        name: "TF1",
        members: [
          { instanceId: id("L1"), dotPin: "1" },
          { instanceId: id("L2"), dotPin: "1" },
        ],
        k: "0.7",
      }),
    ]);
  });
});
