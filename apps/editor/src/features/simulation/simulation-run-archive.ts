import { type SimulationPresentationOutput } from "./source-presentation";
import {
  PreparedSchema,
  RunSchema,
  SimulationOutputDataSchema,
  type ArtifactRef,
  type Prepared,
  type Problem,
  type Run,
} from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";
import { sha256 } from "@icm/simulation-service/files";

import { readSimulationArtifact } from "./simulation-artifact-files";

export const SIMULATION_ARCHIVE_VERSION = 1 as const;
export const MAX_SIMULATION_ARCHIVE_BYTES = 32 * 1024 * 1024;

export interface SimulationArchivePresentation {
  readonly folderId: string;
  readonly folderName: string;
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
  readonly outputs: SimulationPresentationOutput[];
}

interface ArchivedArtifact {
  readonly originalId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly text: string;
}

type ArchivedPrepared = Omit<Prepared, "artifacts"> & {
  readonly artifactIds: readonly string[];
};
type ArchivedRun = Omit<
  Run,
  "artifacts" | "result" | "outputData" | "inputStatus" | "resultPreview"
>;

/** Portable browser archive payload. Large numeric arrays live once in the
 * captured result artifacts and are decoded only when the archive is opened. */
export interface SimulationRunArchiveV1 {
  readonly schemaVersion: typeof SIMULATION_ARCHIVE_VERSION;
  readonly id: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly presentation: SimulationArchivePresentation;
  readonly prepared: ArchivedPrepared;
  readonly run: ArchivedRun;
  readonly artifacts: readonly ArchivedArtifact[];
  readonly byteLength: number;
}

export interface SimulationRunArchiveSummary {
  readonly id: string;
  readonly projectId: string;
  readonly folderId: string;
  readonly folderName: string;
  readonly analysisLabel: string;
  readonly createdAt: string;
  readonly byteLength: number;
  readonly environment: Prepared["environment"];
}

type ArchiveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Problem };

function archiveProblem(code: string, message: string): ArchiveResult<never> {
  return {
    ok: false,
    error: { code, message, stage: "export", recovery: "not-retryable" },
  };
}

export async function captureSimulationRunArchive(
  files: SimulationFiles,
  input: {
    readonly projectId: string;
    readonly presentation: SimulationArchivePresentation;
    readonly prepared: Prepared;
    readonly run: Run;
  },
): Promise<ArchiveResult<SimulationRunArchiveV1>> {
  if (!input.run.result && !input.run.outputData)
    return archiveProblem(
      "SIMULATION_ARCHIVE_RESULT_MISSING",
      "Complete the run before archiving its result",
    );
  const artifacts: ArchivedArtifact[] = [];
  let byteLength = 0;
  for (const artifact of input.run.artifacts) {
    const read = await readSimulationArtifact(files, artifact);
    if (!read.ok) return read;
    const text = read.content.text;
    const digest = await sha256(text);
    if (digest !== artifact.sha256)
      return archiveProblem(
        "SIMULATION_ARCHIVE_DIGEST_MISMATCH",
        `Artifact changed while archiving: ${artifact.name}`,
      );
    byteLength += artifact.byteLength;
    if (byteLength > MAX_SIMULATION_ARCHIVE_BYTES)
      return archiveProblem(
        "SIMULATION_ARCHIVE_TOO_LARGE",
        "This run exceeds the 32 MiB local archive limit; export its ZIP instead",
      );
    artifacts.push({ ...artifact, originalId: artifact.id, text });
  }
  if (
    input.run.result &&
    !artifacts.some((item) => item.name === "result.json")
  )
    return archiveProblem(
      "SIMULATION_ARCHIVE_RESULT_ARTIFACT_MISSING",
      "The complete result artifact is unavailable; export the remaining files instead",
    );
  if (
    input.run.outputData &&
    !artifacts.some((item) => item.name === "outputs.json")
  )
    return archiveProblem(
      "SIMULATION_ARCHIVE_OUTPUT_ARTIFACT_MISSING",
      "The complete evaluated-output artifact is unavailable; export the remaining files instead",
    );
  const { artifacts: preparedArtifacts, ...prepared } = input.prepared;
  const {
    artifacts: _runArtifacts,
    result: _result,
    outputData: _outputData,
    inputStatus: _inputStatus,
    resultPreview: _resultPreview,
    ...run
  } = input.run;
  return {
    ok: true,
    value: {
      schemaVersion: SIMULATION_ARCHIVE_VERSION,
      id: crypto.randomUUID(),
      projectId: input.projectId,
      createdAt: new Date().toISOString(),
      presentation: structuredClone(input.presentation),
      prepared: {
        ...structuredClone(prepared),
        artifactIds: preparedArtifacts.map((artifact) => artifact.id),
      },
      run: structuredClone(run),
      artifacts,
      byteLength,
    },
  };
}

function parseJsonArtifact<T>(
  artifacts: readonly ArchivedArtifact[],
  name: string,
  parse: (value: unknown) => T,
): T | undefined {
  const artifact = artifacts.find((candidate) => candidate.name === name);
  if (!artifact) return undefined;
  try {
    return parse(JSON.parse(artifact.text));
  } catch {
    return undefined;
  }
}

export async function restoreSimulationRunArchive(
  files: SimulationFiles,
  archive: SimulationRunArchiveV1,
): Promise<ArchiveResult<{ prepared: Prepared; run: Run }>> {
  const refs = new Map<string, ArtifactRef>();
  for (const artifact of archive.artifacts) {
    if ((await sha256(artifact.text)) !== artifact.sha256)
      return archiveProblem(
        "SIMULATION_ARCHIVE_DIGEST_MISMATCH",
        `Archived artifact failed verification: ${artifact.name}`,
      );
    try {
      refs.set(
        artifact.originalId,
        await files.put(artifact.name, artifact.mediaType, artifact.text),
      );
    } catch {
      return archiveProblem(
        "SIMULATION_ARCHIVE_RESTORE_CAPACITY",
        "The archived result is too large for the current Simulation session",
      );
    }
  }
  const result = parseJsonArtifact(
    archive.artifacts,
    "result.json",
    (value) => value,
  );
  const outputData = parseJsonArtifact(
    archive.artifacts,
    "outputs.json",
    (value) => SimulationOutputDataSchema.parse(value),
  );
  const runArtifacts = archive.artifacts
    .map((artifact) => refs.get(artifact.originalId))
    .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
  const preparedArtifacts = archive.prepared.artifactIds
    .map((id) => refs.get(id))
    .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
  const { artifactIds: _artifactIds, ...prepared } = archive.prepared;
  try {
    return {
      ok: true,
      value: {
        prepared: PreparedSchema.parse({
          ...structuredClone(prepared),
          artifacts: preparedArtifacts,
        }),
        run: RunSchema.parse({
          ...structuredClone(archive.run),
          artifacts: runArtifacts,
          inputStatus: "unavailable",
          ...(result ? { result } : {}),
          ...(outputData ? { outputData } : {}),
        }),
      },
    };
  } catch {
    return archiveProblem(
      "SIMULATION_ARCHIVE_INVALID",
      "The browser archive contains an invalid run result",
    );
  }
}

export function summarizeSimulationRunArchive(
  archive: SimulationRunArchiveV1,
): SimulationRunArchiveSummary {
  return {
    id: archive.id,
    projectId: archive.projectId,
    folderId: archive.presentation.folderId,
    folderName: archive.presentation.folderName,
    analysisLabel: archive.presentation.analysisLabel,
    createdAt: archive.createdAt,
    byteLength: archive.byteLength,
    environment: archive.prepared.environment,
  };
}

export function isSimulationRunArchive(
  value: unknown,
): value is SimulationRunArchiveV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SimulationRunArchiveV1>;
  return (
    candidate.schemaVersion === SIMULATION_ARCHIVE_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.byteLength === "number" &&
    Boolean(candidate.presentation) &&
    typeof candidate.presentation?.folderId === "string" &&
    typeof candidate.presentation?.folderName === "string" &&
    Boolean(candidate.prepared) &&
    typeof candidate.prepared?.id === "string" &&
    Boolean(candidate.run) &&
    typeof candidate.run?.id === "string" &&
    Array.isArray(candidate.artifacts) &&
    candidate.artifacts.every(
      (artifact) =>
        Boolean(artifact) &&
        typeof artifact.originalId === "string" &&
        typeof artifact.name === "string" &&
        typeof artifact.mediaType === "string" &&
        typeof artifact.byteLength === "number" &&
        typeof artifact.sha256 === "string" &&
        typeof artifact.text === "string",
    )
  );
}

/** Read-only compatibility at the archive boundary; artifact bytes and run evidence never change. */
export function readSimulationRunArchive(
  value: unknown,
): SimulationRunArchiveV1 | null {
  if (isSimulationRunArchive(value)) return value;
  if (!value || typeof value !== "object" || !("presentation" in value))
    return null;
  const presentation = value.presentation;
  if (
    !presentation ||
    typeof presentation !== "object" ||
    !("setupId" in presentation) ||
    typeof presentation.setupId !== "string" ||
    !("setupName" in presentation) ||
    typeof presentation.setupName !== "string" ||
    "folderId" in presentation ||
    "folderName" in presentation
  )
    return null;
  const { setupId, setupName, ...rest } = presentation;
  const normalized = {
    ...value,
    presentation: { ...rest, folderId: setupId, folderName: setupName },
  };
  return isSimulationRunArchive(normalized) ? normalized : null;
}
