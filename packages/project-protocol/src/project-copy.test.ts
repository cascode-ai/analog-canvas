import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { readFileSync } from "node:fs";
import {
  createIndependentProject,
  parseProject,
  serializeProject,
} from "./index.js";

it("copies the complete persisted project with independent identity and no shared mutable content", () => {
  const original = createEmptyProject("original", "Amplifier", "top");
  const before = serializeProject(original);
  const copy = createIndependentProject(
    original,
    "independent",
    "Amplifier (copy)",
  );
  expect(copy.id).toBe("independent");
  expect(copy.name).toBe("Amplifier (copy)");
  expect(
    serializeProject({ ...copy, id: original.id, name: original.name }),
  ).toBe(before);
  copy.documents[0]!.name = "Changed";
  expect(serializeProject(original)).toBe(before);
});

it("keeps the embedded components and authored sources of existing amplifier projects in independent copies", () => {
  for (const path of [
    "netlists/native-ota/source.icproj.json",
    "apps/editor/src/examples/simulation-ota.icproj.json",
  ]) {
    const original = parseProject(
      readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"),
    );
    const before = serializeProject(original);
    const copy = createIndependentProject(
      original,
      "independent",
      "Independent amplifier",
    );
    expect(
      serializeProject({ ...copy, id: original.id, name: original.name }),
    ).toBe(before);
    expect(copy.simulationFolders.length).toBeGreaterThan(0);
    if (path.startsWith("netlists/"))
      expect(copy.componentDefinitions).toHaveLength(8);
    copy.simulationFolders.splice(0);
    expect(serializeProject(original)).toBe(before);
  }
});
