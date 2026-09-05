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
  upgradeSchema24To25,
  upgradeSchema25To26,
  upgradeSchema26To27,
  upgradeSchema27To28,
  upgradeSchema28To29,
  upgradeSchema29To30,
  upgradeSchema30To31,
  upgradeSchema31To32,
  upgradeSchema32To33,
  upgradeSchema33To34,
  upgradeSchema34To35,
  upgradeSchema35To36,
  upgradeSchema36To37,
  upgradeSchema37To38,
  upgradeSchema38To39,
  upgradeSchema39To40,
} from "./previous-to-current.js";
import { repairBoundFormatOverrides } from "./transforms/bound-format-override.js";
import { repairLegacyReviewedExternalReferences } from "./transforms/reviewed-external-reference.js";
import { OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION } from "./version.js";

/**
 * One upgrade step per historical version, oldest first: entry N carries a
 * Project from schemaVersion OLDEST + N to OLDEST + N + 1. A file loads by
 * running every step from its own version to the current one, so the whole
 * window stays honest as long as this chain stays contiguous.
 */
const UPGRADE_CHAIN: ReadonlyArray<
  (raw: Record<string, unknown>) => Record<string, unknown>
> = [
  upgradeSchema24To25,
  upgradeSchema25To26,
  upgradeSchema26To27,
  upgradeSchema27To28,
  upgradeSchema28To29,
  upgradeSchema29To30,
  upgradeSchema30To31,
  upgradeSchema31To32,
  upgradeSchema32To33,
  upgradeSchema33To34,
  upgradeSchema34To35,
  upgradeSchema35To36,
  upgradeSchema36To37,
  upgradeSchema37To38,
  upgradeSchema38To39,
  upgradeSchema39To40,
];

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
  if (
    sourceSchemaVersion < OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION ||
    sourceSchemaVersion > CURRENT_PROJECT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `Project schemaVersion must be between ${OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION} and ${CURRENT_PROJECT_SCHEMA_VERSION}`,
          path: ["schemaVersion"],
        },
      ],
    };
  }

  let current: Record<string, unknown>;
  try {
    current = parsed;
    for (
      let version = sourceSchemaVersion;
      version < CURRENT_PROJECT_SCHEMA_VERSION;
      version += 1
    ) {
      current =
        UPGRADE_CHAIN[version - OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION]!(
          current,
        );
    }
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
  // A bound format override is derived from the name it decorates. When the
  // two have drifted apart — #463 retired the leading-capital rule under
  // overrides already written and published — restore the text instead of
  // refusing the Project, because a file that will not open is, to its
  // author, a file that is gone.
  current = repairBoundFormatOverrides(current);
  const reviewedReferenceRepair =
    repairLegacyReviewedExternalReferences(current);
  current = reviewedReferenceRepair.project;
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
