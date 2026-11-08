import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  applyTestbenchImport,
  guessTestbenchEntry,
  pickedPath,
  planTestbenchImport,
} from "./testbench-import";

const existing = () =>
  createSimulationFolder({
    id: "tb",
    name: "Gain",
    template: "testbench",
    documentId: "cell",
    dut: { name: "ota", ports: ["in", "out"] },
  });

describe("Testbench import review", () => {
  it("tells new, replaced, unchanged and refused files apart", () => {
    const folder = existing();
    const current = folder.input.files[0]!;
    const rows = planTestbenchImport(folder, [
      { path: "testbench.spice", text: current.text },
      { path: "report.py", text: "print('gain')\n" },
      { path: "circuit.spice", text: ".subckt ota in out\n.ends\n" },
      { path: "../outside.sp", text: "* no" },
      { path: "wave.raw", text: "bin\u0000ary" },
      { path: "report.py", text: "duplicate" },
    ]);
    expect(rows.map((row) => [row.path, row.status])).toEqual([
      ["testbench.spice", "unchanged"],
      ["report.py", "new"],
      ["circuit.spice", "generated"],
      ["../outside.sp", "unsafe"],
      ["wave.raw", "binary"],
    ]);
    expect(
      planTestbenchImport(folder, [
        { path: "testbench.spice", text: "* mine\n" },
      ])[0]!.status,
    ).toBe("replace");
  });

  it("keeps a picked folder's inner paths and guesses the deck that calls the DUT", () => {
    expect(
      pickedPath({ name: "tb.sp", webkitRelativePath: "ota/sim/tb.sp" }),
    ).toBe("sim/tb.sp");
    expect(pickedPath({ name: "tb.sp", webkitRelativePath: "" })).toBe("tb.sp");
    const rows = planTestbenchImport(null, [
      { path: "models.inc", text: "* models\n" },
      { path: "sim/tb.sp", text: "* tb\nXDUT a b ota\n.end\n" },
    ]);
    expect(guessTestbenchEntry(rows)).toBe("sim/tb.sp");
  });

  it("writes only the chosen new or changed files and keeps the rest", () => {
    const project = createEmptyProject("p", "P");
    const folder = existing();
    const rows = planTestbenchImport(folder, [
      { path: "testbench.spice", text: "* mine\n" },
      { path: "report.py", text: "print(1)\n" },
    ]);
    const result = applyTestbenchImport(
      project,
      { cellId: "cell", folder },
      rows,
      new Set(["report.py"]),
      null,
      "unused",
    );
    expect(result.ok && result.folder.input.files).toEqual([
      folder.input.files[0],
      { path: "report.py", text: "print(1)\n" },
    ]);
    expect(
      applyTestbenchImport(
        project,
        { cellId: "cell", folder },
        rows,
        new Set(),
        null,
        "unused",
      ),
    ).toMatchObject({ ok: false });
  });

  it("makes a new Testbench bound to the Cell from imported files alone", () => {
    const project = createEmptyProject("p", "P");
    const cell = project.topDocumentId!;
    const rows = planTestbenchImport(null, [
      { path: "tb.sp", text: "* tb\n.end\n" },
      { path: "specs.txt", text: "gain" },
    ]);
    const result = applyTestbenchImport(
      project,
      { cellId: cell, folder: null },
      rows,
      new Set(["tb.sp", "specs.txt"]),
      "tb.sp",
      "P testbench",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder.name).toBe("P testbench");
    expect(result.folder.input.entry).toBe("tb.sp");
    expect(result.folder.input.files.map((file) => file.path)).toEqual([
      "tb.sp",
      "specs.txt",
    ]);
    expect(result.folder.input.circuitBindings[0]).toMatchObject({
      documentId: cell,
    });
  });
});
