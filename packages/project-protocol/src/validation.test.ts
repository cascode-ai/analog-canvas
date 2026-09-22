import { afterEach, describe, expect, it, vi } from "vitest";
import { CircuitProjectSchema, createEmptyProject } from "@icm/model";
import {
  tryParseProjectWithMetadata,
  tryValidateProject,
  validateProject,
} from "./load.js";
import { ProjectFormatError } from "./diagnostics.js";

afterEach(() => vi.restoreAllMocks());

describe("single-pass project validation", () => {
  it("retains parsed defaults and owned copies without parsing valid input twice", () => {
    const input = createEmptyProject("validation", "Validation");
    const expected = CircuitProjectSchema.parse(input);
    const safeParse = vi.spyOn(CircuitProjectSchema, "safeParse");
    const parse = vi.spyOn(CircuitProjectSchema, "parse");
    const result = tryValidateProject(input);
    expect(result).toMatchObject({
      ok: true,
      project: expected,
      migrated: false,
    });
    if (!result.ok) throw new Error("Expected valid project");
    expect(result.project).not.toBe(input);
    expect(result.project.documents[0]).not.toBe(input.documents[0]);
    expect(safeParse).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("loads an in-memory schema file with the same validation result and one pass", () => {
    const input = createEmptyProject("load", "Load");
    const safeParse = vi.spyOn(CircuitProjectSchema, "safeParse");
    const parse = vi.spyOn(CircuitProjectSchema, "parse");
    expect(tryParseProjectWithMetadata(JSON.stringify(input))).toMatchObject({
      ok: true,
      project: input,
      sourceSchemaVersion: input.schemaVersion,
    });
    expect(safeParse).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("preserves every diagnostic path, message, order and throwing boundary", () => {
    const input = {
      ...createEmptyProject("bad", "Bad"),
      name: 42,
      documents: [],
    };
    const result = CircuitProjectSchema.safeParse(input);
    if (result.success) throw new Error("Expected invalid project");
    const diagnostics = result.error.issues.map((issue) => ({
      code: "INVALID_PROJECT",
      message: issue.message,
      path: issue.path.map((part) =>
        typeof part === "symbol" ? (part.description ?? "symbol") : part,
      ),
    }));
    expect(tryValidateProject(input)).toEqual({ ok: false, diagnostics });
    expect(tryParseProjectWithMetadata(JSON.stringify(input))).toEqual({
      ok: false,
      diagnostics,
    });
    try {
      validateProject(input);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFormatError);
      expect((error as ProjectFormatError).diagnostics).toEqual(diagnostics);
      expect((error as Error).message).toBe(
        diagnostics.map((d) => d.message).join("; "),
      );
    }
  });
});
