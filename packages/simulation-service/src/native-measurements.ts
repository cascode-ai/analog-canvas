import { parseSpiceSource } from "@icm/spice";
import type { SimulationOutputData } from "./contract.js";

/**
 * ngspice owns measurement evaluation. Read its scalar reports without guessing
 * which raw plot a loop iteration belongs to. Log line/occurrence are evidence.
 */
export function nativeMeasurementResults(
  files: readonly { path: string; text: string }[],
  entry: string,
  log: string,
): NonNullable<SimulationOutputData["nativeMeasurements"]> {
  const declarations = new Map<string, string>();
  for (const file of files) {
    if (file.path.endsWith(".json")) continue;
    for (const statement of parseSpiceSource(
      {
        id: file.path,
        path: file.path,
        text: file.text,
        hash: "",
        encoding: "utf-8",
      },
      { titleLine: file.path === entry },
    ).statements) {
      const command =
        statement.kind === "control_command"
          ? statement.command
          : statement.kind === "directive"
            ? statement.name
            : "";
      if (!["meas", "measure"].includes(command.toLowerCase())) continue;
      const args = "arguments" in statement ? statement.arguments : [];
      const name = args[1];
      if (name && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
        declarations.set(name.toLowerCase(), name);
    }
  }
  const result: NonNullable<SimulationOutputData["nativeMeasurements"]> = [];
  const counts = new Map<string, number>();
  log.split(/\r?\n/u).forEach((line, index) => {
    const match =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?=\s|$)/u.exec(
        line,
      );
    const key = match?.[1]?.toLowerCase();
    if (!match || !key || !declarations.has(key)) return;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) return;
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    result.push({
      name: declarations.get(key)!,
      occurrence,
      status: "available",
      value,
      logLine: index + 1,
      detail: line.trim(),
    });
  });
  for (const [key, name] of declarations)
    if (!counts.has(key))
      result.push({
        name,
        occurrence: 0,
        status: "unavailable",
        detail:
          "No finite scalar was reported by ngspice. The command may have failed or not executed; inspect Console.",
      });
  return result;
}
