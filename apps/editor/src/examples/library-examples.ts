import type { CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";

import commonSourceAmplifier from "./common-source-amplifier.icproj.json";
import currentMirrorLoadedDifferentialPair from "./current-mirror-loaded-differential-pair.icproj.json";
import fullyDifferentialTwoStageOpAmp from "./fully-differential-two-stage-op-amp.icproj.json";
import twoStageOpAmp from "./two-stage-op-amp.icproj.json";
import fiveTransistorOtaSky130 from "./five-transistor-ota-sky130.icproj.json";

export interface LibraryProjectExample {
  id: string;
  name: string;
  description: string;
  project: CircuitProject;
}

function bundledProject(source: unknown): CircuitProject {
  return parseProject(JSON.stringify(source));
}

/**
 * Curated, browser-bundled Projects shown in the left Library. Each asset is
 * parsed at module initialization so an invalid example fails during the
 * editor build rather than replacing a user's live Project at runtime.
 */
export const libraryProjectExamples: readonly LibraryProjectExample[] = [
  {
    id: "common-source-amplifier",
    name: "Common-Source Amplifier",
    description: "Small-signal NMOS gain stage",
    project: bundledProject(commonSourceAmplifier),
  },
  {
    id: "two-stage-op-amp",
    name: "Two-Stage Op Amp",
    description: "Miller-compensated amplifier",
    project: bundledProject(twoStageOpAmp),
  },
  {
    id: "current-mirror-loaded-differential-pair",
    name: "Current-Mirror-Loaded Differential Pair",
    description: "NMOS differential pair with PMOS active load",
    project: bundledProject(currentMirrorLoadedDifferentialPair),
  },
  {
    id: "fully-differential-two-stage-op-amp",
    name: "Fully Differential Two-Stage Op Amp",
    description: "Differential CMOS amplifier with capacitive loads",
    project: bundledProject(fullyDifferentialTwoStageOpAmp),
  },
  {
    id: "five-transistor-ota-sky130",
    name: "Five-Transistor OTA (Sky130)",
    description: "Textbook 5T OTA as a Cell, with its testbench",
    project: bundledProject(fiveTransistorOtaSky130),
  },
];

export function createLibraryExampleProject(
  exampleId: string,
): CircuitProject | null {
  const example = libraryProjectExamples.find(
    (candidate) => candidate.id === exampleId,
  );
  return example ? structuredClone(example.project) : null;
}
