import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import type { CircuitProject } from "@icm/model";

import {
  ProjectFormatError,
  type ProjectDiagnostic,
  type ProjectLoadResult,
  type ProjectParseResult,
} from "./diagnostics.js";
import {
  ProjectMigrationError,
  upgradeSchema29To30,
} from "./previous-to-current.js";
import { PREVIOUS_PROJECT_SCHEMA_VERSION } from "./version.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidProjectDiagnostics(
  input: unknown,
): readonly ProjectDiagnostic[] {
  const result = CircuitProjectSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code: "INVALID_PROJECT" as const,
    message: issue.message,
    path: issue.path.map((segment) =>
      typeof segment === "symbol" ? (segment.description ?? "symbol") : segment,
    ),
  }));
}

export function tryValidateProject(input: unknown): ProjectLoadResult {
  const diagnostics = invalidProjectDiagnostics(input);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    project: CircuitProjectSchema.parse(input),
    sourceSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    migrated: false,
  };
}

export function validateProject(input: unknown): CircuitProject {
  const result = tryValidateProject(input);
  if (!result.ok) throw new ProjectFormatError(result.diagnostics);
  return result.project;
}

export function tryParseProjectWithMetadata(
  serialized: string,
): ProjectLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_JSON",
          message:
            error instanceof Error
              ? error.message
              : "Project is not valid JSON",
          path: [],
        },
      ],
    };
  }
  if (!isRecord(parsed) || !Number.isInteger(parsed.schemaVersion)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: "Project schemaVersion must be an integer",
          path: ["schemaVersion"],
        },
      ],
    };
  }

  const sourceSchemaVersion = parsed.schemaVersion as number;
  const migrated = sourceSchemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION;
  const supported = new Set([
    PREVIOUS_PROJECT_SCHEMA_VERSION,
    CURRENT_PROJECT_SCHEMA_VERSION,
  ]);
  if (!supported.has(sourceSchemaVersion)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `Project schemaVersion must be ${PREVIOUS_PROJECT_SCHEMA_VERSION} or ${CURRENT_PROJECT_SCHEMA_VERSION}`,
          path: ["schemaVersion"],
        },
      ],
    };
  }

  let current: Record<string, unknown>;
  try {
    current =
      sourceSchemaVersion === PREVIOUS_PROJECT_SCHEMA_VERSION
        ? upgradeSchema29To30(parsed)
        : parsed;
  } catch (error) {
    if (error instanceof ProjectMigrationError) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "INVALID_PROJECT",
            message: error.message,
            path: [...error.path],
          },
        ],
      };
    }
    throw error;
  }
  const diagnostics = invalidProjectDiagnostics(current);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    project: CircuitProjectSchema.parse(current),
    sourceSchemaVersion,
    migrated,
  };
}

export function parseProjectWithMetadata(
  serialized: string,
): ProjectParseResult {
  const result = tryParseProjectWithMetadata(serialized);
  if (!result.ok) throw new ProjectFormatError(result.diagnostics);
  return result;
}

export function parseProject(serialized: string): CircuitProject {
  return parseProjectWithMetadata(serialized).project;
}
