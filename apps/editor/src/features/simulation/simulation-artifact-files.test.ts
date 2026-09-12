import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";

import {
  buildSimulationArtifactArchive,
  buildSimulationWorkspaceArchive,
  formatSimulationArtifactPreview,
  readSimulationArtifactPreview,
  simulationArtifactCategory,
  simulationExplorerArtifactCategory,
} from "./simulation-artifact-files";

describe("simulation artifact files", () => {
  it("keeps diagnostic bytes exportable without classifying them as Explorer outputs", async () => {
    const files = new SimulationFiles();
    const entries = await Promise.all(
      [
        ["out.raw", "Results"],
        ["outputs-ac-0.csv", "Results"],
        ["simulator.log", "Logs"],
        ["prepared.cir", null],
        ["executed.cir", null],
        ["prepared.json", null],
        ["source-map.json", null],
        ["evidence-manifest.json", null],
        ["result.json", null],
        ["outputs.json", null],
        ["circuit.spice", null],
      ].map(async ([name, category]) => {
        const artifact = await files.put(name!, "text/plain", name!);
        expect(simulationExplorerArtifactCategory(artifact)).toBe(category);
        return artifact;
      }),
    );
    const archive = await buildSimulationArtifactArchive(files, entries);
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const contents = Object.values(unzipSync(archive.bytes)).map((bytes) =>
      strFromU8(bytes),
    );
    expect(contents.sort()).toEqual(entries.map((entry) => entry.name).sort());
  });
  it("previews bounded text and formats complete JSON", async () => {
    const files = new SimulationFiles();
    const json = await files.put(
      "result.json",
      "application/json",
      '{"status":"completed"}',
    );
    const jsonPreview = await readSimulationArtifactPreview(files, json);
    expect(jsonPreview.ok).toBe(true);
    if (!jsonPreview.ok) return;
    expect(formatSimulationArtifactPreview(jsonPreview.content)).toBe(
      '{\n  "status": "completed"\n}',
    );

    const raw = await files.put("out.raw", "text/plain", "x".repeat(70_000));
    const rawPreview = await readSimulationArtifactPreview(files, raw);
    expect(rawPreview.ok).toBe(true);
    if (!rawPreview.ok) return;
    expect(rawPreview.content.text).toHaveLength(65_536);
    expect(rawPreview.content.truncated).toBe(true);
  });

  it("packages a group into category folders without changing artifacts", async () => {
    const files = new SimulationFiles();
    const deck = await files.put("prepared.cir", "text/plain", "V1 in 0 1\n");
    const csv = await files.put(
      "op-0.csv",
      "text/csv",
      "name,value\nV(out),1\n",
    );

    const archive = await buildSimulationArtifactArchive(files, [deck, csv]);
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const entries = unzipSync(archive.bytes);
    expect(strFromU8(entries["netlist/prepared.cir"]!)).toBe("V1 in 0 1\n");
    expect(strFromU8(entries["results/op-0.csv"]!)).toBe(
      "name,value\nV(out),1\n",
    );
    expect(simulationArtifactCategory(deck)).toBe("Netlist");
    expect(simulationArtifactCategory(csv)).toBe("Results");
  });

  it("packages selected source and temporary artifacts into one hierarchy", async () => {
    const files = new SimulationFiles();
    const log = await files.put("run.log", "text/plain", "finished\n");
    const archive = await buildSimulationWorkspaceArchive(files, [
      {
        kind: "text",
        path: "Untitled/source/run.cir",
        text: "op\n",
      },
      { kind: "artifact", path: "run/log/run.log", artifact: log },
    ]);
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const entries = unzipSync(archive.bytes);
    expect(strFromU8(entries["Untitled/source/run.cir"]!)).toBe("op\n");
    expect(strFromU8(entries["run/log/run.log"]!)).toBe("finished\n");
  });
});
