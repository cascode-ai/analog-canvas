import { expect, test, type Page } from "@playwright/test";

import {
  exampleProject,
  expectStatus,
  exportedProject,
  openEditor,
  openProject,
  showNetlistPanel,
} from "./editor-fixtures.js";

/**
 * A netlist as the Netlist panel's Copy hands it out, in one of its formats,
 * an RNL one once the rnl runtime has written it in its Worker: the text a
 * reader pastes into a file and imports again. (In a browser the panel
 * copies; only the desktop app saves.) The page's clipboard is a stand-in
 * that keeps what is written, since only Chrome lets a test read the real
 * one; it takes text and a ClipboardItem alike, as the editor writes both.
 */
async function copiedNetlist(
  page: Page,
  mode: "spice" | "spectre" | "spice+rnl" | "spectre+rnl",
): Promise<string> {
  await page.evaluate(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "__copied", {
      value: copied,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => void copied.push(text),
        write: async (items: ClipboardItem[]) => {
          for (const item of items)
            copied.push(await (await item.getType("text/plain")).text());
        },
      },
    });
  });
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption(mode);
  if (mode.endsWith("+rnl"))
    await expect(
      panel.getByRole("textbox", { name: "RNL netlist code", exact: true }),
    ).toBeVisible();
  await panel.getByTestId("copy-netlist-panel").click();
  const read = () =>
    page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "",
    );
  await expect.poll(read).not.toBe("");
  return (await read()).replace(/\r\n?/gu, "\n");
}

// docs/specs/rnl-interchange.md: the RNL formats the rnl runtime writes in
// its Worker, and File > Import > RNL… reading what they wrote.
test("writes SPICE+RNL and Spectre+RNL, and imports the file it wrote as it was drawn", async ({
  page,
}) => {
  const project = exampleProject("two-stage-op-amp.icproj.json");
  await openProject(page, project);
  const spice = await copiedNetlist(page, "spice");

  const rich = await copiedNetlist(page, "spice+rnl");
  expect(rich).toContain('* @RNL(type="header")');
  expect(rich).toContain(
    '@USE-PACKAGE(name="rnl-std-functional", version="0.3")',
  );
  expect(rich).toMatch(/#X1 @SET-SYMBOL \$OPAMP_5TERM/u);
  // The netlist it carries is the plain one, the op-amp's body printed in
  // the port order of its RNL symbol.
  expect(rich).toMatch(/^X1 Vin Vout 0 VSS net0 opamp$/mu);
  const spectre = await copiedNetlist(page, "spectre+rnl");
  expect(spectre).toMatch(/^\/\/ @RNL\(type="header"\)/mu);
  expect(spectre).toMatch(/^X1 \(Vin Vout 0 VSS net0\) opamp$/mu);

  await page.getByTestId("rnl-files").setInputFiles({
    name: "two-stage-op-amp.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(rich),
  });
  // The opened example has never been saved, so the import asks first.
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expectStatus(page, /^Imported 1 Document/u);
  // Every part where it was drawn, the op-amp and amplifier as built-in
  // blocks again, and the plain netlist the same.
  const imported = await exportedProject(page);
  const placement = (from: typeof project, reference: string) =>
    from.documents
      .flatMap((document) => document.instances)
      .find((instance) => instance.reference === reference)?.placement
      ?.position;
  for (const reference of ["X1", "X2", "CC", "CL"])
    expect(placement(imported, reference), reference).toEqual(
      placement(project, reference),
    );
  expect(
    imported.documents
      .flatMap(
        (document: (typeof project.documents)[number]) => document.instances,
      )
      .filter((instance: { reference?: string }) =>
        ["X1", "X2"].includes(instance.reference ?? ""),
      )
      .map((instance: { symbolId: string }) => instance.symbolId)
      .sort(),
  ).toEqual(["opamp-inputs-swapped", "voltage-amplifier"]);
  expect(await copiedNetlist(page, "spice")).toBe(spice);
});

interface CensusProject {
  documents: {
    name: string;
    netlist?: { name: string };
    instances: { id: string; symbolId: string }[];
    junctions: unknown[];
    annotations: { kind: string }[];
    routes: {
      presentation?: string;
      start: { kind: string; instanceId?: string; pinName?: string };
      legs: {
        to:
          | {
              kind: "endpoint";
              endpoint: { kind: string; instanceId?: string; pinName?: string };
            }
          | { kind: string };
      }[];
    }[];
  }[];
}

/**
 * What a drawing must keep through RNL, Cell by Cell: its parts by kind (the
 * two op-amp variants RNL draws alike count as one), its junctions, the pins
 * its wires reach by part kind and pin, its wires by how they are drawn, and
 * its net and power labels.
 */
function drawingCensus(project: CensusProject) {
  const kind = (symbolId: string) =>
    symbolId === "opamp-inputs-swapped" ? "opamp" : symbolId;
  const tally = (keys: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort().map(([key, count]) => `${key}:${count}`);
  };
  return Object.fromEntries(
    project.documents.map((document) => {
      const symbolOf = new Map(
        document.instances.map((instance) => [
          instance.id,
          kind(instance.symbolId),
        ]),
      );
      const reached = document.routes.flatMap((route) =>
        [
          route.start,
          ...route.legs.flatMap((leg) =>
            "endpoint" in leg.to ? [leg.to.endpoint] : [],
          ),
        ].flatMap((endpoint) =>
          endpoint.kind === "terminal"
            ? [`${symbolOf.get(endpoint.instanceId!)}.${endpoint.pinName}`]
            : [],
        ),
      );
      return [
        (document.netlist?.name ?? document.name).toLowerCase(),
        {
          parts: tally(
            document.instances.map((instance) => kind(instance.symbolId)),
          ),
          junctions: document.junctions.length,
          wiredPins: tally(reached),
          // Each wire as drawn, a power rail as a rail and a body tie dashed;
          // a wire through a junction stays one wire.
          wires: tally(
            document.routes.map((route) => route.presentation ?? "wire"),
          ),
          // A power label stays a power label, not a net label.
          labels: tally(
            document.annotations
              .filter(
                (annotation) =>
                  annotation.kind === "net-label" ||
                  annotation.kind === "power-label",
              )
              .map((annotation) => annotation.kind),
          ),
        },
      ];
    }),
  );
}

// The path a reader takes: an example opened from the library (its devices
// bound to the process), its RNL copied from the Netlist panel, and that file
// imported again. Copied ground glyphs, SKY130 subcircuit MOS, generic NMOS
// and PMOS, nets named Vin+, power labels and rails come back as drawn.
for (const example of [
  "common-source-amplifier",
  "current-mirror-loaded-differential-pair",
  "fully-differential-two-stage-op-amp",
])
  for (const process of ["sky130", "abstract"] as const)
    for (const mode of ["spice+rnl", "spectre+rnl"] as const)
      test(`brings ${example} (${process}) back through ${mode} with every part, ground, wire and label`, async ({
        page,
      }) => {
        await openEditor(page, `/editor?example=${example}`);
        const panel = await showNetlistPanel(page);
        await panel.getByLabel("Netlist process").selectOption(process);
        const before = drawingCensus(await exportedProject(page)).main!;
        // Each example draws its supply as a power label on a rail.
        expect(before.labels.join()).toContain("power-label:");
        expect(before.wires.join()).toContain("power-rail:");
        const text = await copiedNetlist(page, mode);
        await page.getByTestId("rnl-files").setInputFiles({
          name: `${example}.${mode === "spice+rnl" ? "sp" : "scs"}`,
          mimeType: "text/plain",
          buffer: Buffer.from(text),
        });
        // An example the reader changed asks before the import replaces it.
        const unsaved = page.getByRole("dialog", { name: "Unsaved changes" });
        const imported = page
          .getByTestId("status")
          .filter({ hasText: /^Imported 1 Document/u });
        await expect(unsaved.or(imported)).toBeVisible();
        if (await unsaved.isVisible())
          await unsaved
            .getByRole("button", { name: "Continue without saving" })
            .click();
        await expectStatus(page, /^Imported 1 Document/u);
        const after = drawingCensus(await exportedProject(page)).main!;
        for (const item of [
          "parts",
          "junctions",
          "wiredPins",
          "wires",
          "labels",
        ] as const)
          expect(after[item], item).toEqual(before[item]);
      });
