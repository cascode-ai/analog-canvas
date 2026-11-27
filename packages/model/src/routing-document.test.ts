import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  freezeSnapshot,
  isValidatedCell,
  parseOwnedDocument,
  prepareOwnedDocument,
  prepareWireCell,
  installPreparedWireCell,
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
  it("installs only the checked Cell from this exact Project and refuses changes to project-level facts", () => {
    const project = parseProjectSnapshot(sourceProject());
    const source = project.documents[0]!;
    const draft = {
      ...source,
      revision: 1,
      junctions: source.junctions.map((row) => ({
        ...row,
        position: { ...row.position, y: 20 },
      })),
    };
    const checked = prepareWireCell(
      draft,
      source,
      () => {},
      new Set(),
      project,
    );
    if (!checked.success) throw checked.error;
    expect(
      installPreparedWireCell(project, source, checked.data)?.documents[0],
    ).toBe(checked.data);
    expect(
      installPreparedWireCell(
        project,
        source,
        freezeSnapshot(structuredClone(checked.data)),
      ),
    ).toBeUndefined();
    const siblingWrite = parseProjectSnapshot(
      { ...project, name: "Renamed" },
      project,
    );
    expect(siblingWrite.documents[0]).toBe(source);
    expect(
      installPreparedWireCell(siblingWrite, source, checked.data),
    ).toBeUndefined();
    const weak = validateProjectResult(sourceProject());
    if (!weak.success) throw weak.error;
    Object.assign(weak.data, { unknown: undefined });
    const imported = parseProjectSnapshot(weak.data);
    const old = imported.documents[0]!;
    const unowned = prepareWireCell(draft, old, () => {}, new Set(), imported);
    if (!unowned.success) throw unowned.error;
    expect(
      installPreparedWireCell(imported, old, unowned.data),
    ).toBeUndefined();
    for (const other of [
      { ...draft, revision: source.revision + 2 },
      { ...draft, name: "Other" },
      {
        ...draft,
        instances: [{ id: "X", symbolId: "resistor", placement: null }],
      },
    ]) {
      const changed = prepareWireCell(
        other,
        source,
        () => {},
        new Set(),
        project,
      );
      if (!changed.success) throw changed.error;
      expect(
        installPreparedWireCell(project, source, changed.data),
      ).toBeUndefined();
    }
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

  it("retains unchanged frozen rows across all collections in prepareOwnedDocument", () => {
    const base = sourceProject();
    base.documents[0]!.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "R2", symbolId: "resistor", placement: null },
    );
    const snapshot = parseProjectSnapshot(base);
    const source = snapshot.documents[0]!;
    const edited = { ...source.instances[1]!, reference: "R2" };
    const draft = {
      ...source,
      revision: source.revision + 1,
      instances: [source.instances[0]!, edited],
    };
    const owned = prepareOwnedDocument(draft, source);
    expect(owned.success).toBe(true);
    if (!owned.success) return;
    expect(isValidatedCell(owned.data)).toBe(true);
    expect(owned.data.instances[0]).toBe(source.instances[0]);
    expect(owned.data.instances[1]).not.toBe(edited);
    expect(owned.data.routes[0]).toBe(source.routes[0]);
    expect(owned.data.nets[0]).toBe(source.nets[0]);
    expect(owned.data.presentation).toBe(source.presentation);

    const invalid = parseOwnedDocument(
      {
        ...draft,
        instances: [
          source.instances[0]!,
          { ...edited, extra: "bad" } as (typeof draft.instances)[number],
        ],
      },
      source,
    );
    expect(invalid.success).toBe(false);
  });
});
