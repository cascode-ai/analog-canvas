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

function uniqueEntryIndex(
  files: readonly { readonly path: string; readonly text: string }[],
  entryPath: string,
): number {
  const paths = new Set<string>();
  let entryIndex = -1;
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    if (paths.has(file.path)) return -1;
    paths.add(file.path);
    if (file.path === entryPath) entryIndex = index;
  }
  return entryIndex;
}

function findJoinedExecutionFilesRange(
  text: string,
  files: readonly { readonly text: string }[],
  options?: {
    readonly requiredIndex?: number;
    readonly excludeRange?: { readonly start: number; readonly end: number };
  },
): { start: number; end: number } | null {
  const required = options?.requiredIndex;
  const exclude = options?.excludeRange;
  if (required !== undefined && (required < 0 || required >= files.length))
    return null;
  const maxStart = required ?? files.length - 1;
  for (let start = 0; start <= maxStart; start++) {
    if (exclude && start >= exclude.start && start <= exclude.end) continue;
    let pos = 0;
    for (let end = start; end < files.length; end++) {
      if (exclude && end >= exclude.start && end <= exclude.end) break;
      const piece = files[end]!.text;
      if (end > start) {
        if (text[pos] !== "\n") break;
        pos += 1;
      }
      if (!text.startsWith(piece, pos)) break;
      pos += piece.length;
      if (pos === text.length && (required === undefined || end >= required))
        return { start, end };
    }
  }
  return null;
}

/**
 * Whether `testbench` and `deck` form a valid raw multi-file pair over
 * `files`: every file path is unique, `entryPath` names a non-empty file equal
 * to `deck`, and `testbench` equals a contiguous slice of `files` including
 * that entry file.
 */
export function isRawMultiFileTestbench(
  testbench: string,
  deck: string,
  files: readonly { readonly path: string; readonly text: string }[],
  entryPath = "deck.cir",
): boolean {
  if (!deck || !testbench || files.length === 0) return false;
  const entryIndex = uniqueEntryIndex(files, entryPath);
  return (
    entryIndex >= 0 &&
    files[entryIndex]!.text === deck &&
    findJoinedExecutionFilesRange(testbench, files, {
      requiredIndex: entryIndex,
    }) !== null
  );
}

/**
 * Validate raw `netlist` and `testbench` metadata texts against submitted
 * `files` and `entryPath`: every path is unique, `deck` matches the entry file,
 * `testbench` equals a contiguous slice including `entryPath`, and a non-empty
 * `netlist` equals a disjoint contiguous slice.
 */
export function isValidRawExecutionInputMetadata(
  input: {
    readonly netlist: string;
    readonly testbench: string;
    readonly deck: string;
  },
  files: readonly { readonly path: string; readonly text: string }[],
  entryPath = "deck.cir",
): boolean {
  if (!input.deck || !input.testbench || files.length === 0) return false;
  const entryIndex = uniqueEntryIndex(files, entryPath);
  if (entryIndex < 0 || files[entryIndex]!.text !== input.deck) return false;
  const testbenchRange = findJoinedExecutionFilesRange(input.testbench, files, {
    requiredIndex: entryIndex,
  });
  if (!testbenchRange) return false;
  if (input.netlist === "") return true;
  return (
    findJoinedExecutionFilesRange(input.netlist, files, {
      excludeRange: testbenchRange,
    }) !== null
  );
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
      candidate.executor === "local-host" ||
      candidate.executor === "browser-wasm") &&
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
    (simulator.name === "vacask" || simulator.name === "ngspice") &&
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
