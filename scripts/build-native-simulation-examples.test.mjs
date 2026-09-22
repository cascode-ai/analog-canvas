import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProjectComponentDefinitions } from "../packages/symbols/src/index.js";
import {
  parseProject,
  canonicalConnectionIndexes,
} from "../packages/project-protocol/src/index.js";
import { compileSourceSimulation } from "../packages/netlist/src/simulation-source-compile.js";

const run = (directory, args = []) =>
  execFileSync(
    process.execPath,
    ["scripts/build-native-simulation-examples.mjs", directory, ...args],
    { stdio: "pipe", timeout: 60000 },
  );

// The full-library case stays an acceptance obligation during migration. Do not
// filter unfinished model-backed folders out of it to obtain a green result.
test.each([
  {
    scope: "passive selection",
    args: ["--project", "rc", "--project", "rlc"],
    counts: [4, 3],
  },
  {
    scope: "common-source selection",
    args: ["--project", "common-source"],
    counts: [4],
  },
  {
    scope: "Library OTA selection",
    args: ["--project", "ota-library"],
    counts: [12],
  },
  { scope: "complete library", args: [], counts: [4, 3, 4, 8, 12] },
])(
  "exports the $scope without reconstructing any reviewed Project",
  ({ args, counts }) => {
    const directory = mkdtempSync(join(tmpdir(), "icm-native-projects-test-"));
    try {
      run(directory, args);
      const manifest = JSON.parse(
        readFileSync(join(directory, "manifest.json"), "utf8"),
      );
      expect(manifest.status).toBe("compiled-not-executed");
      expect(manifest.projects.map((p) => p.folders.length)).toEqual(counts);
      for (const item of manifest.projects) {
        const project = parseProject(readFileSync(item.file, "utf8"));
        const reviewed = parseProject(readFileSync(item.sourcePath, "utf8"));
        // Includes every instance parameter/pin order, route, label, DUT/TB binding,
        // top Cell, folder and authored byte. Rendering does not rewrite the input.
        expect(canonicalConnectionIndexes(project)).toEqual(
          canonicalConnectionIndexes(withProjectComponentDefinitions(reviewed)),
        );
        for (const doc of project.documents) {
          const inspection = JSON.parse(
            readFileSync(
              join(directory, `${item.slug}-${doc.id}-inspection.json`),
              "utf8",
            ),
          );
          expect(inspection.document.id).toBe(doc.id);
          if (item.id !== "ota-library") {
            expect(inspection.document.diagnostics).toEqual([]);
          } else {
            // The reviewed Library drawing already has advisory label overlaps.
            // Preserve these diagnostics and the drawing, rather than treating
            // a low-confidence non-gating visual warning as electrical failure.
            for (const diagnostic of inspection.document.diagnostics)
              expect(diagnostic).toMatchObject({
                code: "VISUAL_LABEL_OVERLAP",
                domain: "visual",
                severity: "warning",
                confidence: "low",
                gateEligible: false,
              });
          }
          expect(
            readFileSync(join(directory, `${item.slug}-${doc.id}.svg`), "utf8"),
          ).toContain("<svg");
          expect([
            ...readFileSync(
              join(directory, `${item.slug}-${doc.id}.png`),
            ).subarray(0, 8),
          ]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        }
        for (const folder of project.simulationFolders) {
          const compiled = compileSourceSimulation(project, folder);
          expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
          expect(item.folders.find((f) => f.id === folder.id).profileId).toBe(
            compiled.config.environment.profileId,
          );
          for (const source of folder.input.files) {
            expect(
              readFileSync(
                join(directory, "source", item.slug, folder.id, source.path),
                "utf8",
              ),
            ).toBe(source.text);
          }
          for (const source of compiled.files) {
            expect(
              readFileSync(
                join(directory, "prepared", item.slug, folder.id, source.path),
                "utf8",
              ),
            ).toBe(source.text);
          }
        }
      }
      const before = readFileSync(join(directory, "manifest.json"));
      expect(() => run(directory, args)).toThrow(
        /Output directory must be empty/,
      );
      expect(readFileSync(join(directory, "manifest.json"))).toEqual(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  90000,
);

test("rejects unknown selections before writing output", () => {
  const directory = mkdtempSync(join(tmpdir(), "icm-native-selection-"));
  try {
    expect(() => run(directory, ["--project", "unknown"])).toThrow(/Usage:/);
    expect(readdirSync(directory)).toEqual([]);
    writeFileSync(join(directory, "evidence.txt"), "existing evidence");
    expect(() => run(directory, ["--project", "rc"])).toThrow(
      /Output directory must be empty/,
    );
    expect(readdirSync(directory)).toEqual(["evidence.txt"]);
    expect(readFileSync(join(directory, "evidence.txt"), "utf8")).toBe(
      "existing evidence",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90000);
