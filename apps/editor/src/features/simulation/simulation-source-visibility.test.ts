import { createSimulationFolder } from "@icm/model";
import { describe, expect, it } from "vitest";
import { isVisibleSimulationSource } from "./simulation-source-visibility";

const create = () =>
  createSimulationFolder({
    id: "f",
    name: "Native",
    profileId: "hosted",
    documentId: "d",
  });
describe("simulation source visibility", () => {
  it("hides native metadata by config path without mutating or hiding ordinary files", () => {
    const folder = create();
    const before = structuredClone(folder);
    expect(isVisibleSimulationSource(folder, folder.input.configPath)).toBe(
      false,
    );
    expect(isVisibleSimulationSource(folder, folder.input.entry)).toBe(true);
    expect(isVisibleSimulationSource(folder, "user.json")).toBe(true);
    expect(folder).toEqual(before);
    const config = folder.input.files.find(
      (file) => file.path === folder.input.configPath,
    )!;
    config.path = folder.input.configPath = "internal/environment.json";
    expect(isVisibleSimulationSource(folder, config.path)).toBe(false);
    expect(isVisibleSimulationSource(folder, "experiment.json")).toBe(true);
  });
  it("keeps legacy and malformed configurations available for repair", () => {
    const folder = create();
    const config = folder.input.files.find(
      (file) => file.path === folder.input.configPath,
    )!;
    for (const text of [
      "{",
      JSON.stringify({ version: 1, environment: { profileId: "hosted" } }),
      JSON.stringify({ version: 2, environment: {} }),
    ]) {
      config.text = text;
      expect(isVisibleSimulationSource(folder, config.path)).toBe(true);
    }
  });
  it("keeps pending and persisted drafts visible, including accidentally configured run entries", () => {
    const folder = create();
    const path = folder.input.configPath;
    expect(isVisibleSimulationSource(folder, path, true)).toBe(true);
    folder.input.drafts = [{ path, base: "original", text: "{" }];
    expect(isVisibleSimulationSource(folder, path)).toBe(true);
    folder.input.drafts = [];
    folder.input.entry = path;
    expect(isVisibleSimulationSource(folder, path)).toBe(true);
  });
});
