import type { ProjectSimulationFolder } from "@icm/model";
import {
  resolveSimulationEngine,
  type Capabilities,
  type SimulationEngine,
} from "@icm/simulation-service";

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
  const native = lines.some((line) =>
    /^\s*(?:control|ground|include|parameters)\b/.test(line),
  );
  const spice = lines.some((line) =>
    /^\s*\.(?:control|include|lib|param|model|subckt|end)\b/i.test(line),
  );
  return native === spice ? undefined : native ? "vacask" : "ngspice";
}
