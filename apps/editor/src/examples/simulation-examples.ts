import { parseProject } from "@icm/project-protocol";
import { normalizeImportedProject } from "../document/project-import-normalization";
import { createProjectSymbolResolver, builtInSymbols } from "@icm/symbols";
import rc from "./simulation-rc.icproj.json";
import rlc from "./simulation-rlc.icproj.json";
import commonSource from "./simulation-common-source.icproj.json";
import ota from "./simulation-ota.icproj.json";

/** Simulation-only resources, not Gallery entries. */
export const simulationExamples = [
  {
    id: "rc",
    name: "RC Filters",
    description: "Low-pass & high-pass",
    source: rc,
  },
  {
    id: "rlc",
    name: "RLC Filter",
    description: "Damping & resonance",
    source: rlc,
  },
  {
    id: "common-source",
    name: "Common-source Amplifier",
    description: "Bias, gain & distortion",
    source: commonSource,
  },
  {
    id: "ota",
    name: "OTA Amplifier",
    description: "Open & closed loop",
    source: ota,
  },
] as const;

export function createSimulationExample(id: string) {
  const entry = simulationExamples.find((example) => example.id === id);
  if (!entry) throw new Error("Unknown simulation example");
  const parsed = parseProject(JSON.stringify(entry.source));
  const project = normalizeImportedProject(
    parsed,
    createProjectSymbolResolver(parsed, builtInSymbols),
  ).project;
  project.id = `simulation-example-${crypto.randomUUID()}`;
  return project;
}
