import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compareTopologyCorrespondence,
  projectElectricalGraph,
} from "@icm/netlist";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { projectWithTopologyRoot } from "./features/editor-shell/gallery-topology-project";
import { scanGalleryTopologyMatches } from "./gallery-topology-match";

function resistorProject(value = "1k", count = 2) {
  const project = createEmptyProject(`p-${value}-${count}`, "Drawing");
  const document = project.documents[0]!;
  document.instances = Array.from({ length: count }, (_, index) => ({
    id: `R${index + 1}`,
    reference: `R${index + 1}`,
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value },
    },
  }));
  document.nets = ["1", "2"].map((pinName) => ({
    id: pinName,
    terminals: document.instances.map(({ id }) => ({
      instanceId: id,
      pinName,
    })),
  }));
  return project;
}

function entry(id: string) {
  return {
    id,
    name: id,
    author: "Author",
    description: "",
    createdAt: "2026-09-20",
    schemaVersion: 60,
    previewRevision: "r1",
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

describe("current Gallery topology matching", () => {
  it("uses the visible Cell as the comparison root without changing the live Project", () => {
    const project = resistorProject();
    const child = structuredClone(project.documents[0]!);
    child.id = "child";
    child.name = "Child";
    project.documents.push(child);
    const rooted = projectWithTopologyRoot(project, child.id);
    expect(rooted.topDocumentId).toBe("child");
    expect(project.topDocumentId).not.toBe("child");
    expect(projectWithTopologyRoot(project, project.topDocumentId)).toBe(
      project,
    );
  });

  it("puts exact topologies first and ranks the nearest non-exact topology", async () => {
    const entries = [entry("partial"), entry("a-same-shape"), entry("z-exact")];
    const projects = new Map([
      ["partial", resistorProject("1k", 1)],
      ["a-same-shape", resistorProject("2k", 2)],
      ["z-exact", resistorProject("1k", 2)],
    ]);
    const report = await scanGalleryTopologyMatches(
      resistorProject(),
      () => {},
      async (input, init) => {
        expect(init?.credentials).toBe("omit");
        const url = new URL(String(input), "https://test.invalid");
        if (url.pathname === "/api/gallery")
          return json({ entries, total: entries.length, nextCursor: null });
        const id = url.pathname.split("/").pop()!;
        return json({
          status: "public",
          entry: entry(id),
          projectText: serializeProject(projects.get(id)!),
        });
      },
    );

    expect(report).toMatchObject({
      complete: true,
      scanned: 3,
      comparable: 3,
      total: 3,
      uncheckable: 0,
    });
    expect(
      report.matches.map(({ entry: candidate, exact, similarity }) => ({
        id: candidate.id,
        exact,
        similarity,
      })),
    ).toEqual([
      { id: "z-exact", exact: true, similarity: 1 },
      { id: "a-same-shape", exact: true, similarity: expect.any(Number) },
      {
        id: "partial",
        exact: false,
        similarity: expect.any(Number),
      },
    ]);
    expect(report.matches[0]!.netlistMatch).toBe("equal");
    expect(report.matches[1]!.netlistMatch).toBe("different");
    expect(report.matches[1]!.similarity).toBeCloseTo(0.94);
    expect(report.matches[1]!.structureSimilarity).toBe(1);
    expect(report.matches[1]!.parameterSimilarity).toBeCloseTo(0.6);
    expect(report.matches[1]!.pairs).toHaveLength(2);
    expect(report.matches[2]!.pairs).toHaveLength(1);
    expect(
      report.matches[1]!.candidate.documents[0]!.instances[0]!.netlist!
        .parameters.value,
    ).toBe("2k");
    expect(report.matches[2]!.similarity).toBeLessThan(1);
  });

  it("ranks close parameter values ahead of distant values regardless of listing order", async () => {
    const values = ["100k", "1.1k", "10k", "1000"];
    const report = await scanGalleryTopologyMatches(
      resistorProject(),
      () => {},
      async (input) => {
        const url = new URL(String(input), "https://test.invalid");
        if (url.pathname === "/api/gallery")
          return json({ entries: values.map(entry), nextCursor: null });
        const id = url.pathname.split("/").pop()!;
        return json({
          status: "public",
          entry: entry(id),
          projectText: serializeProject(resistorProject(id)),
        });
      },
    );
    expect(report.matches.map((match) => match.entry.id)).toEqual([
      "1000",
      "1.1k",
      "10k",
      "100k",
    ]);
    expect(report.matches.every((match) => match.exact)).toBe(true);
    expect(report.matches[0]!.netlistMatch).toBe("equal");
    expect(report.matches.map((match) => match.similarity)).toEqual(
      [...report.matches.map((match) => match.similarity)].sort(
        (a, b) => b - a,
      ),
    );
  });

  it("matches the built-in SKY130 OTA through its hierarchy and ranks size changes", () => {
    const source = parseProject(
      readFileSync(
        new URL(
          "./examples/five-transistor-ota-sky130.icproj.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const extract = (project: typeof source) => {
      const result = projectElectricalGraph(project);
      if (result.status !== "ready") throw new Error(result.reason);
      return result.graph;
    };
    const a = extract(source);
    const candidate = structuredClone(source);
    const transistor = candidate.documents
      .find((doc) => doc.id === "document-ota-5t")!
      .instances.find((item) => item.id === "M1")!;
    transistor.reference = "XRENAMED";
    transistor.netlist!.parameters.w = "99u";
    const near = compareTopologyCorrespondence(a, extract(candidate));
    expect(near).toMatchObject({
      exact: true,
      netlistMatch: "different",
      matchedDevices: 11,
      limited: false,
    });
    expect(
      near.pairs.find((pair) => pair.source.instanceId === "M1"),
    ).toMatchObject({
      source: { path: ["XDUT", "M1"] },
      target: { path: ["XDUT", "M1"], referencePath: ["XDUT", "XRENAMED"] },
    });
    transistor.netlist!.parameters.w = "960u";
    expect(near.similarity).toBeGreaterThan(
      compareTopologyCorrespondence(a, extract(candidate)).similarity,
    );
  });

  it("explains an uncheckable current Cell without reading the Gallery", async () => {
    let requests = 0;
    const report = await scanGalleryTopologyMatches(
      createEmptyProject("empty", "Empty"),
      () => {},
      async () => {
        requests++;
        return json({});
      },
    );
    expect(requests).toBe(0);
    expect(report).toMatchObject({
      complete: true,
      matches: [],
      sourceError: "No netlist devices to compare",
    });
  });

  it("uses captured source topology while comparing a freshly revised Gallery entry", async () => {
    const source = resistorProject();
    const report = await scanGalleryTopologyMatches(
      source,
      () => {},
      async (input) => {
        if (
          new URL(String(input), "https://test.invalid").pathname ===
          "/api/gallery"
        ) {
          // Even mutation after the asynchronous scan starts cannot alter the
          // source graph already extracted before the first network request.
          source.documents[0]!.instances.pop();
          return json({ entries: [entry("revised")], nextCursor: null });
        }
        return json({
          status: "public",
          entry: { ...entry("revised"), previewRevision: "r2" },
          projectText: serializeProject(resistorProject()),
        });
      },
    );
    expect(report).toMatchObject({
      comparable: 1,
      uncheckable: 0,
      complete: true,
    });
    expect(report.matches[0]).toMatchObject({
      exact: true,
      entry: { previewRevision: "r2" },
    });
  });

  it("keeps partial progress when a later Gallery page fails", async () => {
    let listReads = 0;
    const report = await scanGalleryTopologyMatches(
      resistorProject(),
      () => {},
      async (input) => {
        const url = new URL(String(input), "https://test.invalid");
        if (url.pathname === "/api/gallery") {
          listReads++;
          return listReads === 1
            ? json({ entries: [entry("first")], nextCursor: "older" })
            : json({}, 503);
        }
        return json({
          status: "public",
          entry: entry("first"),
          projectText: serializeProject(resistorProject()),
        });
      },
    );
    expect(report).toMatchObject({
      complete: false,
      scanned: 1,
      comparable: 1,
      error: "Could not read Gallery (503)",
    });
    expect(report.matches[0]).toMatchObject({ exact: true });
  });
});
