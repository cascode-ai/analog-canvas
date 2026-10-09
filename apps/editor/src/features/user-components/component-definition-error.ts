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
