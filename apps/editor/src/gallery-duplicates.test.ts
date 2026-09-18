import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { scanGalleryDuplicates } from "./gallery-duplicates";

function projectText(value = "1k") {
  const project = createEmptyProject("p", "Drawing");
  const document = project.documents[0]!;
  document.instances = ["R1", "R2"].map((id) => ({
    id,
    reference: id,
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
  return serializeProject(project);
}
function entry(id: string) {
  return {
    id,
    name: id === "a" ? "First" : "Different name",
    author: "",
    description: "",
    createdAt: "2026-09-18",
    schemaVersion: 57,
    previewRevision: "r1",
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

describe("full Gallery duplicate scan", () => {
  it("reads every page independent of filters, groups netlists and reports failures separately", async () => {
    const urls: string[] = [];
    const fetchLike: typeof fetch = async (input, init) => {
      const url = new URL(String(input), "https://test.invalid");
      urls.push(url.pathname + url.search);
      expect(init?.credentials).toBe("omit");
      if (url.pathname === "/api/gallery")
        return json({
          entries: url.searchParams.has("cursor")
            ? [entry("c"), entry("bad")]
            : [entry("a"), entry("b")],
          nextCursor: url.searchParams.has("cursor") ? null : "page2",
          total: 4,
        });
      const id = url.pathname.split("/").pop()!;
      if (id === "bad") return json({}, 404);
      return json({
        status: "public",
        entry: entry(id),
        projectText: projectText(
          id === "c" ? "2k" : id === "b" ? "1000" : "1k",
        ),
      });
    };
    const report = await scanGalleryDuplicates(() => {}, fetchLike);
    expect(report).toMatchObject({
      complete: true,
      scanned: 4,
      comparable: 3,
      total: 4,
    });
    expect(report.groups.map((group) => group.map(({ id }) => id))).toEqual([
      ["a", "b"],
    ]);
    expect(report.uncheckable.map(({ entry }) => entry.id)).toEqual(["bad"]);
    expect(urls.filter((url) => url.startsWith("/api/gallery?"))).toEqual([
      "/api/gallery?limit=100",
      "/api/gallery?limit=100&cursor=page2",
    ]);
  });

  it("does not declare a truncated scan complete and detects non-advancing pagination", async () => {
    for (const cycle of [false, true]) {
      let page = 0;
      const report = await scanGalleryDuplicates(
        () => {},
        async () => {
          page++;
          if (!cycle && page > 1) return json({}, 503);
          return json({ entries: [], nextCursor: "repeated", total: 100 });
        },
      );
      expect(report.complete).toBe(false);
      expect(report.error).toContain(cycle ? "pagination" : "503");
    }
  });

  it("does not compare replaced, withdrawn or invalid circuits", async () => {
    const report = await scanGalleryDuplicates(
      () => {},
      async (input) => {
        if (String(input).includes("?"))
          return json({
            entries: [entry("changed"), entry("withdrawn"), entry("bad")],
            nextCursor: null,
          });
        const id = String(input).split("/").pop()!;
        return json({
          status: id === "withdrawn" ? "rejected" : "public",
          entry: {
            ...entry(id),
            previewRevision: id === "changed" ? "r2" : "r1",
          },
          projectText: id === "bad" ? "invalid" : projectText(),
        });
      },
    );
    expect(report).toMatchObject({ complete: true, comparable: 0, groups: [] });
    expect(report.uncheckable).toHaveLength(3);
  });

  it("honors cancellation rather than returning a completed report", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      scanGalleryDuplicates(() => {}, fetch, controller.signal),
    ).rejects.toThrow();
  });
});
