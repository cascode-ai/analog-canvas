import { agentDiagnosticIdentity } from "./diagnostics.js";
import type { AgentDiagnostic } from "./schema.js";

type Counts = { errors: number; warnings: number; total: number };

const ownedReports = new WeakMap<
  readonly AgentDiagnostic[],
  { keys?: string[]; counts?: Counts }
>();

/** The service owns committed reports. Their counts and identities ignore revision. */
export function retainDiagnosticReport(
  report: AgentDiagnostic[],
  restoredFrom?: AgentDiagnostic[],
): void {
  ownedReports.set(
    report,
    (restoredFrom && ownedReports.get(restoredFrom)) ?? {},
  );
}

export function diagnosticCounts(report: readonly AgentDiagnostic[]): Counts {
  const owned = ownedReports.get(report);
  if (owned?.counts) return owned.counts;
  const counts = { errors: 0, warnings: 0, total: report.length };
  for (const item of report) {
    if (item.severity === "error") counts.errors++;
    if (item.severity === "warning") counts.warnings++;
  }
  if (owned) owned.counts = counts;
  return counts;
}

export function diagnosticIdentityKeys(
  report: readonly AgentDiagnostic[],
): string[] {
  const owned = ownedReports.get(report);
  if (owned?.keys) return owned.keys;
  const keys = report.map(agentDiagnosticIdentity);
  if (owned) owned.keys = keys;
  return keys;
}

/** Added and removed findings between two states, as a receipt carries them. */
export function diagnosticDeltaOf(
  before: readonly AgentDiagnostic[],
  after: readonly AgentDiagnostic[],
  notes: readonly AgentDiagnostic[],
  detail: "full" | "compact" | undefined,
) {
  const added = [...notes];
  const removed: AgentDiagnostic[] = [];
  const removedIds: string[] = [];
  if (before !== after) {
    const beforeKeys = diagnosticIdentityKeys(before);
    const afterKeys = diagnosticIdentityKeys(after);
    const beforeIds = new Set(beforeKeys);
    const afterIds = new Set(afterKeys);
    for (const [index, key] of afterKeys.entries())
      if (!beforeIds.has(key)) added.push(after[index]!);
    for (const [index, key] of beforeKeys.entries()) {
      if (afterIds.has(key)) continue;
      if (detail === "compact") removedIds.push(key);
      else removed.push(before[index]!);
    }
  }
  return { added, removed, ...(detail === "compact" ? { removedIds } : {}) };
}
