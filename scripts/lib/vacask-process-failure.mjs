// VACASK reports some parser/model/solver errors on stdout. An empty stderr
// is not an empty diagnostic. Keep spawn errors, termination and both streams.
export function vacaskProcessFailure(result) {
  const termination = result.signal
    ? `signal ${result.signal}`
    : `exit ${result.status ?? "unknown"}`;
  return [
    result.error?.message,
    termination,
    result.stderr?.trim(),
    result.stdout?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
