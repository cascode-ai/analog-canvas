import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { SourceSpanSchema } from "@icm/model";

/** Preserve located parser issues for discovery; UI can show only the first message. */
export function componentDefinitionDiagnostics(
  error: unknown,
  componentId: string,
): NonNullable<ComponentLibrarySummary["diagnostics"]> {
  const issues =
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
      ? error.issues
      : [];
  const located = issues.flatMap((issue: unknown) => {
    if (
      !issue ||
      typeof issue !== "object" ||
      !("message" in issue) ||
      typeof issue.message !== "string"
    )
      return [];
    const path =
      "path" in issue && Array.isArray(issue.path)
        ? issue.path.filter(
            (part): part is string | number =>
              typeof part === "string" ||
              (typeof part === "number" && Number.isInteger(part)),
          )
        : [];
    const sourceRef = SourceSpanSchema.safeParse(
      "sourceRef" in issue ? issue.sourceRef : undefined,
    );
    return [
      {
        componentId,
        path,
        message: issue.message,
        recovery: "edit-definition" as const,
        ...("file" in issue && typeof issue.file === "string"
          ? { file: issue.file }
          : {}),
        ...(sourceRef.success ? { sourceRef: sourceRef.data } : {}),
      },
    ];
  });
  return located.length
    ? located
    : [
        {
          componentId,
          path: [],
          message: definitionError(error),
          recovery: "edit-definition",
        },
      ];
}

/** Keep definition refusals concise and located at the first repairable issue. */
export function definitionError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const first = (
      error.issues as Array<{ path: unknown[]; message: string }>
    )[0];
    if (first) return `${first.path.join(".")}: ${first.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
