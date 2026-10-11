import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createProjectCodeReader } from "./project-code-reader";
import {
  formatProjectCode,
  validateProjectCode,
  planProjectCodeCommit,
} from "./project-code";

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
