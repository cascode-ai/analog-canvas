import { describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  freezeSnapshot,
} from "@icm/model";
import { serializeCompactProject } from "@icm/project-protocol";
import { EditorDocumentController } from "./document-controller";
import { createProjectSnapshotSerializer } from "./project-snapshot-serializer";

describe("committed project serialization reuse", () => {
  it("does not reuse stale text when a mutable caller changes the same object", () => {
    const project = createEmptyProject("mutable", "Before");
    const cache = createProjectSnapshotSerializer();
    cache.serializeCompact(project);
    project.name = "After";
    expect(cache.serializeCompact(project)).toBe(
      serializeCompactProject(project),
    );
    project.documents[0]!.instances.push({
      id: "invalid",
      symbolId: "resistor",
      placement: { position: { x: NaN, y: 0 }, rotation: 0, mirror: "none" },
    });
    expect(() => cache.serializeCompact(project)).toThrow();
  });
  it("serializes unchanged tabs once and leaves changed snapshots byte-identical", () => {
    const serialize = vi.fn(serializeCompactProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const first = new EditorDocumentController(
      createEmptyProject("same-id", "First"),
    );
    const second = new EditorDocumentController(
      createEmptyProject("same-id", "Second"),
    );
    const save = () =>
      [first, second].map((c) => cache.serializeCompact(c.project));
    const original = save();
    expect(save()).toEqual(original);
    expect(serialize).toHaveBeenCalledTimes(2);
    first.transact([
      {
        kind: "add_instance",
        instance: { id: "R1", symbolId: "resistor", placement: null },
      },
    ]);
    const edited = save();
    expect(edited).toEqual(
      [first, second].map((c) => serializeCompactProject(c.project)),
    );
    expect(edited[0]).not.toBe(original[0]);
    expect(serialize).toHaveBeenCalledTimes(3);
    first.transact([{ kind: "undo" }]);
    expect(save()[0]).toBe(serializeCompactProject(first.project));
    first.transact([{ kind: "redo" }]);
    expect(save()[0]).toBe(serializeCompactProject(first.project));
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("does not confuse inactive Cell edits, project replacements or equal revisions", () => {
    const input = createEmptyProject("hierarchy", "Hierarchy");
    input.documents.push(createEmptyDocument("child", "Child"));
    const controller = new EditorDocumentController(input);
    const serialize = vi.fn(serializeCompactProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const before = cache.serializeCompact(controller.project);
    controller.openDocument("child");
    expect(cache.serializeCompact(controller.project)).toBe(before);
    controller.transact([
      {
        kind: "add_instance",
        instance: { id: "Rchild", symbolId: "resistor", placement: null },
      },
    ]);
    controller.openDocument(input.topDocumentId);
    expect(cache.serializeCompact(controller.project)).toBe(
      serializeCompactProject(controller.project),
    );
    expect(cache.serializeCompact(controller.project)).not.toBe(before);
    controller.replaceProject({ ...controller.project, name: "Renamed" });
    expect(cache.serializeCompact(controller.project)).toBe(
      serializeCompactProject(controller.project),
    );
    expect(serialize).toHaveBeenCalledTimes(3);
  });

  it("bounds retained entries, evicts least-recently-used snapshots and releases closed tabs", () => {
    const projects = ["a", "b", "c"].map((id) =>
      freezeSnapshot(createEmptyProject(id, id)),
    );
    const serialize = vi.fn((p: (typeof projects)[number]) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 2,
      bytes: 100,
    });
    cache.serializeCompact(projects[0]!);
    cache.serializeCompact(projects[1]!);
    cache.serializeCompact(projects[0]!);
    cache.serializeCompact(projects[2]!);
    cache.serializeCompact(projects[1]!);
    expect(serialize).toHaveBeenCalledTimes(4);
    cache.retain([projects[1]!]);
    cache.serializeCompact(projects[1]!);
    cache.serializeCompact(projects[2]!);
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("bounds text memory and does not retain oversized text or failed serialization", () => {
    const a = freezeSnapshot(createEmptyProject("a", "ab"));
    const b = freezeSnapshot(createEmptyProject("b", "cd"));
    const serialize = vi.fn((p: typeof a) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 10,
      bytes: 4,
    });
    cache.serializeCompact(a);
    cache.serializeCompact(b);
    cache.serializeCompact(a);
    expect(serialize).toHaveBeenCalledTimes(3);
    const large = freezeSnapshot({ ...a, name: "too large" });
    cache.serializeCompact(large);
    cache.serializeCompact(large);
    expect(serialize).toHaveBeenCalledTimes(5);
    serialize.mockImplementationOnce(() => {
      throw new Error("invalid");
    });
    expect(() => cache.serializeCompact(b)).toThrow("invalid");
    expect(cache.serializeCompact(b)).toBe("cd");
    expect(serialize).toHaveBeenCalledTimes(7);
  });
});

it("keeps a useful bounded cache when the open workspace exceeds its entry budget", () => {
  const projects = Array.from({ length: 20 }, (_, i) =>
    freezeSnapshot(createEmptyProject(`tab-${i}`, `Tab ${i}`)),
  );
  const serialize = vi.fn(serializeCompactProject);
  const cache = createProjectSnapshotSerializer(serialize);
  const save = () => {
    cache.retain(projects);
    return projects.map((p) => cache.serializeCompact(p));
  };
  const first = save();
  expect(save()).toEqual(first);
  expect(save()).toEqual(first);
  // Four misses per pass, rather than evicting every unchanged open tab.
  expect(serialize).toHaveBeenCalledTimes(28);
});
