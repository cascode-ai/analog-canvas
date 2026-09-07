import type {
  SimulationInputMetadata,
  SimulationEnvironmentFacts,
  SimulationEnvironmentMetadata,
  SimulationConfigurationMetadata,
  ModelLibrarySelection,
} from "./contract.js";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createSimulationInputMetadata(input: {
  inputRevision?: string;
  netlist: string;
  testbench: string;
  deck: string;
}): Promise<SimulationInputMetadata> {
  const [netlistSha256, testbenchSha256, deckSha256] = await Promise.all([
    sha256Hex(input.netlist),
    sha256Hex(input.testbench),
    sha256Hex(input.deck),
  ]);
  return {
    inputRevision: input.inputRevision ?? null,
    netlistSha256,
    testbenchSha256,
    deckSha256,
  };
}

function canonicalEnvironmentFacts(facts: SimulationEnvironmentFacts): string {
  return JSON.stringify({
    executor: facts.executor,
    reproducibility: facts.reproducibility,
    profileId: facts.profileId,
    platform: facts.platform,
    simulator: {
      name: facts.simulator.name,
      version: facts.simulator.version,
      binarySha256: facts.simulator.binarySha256,
    },
    models: facts.models
      ? { id: facts.models.id, contentSha256: facts.models.contentSha256 }
      : null,
    startupSha256: facts.startupSha256,
  });
}

export async function createSimulationEnvironmentMetadata(
  facts: SimulationEnvironmentFacts,
): Promise<SimulationEnvironmentMetadata> {
  return {
    ...facts,
    fingerprint: await sha256Hex(canonicalEnvironmentFacts(facts)),
  };
}

export function simulationConfigurationMetadata(
  modelLibrary: ModelLibrarySelection | null,
): SimulationConfigurationMetadata {
  return {
    modelLibrary:
      modelLibrary === null
        ? null
        : modelLibrary.directive === "include"
          ? { directive: "include", section: null }
          : { directive: "lib", section: modelLibrary.section },
  };
}

export function isSimulationEnvironmentMetadata(
  value: unknown,
): value is SimulationEnvironmentMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SimulationEnvironmentMetadata>;
  const simulator = candidate.simulator;
  const models = candidate.models;
  return (
    (candidate.executor === "hosted-container" ||
      candidate.executor === "local-host") &&
    (candidate.reproducibility === "observed" ||
      candidate.reproducibility === "pinned") &&
    (candidate.profileId === null ||
      (typeof candidate.profileId === "string" &&
        candidate.profileId.length > 0)) &&
    typeof candidate.platform === "string" &&
    candidate.platform.length > 0 &&
    typeof candidate.fingerprint === "string" &&
    SHA256_PATTERN.test(candidate.fingerprint) &&
    !!simulator &&
    simulator.name === "ngspice" &&
    typeof simulator.version === "string" &&
    simulator.version.length > 0 &&
    (simulator.binarySha256 === null ||
      (typeof simulator.binarySha256 === "string" &&
        SHA256_PATTERN.test(simulator.binarySha256))) &&
    (models === null ||
      (!!models &&
        typeof models.id === "string" &&
        models.id.length > 0 &&
        typeof models.contentSha256 === "string" &&
        SHA256_PATTERN.test(models.contentSha256))) &&
    (candidate.startupSha256 === null ||
      (typeof candidate.startupSha256 === "string" &&
        SHA256_PATTERN.test(candidate.startupSha256))) &&
    (candidate.reproducibility !== "pinned" ||
      (candidate.profileId !== null && candidate.startupSha256 !== null))
  );
}

export async function verifySimulationEnvironmentMetadata(
  value: unknown,
): Promise<SimulationEnvironmentMetadata | null> {
  if (!isSimulationEnvironmentMetadata(value)) return null;
  const { fingerprint, ...facts } = value;
  const expected = await createSimulationEnvironmentMetadata(facts);
  return fingerprint === expected.fingerprint ? value : null;
}
