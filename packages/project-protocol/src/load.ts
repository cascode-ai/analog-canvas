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
  upgradeSchema40To41,
  upgradeSchema41To42,
  upgradeSchema42To43,
  upgradeSchema43To44,
  upgradeSchema44To45,
  upgradeSchema45To46,
  upgradeSchema46To47,
  upgradeSchema47To48,
  upgradeSchema48To49,
} from "./previous-to-current.js";
import { repairBoundFormatOverrides } from "./transforms/bound-format-override.js";
import { OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION } from "./version.js";
import { upgradeSchema49To50 } from "./transforms/simulation-folders.js";
import { upgradeSchema50To51 } from "./transforms/drafting-shape-paint.js";
import { upgradeSchema51To52 } from "./transforms/mirror-directions.js";
import { upgradeSchema52To53 } from "./transforms/rotation-steps.js";
import { upgradeSchema53To54 } from "./transforms/parameter-annotations.js";
import { upgradeSchema54To55 } from "./transforms/arrow-end-styles.js";
import { upgradeSchema55To56 } from "./transforms/route-line-style.js";
import { upgradeSchema56To57 } from "./transforms/power-rail-terminals.js";
import {
  CURRENT_PROJECT_FILE_VERSION,
  decodeProjectFile,
} from "./owned-project-file.js";

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
  upgradeSchema40To41,
  upgradeSchema41To42,
  upgradeSchema42To43,
  upgradeSchema43To44,
  upgradeSchema44To45,
  upgradeSchema45To46,
  upgradeSchema46To47,
  upgradeSchema47To48,
  upgradeSchema48To49,
  upgradeSchema49To50,
  upgradeSchema50To51,
  upgradeSchema51To52,
  upgradeSchema52To53,
  upgradeSchema53To54,
  upgradeSchema54To55,
  upgradeSchema55To56,
  upgradeSchema56To57,
  (raw) => ({ ...raw, schemaVersion: 58 }),
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
  const migrated = sourceSchemaVersion !== CURRENT_PROJECT_FILE_VERSION;
  if (
    sourceSchemaVersion < OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION ||
    sourceSchemaVersion > CURRENT_PROJECT_FILE_VERSION
  ) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `Project schemaVersion must be between ${OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION} and ${CURRENT_PROJECT_FILE_VERSION}`,
          path: ["schemaVersion"],
        },
      ],
    };
  }

  let current: Record<string, unknown>;
  try {
    current = sourceSchemaVersion >= 59 ? decodeProjectFile(parsed) : parsed;
    for (
      let version = current.schemaVersion as number;
      version < CURRENT_PROJECT_SCHEMA_VERSION;
      version += 1
    ) {
      current =
        UPGRADE_CHAIN[version - OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION]!(
          current,
        );
    }
  } catch (error) {
    if (error instanceof ProjectFormatError)
      return { ok: false, diagnostics: error.diagnostics };
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
  // SPICE invocation prefixes belong to export, never to file loading.
  current = repairBoundFormatOverrides(current);
  const diagnostics = invalidProjectDiagnostics(current);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const project = CircuitProjectSchema.parse(current);
  if (project.componentDefinitions) {
    const definitions = new Map(
      project.componentDefinitions.map((definition) => [
        definition.symbol.id,
        definition.symbol,
      ]),
    );
    for (const document of project.documents) {
      const uses = [
        ...document.instances.map((instance) => ({
          id: instance.symbolId,
          variant: instance.symbolVariantId,
        })),
        ...(document.drafting?.objects ?? []).flatMap((object) =>
          object.kind === "floating-symbol"
            ? [{ id: object.symbolId, variant: undefined }]
            : [],
        ),
      ];
      for (const use of uses) {
        const definition = definitions.get(use.id);
        if (
          !definition ||
          (use.variant &&
            !definition.variants.some((variant) => variant.id === use.variant))
        )
          return {
            ok: false,
            diagnostics: [
              {
                code: "INVALID_PROJECT",
                path: ["componentDefinitions"],
                message: `Missing included component definition or variant: ${use.id}${use.variant ? `/${use.variant}` : ""}`,
              },
            ],
          };
      }
    }
  }
  return {
    ok: true,
    project,
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
