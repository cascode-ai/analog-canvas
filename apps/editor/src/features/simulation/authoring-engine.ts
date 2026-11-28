import type { ProjectSimulationFolder } from "@icm/model";
import type { Capabilities } from "@icm/simulation-service/contract";
// The narrow entry keeps the service runtime (executors, managed runs) off the
// Editor's first load; file-engine imports it when a run needs it (#1645).
import {
  resolveSimulationEngine,
  type SimulationEngine,
} from "@icm/simulation-service/profile-engine";

/** Editing is local. Discovery selects the execution engine, but an unavailable
 * executor must not prevent mapped edits to an unambiguous authored dialect.
 * This fallback is never used to admit or execute a run. */
export function authoringEngine(
  folder: ProjectSimulationFolder,
  caps?: Capabilities,
): SimulationEngine | undefined {
  if (caps) {
    const selected = resolveSimulationEngine(folder, caps);
    if (selected.ok) return selected.engine;
  }
  const entry =
    folder.input.files.find((file) => file.path === folder.input.entry)?.text ??
    "";
  const lines = entry.split(/\r?\n/).slice(1);
  const legacy = lines.some((line) =>
    /^\s*(?:control|ground|include|parameters)\b/.test(line),
  );
  const spice = lines.some((line) =>
    /^\s*\.(?:control|include|lib|param|model|subckt|end)\b/i.test(line),
  );
  return spice && !legacy ? "ngspice" : undefined;
}
