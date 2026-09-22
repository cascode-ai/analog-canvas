import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { EditorDocumentController } from "./document-controller";
import { createProjectSnapshotSerializer } from "./project-snapshot-serializer";

describe("committed project serialization reuse", () => {
  it("serializes unchanged tabs once and leaves changed snapshots byte-identical", () => {
    const serialize = vi.fn(serializeProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const first = new EditorDocumentController(
      createEmptyProject("same-id", "First"),
    );
    const second = new EditorDocumentController(
      createEmptyProject("same-id", "Second"),
    );
    const save = () => [first, second].map((c) => cache.serialize(c.project));
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
      [first, second].map((c) => serializeProject(c.project)),
    );
    expect(edited[0]).not.toBe(original[0]);
    expect(serialize).toHaveBeenCalledTimes(3);
    first.transact([{ kind: "undo" }]);
    expect(save()[0]).toBe(serializeProject(first.project));
    first.transact([{ kind: "redo" }]);
    expect(save()[0]).toBe(serializeProject(first.project));
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("does not confuse inactive Cell edits, project replacements or equal revisions", () => {
    const input = createEmptyProject("hierarchy", "Hierarchy");
    input.documents.push(createEmptyDocument("child", "Child"));
    const controller = new EditorDocumentController(input);
    const serialize = vi.fn(serializeProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const before = cache.serialize(controller.project);
    controller.openDocument("child");
    expect(cache.serialize(controller.project)).toBe(before);
    controller.transact([
      {
        kind: "add_instance",
        instance: { id: "Rchild", symbolId: "resistor", placement: null },
      },
    ]);
    controller.openDocument(input.topDocumentId);
    expect(cache.serialize(controller.project)).toBe(
      serializeProject(controller.project),
    );
    expect(cache.serialize(controller.project)).not.toBe(before);
    controller.replaceProject({ ...controller.project, name: "Renamed" });
    expect(cache.serialize(controller.project)).toBe(
      serializeProject(controller.project),
    );
    expect(serialize).toHaveBeenCalledTimes(3);
  });

  it("bounds retained entries, evicts least-recently-used snapshots and releases closed tabs", () => {
    const projects = ["a", "b", "c"].map((id) => createEmptyProject(id, id));
    const serialize = vi.fn((p: (typeof projects)[number]) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 2,
      bytes: 100,
    });
    cache.serialize(projects[0]!);
    cache.serialize(projects[1]!);
    cache.serialize(projects[0]!);
    cache.serialize(projects[2]!);
    cache.serialize(projects[1]!);
    expect(serialize).toHaveBeenCalledTimes(4);
    cache.retain([projects[1]!]);
    cache.serialize(projects[1]!);
    cache.serialize(projects[2]!);
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("bounds text memory and does not retain oversized text or failed serialization", () => {
    const a = createEmptyProject("a", "ab");
    const b = createEmptyProject("b", "cd");
    const serialize = vi.fn((p: typeof a) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 10,
      bytes: 4,
    });
    cache.serialize(a);
    cache.serialize(b);
    cache.serialize(a);
    expect(serialize).toHaveBeenCalledTimes(3);
    const large = { ...a, name: "too large" };
    cache.serialize(large);
    cache.serialize(large);
    expect(serialize).toHaveBeenCalledTimes(5);
    serialize.mockImplementationOnce(() => {
      throw new Error("invalid");
    });
    expect(() => cache.serialize(b)).toThrow("invalid");
    expect(cache.serialize(b)).toBe("cd");
    expect(serialize).toHaveBeenCalledTimes(7);
  });
});
