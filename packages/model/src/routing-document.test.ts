import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createRoutePath,
  parseProjectSnapshot,
  parseRoutingDocument,
  parseOwnedRoutingDocument,
  validateProjectResult,
  validateProjectSnapshot,
} from "./index.js";

function sourceProject() {
  const project = createEmptyProject("project", "Wire test", "main");
  const document = project.documents[0]!;
  document.nets.push({ id: "n", terminals: [] });
  document.junctions.push(
    { id: "a", netId: "n", position: { x: 0, y: 0 } },
    { id: "b", netId: "n", position: { x: 10, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "r",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return project;
}

describe("owned routing candidates", () => {
  it("retains only unchanged routing records of the validated source Cell", () => {
    const source = parseProjectSnapshot(sourceProject()).documents[0]!;
    const copy = structuredClone(source.junctions[1]!);
    const draft = {
      ...source,
      junctions: [source.junctions[0]!, copy],
      revision: 1,
    };
    const memberships: string[] = [];
    const result = parseOwnedRoutingDocument(draft, source, (read) =>
      memberships.push(read({ junctionId: "a" })!),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.routes[0]).toBe(source.routes[0]);
    expect(result.data.nets[0]).toBe(source.nets[0]);
    expect(result.data.junctions[0]).toBe(source.junctions[0]);
    expect(result.data.junctions[1]).not.toBe(copy);
    expect(memberships).toEqual(["n"]);
    const publicResult = parseRoutingDocument(draft, () => {});
    expect(publicResult.data).toEqual(result.data);
    expect(publicResult.data?.routes[0]).not.toBe(source.routes[0]);
  });
  it("preserves canonical errors for edited rows, invalid relationships and untrusted sources", () => {
    const original = sourceProject(),
      source = parseProjectSnapshot(original).documents[0]!;
    const malformed = { ...source.nets[0]!, extra: "invalid" };
    const cases: [typeof source, typeof source][] = [
      [source, { ...source, nets: [malformed] }],
      [source, { ...source, nets: [] }],
      [
        { ...source, nets: [malformed] },
        { ...source, nets: [malformed] },
      ],
    ];
    for (const [previous, draft] of cases) {
      const memberships: string[] = [];
      const canonical = parseRoutingDocument(draft, () =>
        memberships.push("canonical"),
      );
      const owned = parseOwnedRoutingDocument(draft, previous, () =>
        memberships.push("owned"),
      );
      expect(owned.error?.issues).toEqual(canonical.error?.issues);
      expect(canonical.success).toBe(false);
      expect(memberships).toEqual([]);
    }
  });

  it("does not trust row shape from a detached public receipt by its JSON fingerprint", () => {
    const publicResult = validateProjectResult(sourceProject());
    if (!publicResult.success) throw publicResult.error;
    Object.assign(publicResult.data.documents[0]!.nets[0]!, {
      unknown: undefined,
    });
    const validated = validateProjectSnapshot(publicResult.data);
    if (!validated.success) return;
    const source = parseProjectSnapshot(validated.data).documents[0]!;
    const canonical = parseRoutingDocument(source, () => {});
    const candidate = parseOwnedRoutingDocument(source, source, () => {});
    expect(candidate.error?.issues).toEqual(canonical.error?.issues);
  });
});
