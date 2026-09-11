import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { parseProject, serializeProject } from "./index.js";

describe("source folder migration", () => {
  it("preserves old folder identity and exact source bytes without a second collection", () => {
    const current = createEmptyProject("p", "P");
    const folder = createSimulationFolder({
      id: "old-setup-id",
      name: "OTA AC",
      profileId: "test",
    });
    const { simulationFolders: _, ...circuit } = current;
    const previous = {
      ...circuit,
      schemaVersion: 49,
      simulationSetups: [folder],
    };
    const loaded = parseProject(JSON.stringify(previous));
    expect(loaded.simulationFolders).toEqual([folder]);
    expect(loaded).not.toHaveProperty("simulationSetups");
    expect(parseProject(serializeProject(loaded))).toEqual(loaded);
  });
  it("round-trips unapplied numeric drafts without changing Canvas parameters", () => {
    const project = createEmptyProject("p", "P");
    const folder = createSimulationFolder({
      id: "f",
      name: "F",
      profileId: "test",
    });
    folder.input.drafts = [
      { path: "circuit.spice", base: "R1 a b 1k", text: "R1 a b 1e-" },
    ];
    project.simulationFolders.push(folder);
    const loaded = parseProject(serializeProject(project));
    expect(loaded.simulationFolders[0]!.input.drafts).toEqual(
      folder.input.drafts,
    );
    expect(loaded.documents).toEqual(project.documents);
  });
});
