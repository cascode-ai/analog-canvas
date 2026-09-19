import { describe, expect, it } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";

import { fillGalleryDeviceModels } from "./gallery-device-models";
import { createNetlistExportProfile } from "./features/netlist-export/netlist-process-presets";

function circuit(name: string, model?: string): CircuitProject {
  const project = createEmptyProject(name, name);
  project.documents[0]!.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "nmos",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      ...(model
        ? {
            binding: {
              kind: "model" as const,
              deviceClass: "mos" as const,
              name: model,
            },
            parameters: { w: "4u", l: "180n", m: "1", nf: "1" },
          }
        : { parameters: {} }),
    },
  });
  return project;
}

/** A Gallery that answers reads and remembers what was written back. */
function gallery(entries: Array<{ id: string; project: CircuitProject }>) {
  const stored = new Map(
    entries.map(({ id, project }) => [id, serializeProject(project)]),
  );
  const writes: string[] = [];
  const fetchLike = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PUT") {
      const id = url.split("/").pop()!;
      const body = JSON.parse(String(init.body)) as {
        name: string;
        description: string;
        tags: string[];
        projectText: string;
      };
      expect(body.name).toBe(id);
      expect(body.tags).toEqual(["amplifier"]);
      stored.set(id, body.projectText);
      writes.push(id);
      return new Response("{}", { status: 200 });
    }
    if (url.startsWith("/api/gallery?")) {
      return Response.json({
        entries: [...stored.keys()].map((id) => ({
          id,
          name: id,
          description: "",
          tags: ["amplifier"],
        })),
        total: stored.size,
        nextCursor: null,
      });
    }
    const id = url.split("/").pop()!;
    return Response.json({
      status: "public",
      projectText: stored.get(id),
      entry: { id, name: id, description: "", tags: ["amplifier"] },
    });
  }) as unknown as typeof fetch;
  return { stored, writes, fetchLike };
}

describe("filling stored circuits with the process they were drawn without", () => {
  it("writes the missing models and leaves authored ones alone", async () => {
    const shelf = gallery([
      { id: "bare", project: circuit("bare") },
      { id: "authored", project: circuit("authored", "NMOS") },
    ]);

    const report = await fillGalleryDeviceModels(
      createNetlistExportProfile("sky130"),
      () => {},
      shelf.fetchLike,
    );

    expect(report).toMatchObject({
      scanned: 2,
      filled: 1,
      instances: 1,
      complete: true,
    });
    expect(report.failures).toHaveLength(0);
    expect(shelf.writes).toEqual(["bare"]);
    expect(shelf.stored.get("bare")).toContain("sky130_fd_pr__nfet_01v8");

    const authored = parseProject(shelf.stored.get("authored")!);
    const binding = authored.documents[0]!.instances[0]!.netlist?.binding;
    expect(binding?.kind === "model" && binding.name).toBe("NMOS");

    // Settled: a second pass finds nothing to write.
    const again = await fillGalleryDeviceModels(
      createNetlistExportProfile("sky130"),
      () => {},
      shelf.fetchLike,
    );
    expect(again).toMatchObject({ filled: 0, instances: 0, complete: true });
  });

  it("keeps going past a circuit it cannot read, and names it", async () => {
    const shelf = gallery([{ id: "bare", project: circuit("bare") }]);
    const failing = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith("/bare") && init?.method !== "PUT")
        return new Response("nope", { status: 500 });
      return shelf.fetchLike(input, init);
    }) as unknown as typeof fetch;

    const report = await fillGalleryDeviceModels(
      createNetlistExportProfile("sky130"),
      () => {},
      failing,
    );

    expect(report.complete).toBe(true);
    expect(report.filled).toBe(0);
    expect(report.failures).toEqual([
      { id: "bare", name: "bare", message: "Could not read Gallery (500)" },
    ]);
  });
});
