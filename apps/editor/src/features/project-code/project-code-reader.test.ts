import { expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createProjectCodeReader } from "./project-code-reader";
import {
  formatProjectCode,
  validateProjectCode,
  planProjectCodeCommit,
} from "./project-code";
import { EditorDocumentController } from "../../document/document-controller";
import { createProjectSnapshotSerializer } from "../../document/project-snapshot-serializer";

it("reads recovery's canonical bytes without encoding again and still validates edited text", () => {
  const controller = new EditorDocumentController(
    createEmptyProject("shared-text", "Shared text"),
  );
  const encode = vi.fn(formatProjectCode);
  const serializer = createProjectSnapshotSerializer(encode);
  const saved = serializer.serialize(controller.project);
  const read = vi.fn(serializer.serialize);
  const reader = createProjectCodeReader(controller.project, read);
  expect(reader.baseline).toBe(saved);
  expect(reader.validate(saved)).toEqual({ ok: true });
  expect(reader.validate("{").ok).toBe(false);
  expect(encode).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(controller.project);
});

it("keeps full Project text and errors current across source, owner and commit changes", () => {
  const project = createEmptyProject("same-id", "First");
  const reader = createProjectCodeReader(project);
  expect(reader.baseline).toBe(formatProjectCode(project));
  for (const source of [
    reader.baseline,
    "{",
    reader.baseline.replace('"First"', '"Second"'),
    reader.baseline,
  ]) {
    const result = validateProjectCode(source, project.id);
    expect(reader.validate(source)).toEqual(result.ok ? { ok: true } : result);
  }
  const changed = structuredClone(project);
  changed.name = "Changed elsewhere";
  expect(createProjectCodeReader(changed).baseline).toContain(
    '"Changed elsewhere"',
  );
  expect(reader.baseline).toContain('"First"');
  const plan = planProjectCodeCommit(
    project,
    reader.baseline.replace('"First"', '"Second"'),
    project.topDocumentId,
  );
  expect(plan.ok).toBe(true);
  if (plan.ok) plan.project.name = "Mutable candidate";
  expect(reader.validate(reader.baseline)).toEqual({ ok: true });
  expect(JSON.parse(reader.baseline).name).toBe("First");
});
