import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  entryId,
  importBatches,
  keptDrawing,
  parseArguments,
} from "./gallery-import-batches.mjs";

const root = resolve(import.meta.dirname, "..");
const made = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function task(run, id, verdict, project = { name: `Circuit ${id}` }) {
  const dir = join(run, id);
  mkdirSync(join(dir, "second"), { recursive: true });
  writeFileSync(join(dir, "verdict.json"), JSON.stringify({ id, ...verdict }));
  writeFileSync(
    join(dir, "project.icproj.json"),
    JSON.stringify({ ...project, side: "first" }),
  );
  writeFileSync(
    join(dir, "second", "project.icproj.json"),
    JSON.stringify({ ...project, side: "second" }),
  );
}

describe("dataset import batches from a draw:batch run (#1498)", () => {
  it("keeps accepted drawings only, the suspect ones when asked", () => {
    expect(keptDrawing({ accepted: "first", path: "first" }, false)).toEqual({
      project: "project.icproj.json",
    });
    expect(keptDrawing({ accepted: "second", path: "second" }, false)).toEqual({
      project: "second/project.icproj.json",
    });
    expect(
      keptDrawing(
        { accepted: null, path: "review", reason: "two drawings differ" },
        false,
      ),
    ).toEqual({
      skip: "two drawings differ",
    });
    expect(
      keptDrawing(
        { accepted: "first", datasetSuspect: true, path: "agreed" },
        false,
      ).skip,
    ).toMatch(/include-suspect/u);
    expect(
      keptDrawing(
        { accepted: "first", datasetSuspect: true, path: "agreed" },
        true,
      ).project,
    ).toBe("project.icproj.json");
  });

  it("gives each entry the source's prefix and a safe id", () => {
    expect(entryId("ar", "chai/0012")).toBe("ar-chai-0012");
    expect(entryId("ag", "308")).toBe("ag-308");
    expect(() => entryId("ag", "///")).toThrow(/nothing usable/u);
    expect(() => parseArguments(["run"])).toThrow(/usage/u);
  });

  it("writes ten entries a file in the import body, and lists what it left out", () => {
    const run = mkdtempSync(join(tmpdir(), "icm-import-"));
    made.push(run);
    for (let index = 1; index <= 12; index += 1)
      task(run, String(index), {
        accepted: index === 12 ? "second" : "first",
        path: "first",
      });
    task(run, "13", {
      accepted: null,
      path: "review",
      reason: "two drawings differ",
    });
    writeFileSync(
      join(run, "tasks.jsonl"),
      `${JSON.stringify({ id: "1", name: "Folded cascode" })}\n`,
    );
    const result = importBatches(
      {
        run,
        source: "analogretriever",
        manifest: join(run, "tasks.jsonl"),
        includeSuspect: false,
      },
      root,
    );
    expect(result.entries).toBe(12);
    expect(result.files.map((file) => file.split("/").pop())).toEqual([
      "analogretriever-0001.json",
      "analogretriever-0002.json",
    ]);
    const first = JSON.parse(readFileSync(result.files[0], "utf8")).entries;
    expect(first).toHaveLength(10);
    expect(first[0]).toMatchObject({ id: "ar-1", name: "Folded cascode" });
    // Task directories in name order: 1, 10, 11, 12, 2, … 9.
    const second = JSON.parse(readFileSync(result.files[1], "utf8")).entries;
    expect(second.map((entry) => entry.id)).toEqual(["ar-8", "ar-9"]);
    const twelve = first.find((entry) => entry.id === "ar-12");
    expect(JSON.parse(twelve.projectText).side).toBe("second");
    expect(result.left).toEqual([{ id: "13", reason: "two drawings differ" }]);
  });
});
