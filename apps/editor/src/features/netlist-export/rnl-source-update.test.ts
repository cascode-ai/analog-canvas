import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EditorDocumentController } from "../../document/document-controller";
import { planRnlImport } from "./rnl-import";
import { createRnlTestCore } from "./rnl-core.test-support";
import {
  prepareRnlSourceUpdate,
  type RnlImportSource,
} from "./rnl-source-update";

const runtime = await createRnlTestCore();
afterAll(() => runtime.terminate());

const entryPath = "top.spi";
const includedPath = "amp.inc";
const sourceCellName = "Input_amp";
const cellName = "Input amp";
const standardPackages =
  '@RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-all", version="0.4"); }';
const header = [
  "* Source drawing update",
  '* @RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-all", version="0.4"); @USE-PACKAGE(name="rnl-std-no-labels", version="0.4"); @USE-PACKAGE(name="analog-canvas-extensions", version="0.7"); }',
].join("\n");
const top =
  header +
  '\n.include "amp.inc"\n.include "models.inc"\nX1 IN OUT ' +
  sourceCellName +
  "\n.end\n";
const ampBody =
  ".subckt " + sourceCellName + " IN OUT\r\nR1 IN OUT 1k\r\nR3 IN OUT 2k\r\n";
const ampRecords =
  "* @RNL { #R1 @PLACE(2, 0); #R3 @PLACE(2, 4); $CANVAS_TOP @ATTACH #;\r\n" +
  '* $CANVAS_CELL_NAME @ATTACH(name="' +
  cellName +
  '") #(level); }\r\n';
const endsAmp = ".ends " + sourceCellName + "\r\n";
const other = [
  "* Keep this comment",
  ".subckt spare IN OUT",
  "R2 IN OUT 2k",
  "* @RNL { #R2 @PLACE(5, 0) }",
  ".ends spare",
  "",
].join("\r\n");
const includedPrefix = "\uFEFF" + ampBody;
const includedSuffix = endsAmp + other;
const included = includedPrefix + ampRecords + includedSuffix;
const input = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

function importedFiles(text = included) {
  return [
    input(entryPath, top),
    input(includedPath, text),
    {
      path: "models.inc",
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("* Reference models\n.model library_d D\n", "utf16le"),
      ]),
    },
  ];
}

let source: RnlImportSource;
beforeAll(async () => {
  const inputs = importedFiles();
  const plan = await planRnlImport({ runtime, inputs, entryPath });
  if (plan.status !== "ready") throw new Error(plan.message);
  source = { inputs, entryPath, project: plan.project };
}, 30_000);

it("updates the file that defines the edited level and preserves its other bytes", async () => {
  const edited = structuredClone(source.project);
  const cell = edited.documents.find(
    (document) => document.netlist?.name === cellName,
  )!;
  const resistor = cell.instances.find(({ reference }) => reference === "R1")!;
  resistor.placement!.position.x += 40;
  edited.documents
    .find(({ netlist }) => netlist?.name === "spare")!
    .instances.find(
      ({ reference }) => reference === "R2",
    )!.placement!.rotation = 45;

  const update = await prepareRnlSourceUpdate(edited, cell.id, source, runtime);
  expect(update).toMatchObject({
    path: includedPath,
    entryPath,
    level: sourceCellName,
    sourceSha256: createHash("sha256").update(included).digest("hex"),
  });
  expect(update.text.startsWith(includedPrefix)).toBe(true);
  expect(update.text.endsWith(includedSuffix)).toBe(true);
  const records = update.text.slice(
    includedPrefix.length,
    -includedSuffix.length,
  );
  expect(records).not.toBe(ampRecords);
  expect(
    records
      .trimEnd()
      .split("\r\n")
      .every((line) => line.startsWith("*")),
  ).toBe(true);

  const reopened = await planRnlImport({
    runtime,
    inputs: importedFiles(update.text),
    entryPath,
  });
  if (reopened.status !== "ready") throw new Error(reopened.message);
  expect(
    reopened.project.documents.find(
      ({ id }) => id === reopened.project.topDocumentId,
    )?.netlist?.name,
  ).toBe(
    source.project.documents.find(
      ({ id }) => id === source.project.topDocumentId,
    )?.netlist?.name,
  );
  expect(
    reopened.project.documents
      .find((document) => document.netlist?.name === cellName)
      ?.instances.find(({ reference }) => reference === "R1")?.placement,
  ).toEqual(resistor.placement);
}, 20_000);

it("gives the runtime's refusal for a level in a protected region", async () => {
  const inputs = [
    input(
      entryPath,
      "* Source\n* " +
        standardPackages +
        '\n.include "amp.inc"\nX1 IN OUT amp\n.end\n',
    ),
    input(
      includedPath,
      ".protect\n.subckt amp IN OUT\nR1 IN OUT 1k\n.ends amp\n.unprotect\n",
    ),
  ];
  const plan = await planRnlImport({ runtime, inputs, entryPath });
  if (plan.status !== "ready") throw new Error(plan.message);
  const cell = plan.project.documents.find(
    ({ netlist }) => netlist?.name === "amp",
  )!;
  await expect(
    prepareRnlSourceUpdate(
      plan.project,
      cell.id,
      { inputs, entryPath, project: plan.project },
      runtime,
    ),
  ).rejects.toThrow(/RNL8405.*encrypted/u);
}, 20_000);

it("refuses to write back swapped values of parallel resistors", async () => {
  const controller = new EditorDocumentController(source.project);
  const cell = source.project.documents.find(
    ({ netlist }) => netlist?.name === cellName,
  )!;
  const first = cell.instances.find(({ reference }) => reference === "R1")!;
  const second = cell.instances.find(({ reference }) => reference === "R3")!;
  expect(
    controller.transact([
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: first.id,
        set: { value: "2k" },
      },
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: second.id,
        set: { value: "1k" },
      },
    ]),
  ).toMatchObject({ ok: true, applied: true });

  await expect(
    prepareRnlSourceUpdate(controller.project, cell.id, source, runtime),
  ).rejects.toThrow(/electrical changes/u);
});

it("refuses to write back an edited inductor coupling", async () => {
  const path = "coupled.spi";
  const inputs = [
    input(
      path,
      [
        "* Coupled inductors",
        "* " + standardPackages,
        ".subckt coupled A B C D",
        "L1 A B 1m",
        "L2 C D 1m",
        "K1 L1 L2 0.5",
        "* @RNL { #L1 @PLACE(2, 0); #L2 @PLACE(6, 0); }",
        ".ends coupled",
        ".end",
      ].join("\n"),
    ),
  ];
  const plan = await planRnlImport({ runtime, inputs, entryPath: path });
  if (plan.status !== "ready") throw new Error(plan.message);
  const controller = new EditorDocumentController(plan.project);
  const cell = plan.project.documents[0]!;
  expect(
    controller.transact([
      {
        kind: "set_inductor_coupling",
        coupling: { ...cell.inductorCouplings![0]!, k: "0.7" },
      },
    ]),
  ).toMatchObject({ ok: true, applied: true });
  await expect(
    prepareRnlSourceUpdate(
      controller.project,
      cell.id,
      { project: plan.project, entryPath: path, inputs },
      runtime,
    ),
  ).rejects.toThrow(/electrical changes/u);
}, 20_000);

it("updates the file level when the source names a subcircuit as the Project top", async () => {
  const edited = structuredClone(source.project);
  expect(
    edited.documents.find(({ id }) => id === edited.topDocumentId)?.netlist
      ?.name,
  ).toBe(cellName);
  const flat = edited.documents.find(
    ({ netlist }) => netlist?.name === "__flat__",
  )!;
  const call = flat.instances.find(({ reference }) => reference === "X1")!;
  call.placement!.position.x += 40;

  const update = await prepareRnlSourceUpdate(edited, flat.id, source, runtime);
  expect(update).toMatchObject({ path: entryPath, level: entryPath });
  const reopened = await planRnlImport({
    runtime,
    entryPath,
    inputs: source.inputs.map((file) =>
      file.path === entryPath ? input(entryPath, update.text) : file,
    ),
  });
  if (reopened.status !== "ready") throw new Error(reopened.message);
  expect(
    reopened.project.documents.find(
      ({ id }) => id === reopened.project.topDocumentId,
    )?.netlist?.name,
  ).toBe(cellName);
  expect(
    reopened.project.documents
      .find(({ netlist }) => netlist?.name === "__flat__")
      ?.instances.find(({ reference }) => reference === "X1")?.placement,
  ).toEqual(call.placement);
}, 20_000);

it("updates the file level of a Spectre source", async () => {
  const path = "resistor.scs";
  const prefix = [
    "// Source drawing update",
    "simulator lang=spectre",
    "// " + standardPackages,
    "R1 (IN OUT) resistor r=1k",
    "",
  ].join("\n");
  const text = prefix + "// @RNL { #R1 @PLACE(2, 0) }\n";
  const inputs = [input(path, text)];
  const plan = await planRnlImport({ runtime, entryPath: path, inputs });
  if (plan.status !== "ready") throw new Error(plan.message);
  const edited = structuredClone(plan.project);
  const cell = edited.documents.find(({ id }) => id === edited.topDocumentId)!;
  const resistor = cell.instances.find(({ reference }) => reference === "R1")!;
  resistor.placement!.position.y += 40;

  const update = await prepareRnlSourceUpdate(
    edited,
    cell.id,
    { inputs, entryPath: path, project: plan.project },
    runtime,
  );
  expect(update).toMatchObject({
    entryPath: path,
    path,
    level: path,
    sourceSha256: createHash("sha256").update(text).digest("hex"),
  });
  expect(update.text.startsWith(prefix)).toBe(true);
  expect(update.text).not.toBe(text);
  const reopened = await planRnlImport({
    runtime,
    entryPath: path,
    inputs: [input(path, update.text)],
  });
  if (reopened.status !== "ready") throw new Error(reopened.message);
  expect(
    reopened.project.documents[0]?.instances.find(
      ({ reference }) => reference === "R1",
    )?.placement,
  ).toEqual(resistor.placement);
}, 20_000);

it.each([
  {
    symbol: "$NMOS_4TERM",
    cards: [".model demo NMOS", "M1 D G S B demo l=0.2u w=2u"],
    reference: "M1",
  },
  {
    symbol: "$PMOS_4TERM",
    cards: [".model demo PMOS", "M1 D G S B demo l=0.2u w=2u"],
    reference: "M1",
  },
  {
    symbol: "$DEPLETION_NMOS_4TERM",
    cards: [".model demo NMOS VTO=-0.3", "M1 D G S B demo l=0.2u w=2u"],
    reference: "M1",
  },
  {
    symbol: "$DEPLETION_PMOS_4TERM",
    cards: [".model demo PMOS VTO=0.3", "M1 D G S B demo l=0.2u w=2u"],
    reference: "M1",
  },
  {
    symbol: "$VCVS_4TERM",
    cards: ["E1 D B G S 30"],
    reference: "E1",
  },
])(
  "keeps $symbol in the updated source",
  async ({ symbol, cards, reference: deviceReference }) => {
    const path = "stage.spi";
    const prefix = [
      "* Standard package drawing",
      "* " + standardPackages,
      ".subckt stage D G S B",
      ...cards,
      "",
    ].join("\n");
    const inputs = [
      input(
        path,
        prefix +
          "* @RNL { #" +
          deviceReference +
          " @SET-SYMBOL " +
          symbol +
          "; #" +
          deviceReference +
          " @PLACE(2, 0); }\n" +
          ".ends stage\n.end\n",
      ),
    ];
    const plan = await planRnlImport({ runtime, inputs, entryPath: path });
    if (plan.status !== "ready") throw new Error(plan.message);
    const edited = structuredClone(plan.project);
    const cell = edited.documents[0]!;
    const device = cell.instances.find(
      ({ reference }) => reference === deviceReference,
    )!;
    device.placement!.position.x += 40;
    const update = await prepareRnlSourceUpdate(
      edited,
      cell.id,
      { project: plan.project, inputs, entryPath: path },
      runtime,
    );
    expect(update.text.startsWith(prefix)).toBe(true);
    expect(update.text).toContain("@SET-SYMBOL " + symbol);
    const reopened = await planRnlImport({
      runtime,
      entryPath: path,
      inputs: [input(path, update.text)],
    });
    if (reopened.status !== "ready") throw new Error(reopened.message);
    expect(
      reopened.project.documents[0]?.instances.find(
        ({ reference }) => reference === deviceReference,
      )?.placement,
    ).toEqual(device.placement);
  },
  20_000,
);

it("refuses an appearance change that needs a package absent from the source", async () => {
  const path = "controlled-source.spi";
  const inputs = [
    input(
      path,
      [
        "* Standard controlled source",
        "* " + standardPackages,
        ".subckt stage D G S B",
        "E1 D B G S 30",
        "* @RNL { #E1 @SET-SYMBOL $CONTROLLED_VOLTAGE_SOURCE; #E1 @PLACE(2, 0); }",
        ".ends stage",
        ".end",
      ].join("\n"),
    ),
  ];
  const imported = await planRnlImport({ runtime, inputs, entryPath: path });
  if (imported.status !== "ready") throw new Error(imported.message);
  const controller = new EditorDocumentController(imported.project);
  const cell = imported.project.documents[0]!;
  const device = cell.instances.find(({ reference }) => reference === "E1")!;
  expect(device.symbolVariantId).toBe("diamond");
  expect(
    controller.transact([
      {
        kind: "set_instance_symbol",
        instanceId: device.id,
        symbolId: device.symbolId,
        symbolVariantId: null,
      },
    ]),
  ).toMatchObject({ ok: true, applied: true });

  await expect(
    prepareRnlSourceUpdate(
      controller.project,
      cell.id,
      { project: imported.project, inputs, entryPath: path },
      runtime,
    ),
  ).rejects.toThrow(/RNL8410.*CANVAS_VCVS_CIRCLE/u);
}, 20_000);
