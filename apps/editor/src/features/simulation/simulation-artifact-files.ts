import { strToU8, zip } from "fflate";
import type { ArtifactRef, Problem } from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";

const PREVIEW_CHARS = 65_536;

export interface SimulationArtifactContent {
  readonly artifact: ArtifactRef;
  readonly text: string;
  readonly truncated: boolean;
}

type ArtifactReadResult =
  | { readonly ok: true; readonly content: SimulationArtifactContent }
  | { readonly ok: false; readonly error: Problem };

export async function readSimulationArtifactPreview(
  files: SimulationFiles,
  artifact: ArtifactRef,
): Promise<ArtifactReadResult> {
  const result = await files.handle({
    action: "artifact",
    artifactId: artifact.id,
    offset: 0,
    maxChars: PREVIEW_CHARS,
  });
  if (!result.ok) return result;
  if (!("text" in result))
    return {
      ok: false,
      error: {
        code: "ARTIFACT_READ_FAILED",
        message: "The selected artifact did not return readable content",
        stage: "export",
        recovery: "not-retryable",
      },
    };
  return {
    ok: true,
    content: {
      artifact,
      text: result.text,
      truncated: result.nextOffset !== null,
    },
  };
}

export async function readSimulationArtifact(
  files: SimulationFiles,
  artifact: ArtifactRef,
): Promise<ArtifactReadResult> {
  let offset: number | null = 0;
  let text = "";
  while (offset !== null) {
    const result = await files.handle({
      action: "artifact",
      artifactId: artifact.id,
      offset,
    });
    if (!result.ok) return result;
    if (!("text" in result))
      return {
        ok: false,
        error: {
          code: "ARTIFACT_READ_FAILED",
          message: "The selected artifact did not return readable content",
          stage: "export",
          recovery: "not-retryable",
        },
      };
    text += result.text;
    offset = result.nextOffset;
  }
  return { ok: true, content: { artifact, text, truncated: false } };
}

export async function buildSimulationArtifactArchive(
  files: SimulationFiles,
  artifacts: readonly ArtifactRef[],
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: Problem }
> {
  try {
    const entries: Record<string, Uint8Array> = {};
    for (const artifact of artifacts) {
      const result = await readSimulationArtifact(files, artifact);
      if (!result.ok) return result;
      entries[
        `${simulationArtifactCategory(artifact).toLowerCase()}/${artifact.name}`
      ] = strToU8(result.content.text);
    }
    return {
      ok: true,
      bytes: await new Promise<Uint8Array>((resolve, reject) =>
        zip(
          entries,
          {
            level: 6,
            mtime: new Date("1980-01-01T00:00:00.000Z"),
          },
          (error, bytes) => (error ? reject(error) : resolve(bytes)),
        ),
      ),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "ARTIFACT_ARCHIVE_FAILED",
        message: "The artifact bundle could not be created in this browser",
        stage: "export",
        recovery: "retry-after",
      },
    };
  }
}

export function simulationArtifactCategory(artifact: ArtifactRef): string {
  const name = artifact.name.toLocaleLowerCase();
  if (name.endsWith(".cir") || name.endsWith(".spi")) return "Netlist";
  if (name.endsWith(".raw") || name.endsWith(".csv")) return "Results";
  if (name.endsWith(".json")) return "Evidence";
  if (name.endsWith(".log") || name.endsWith(".txt")) return "Log";
  return "Other";
}

export function formatSimulationArtifactPreview(
  content: SimulationArtifactContent,
): string {
  if (!content.artifact.name.toLocaleLowerCase().endsWith(".json"))
    return content.text;
  try {
    return JSON.stringify(JSON.parse(content.text), null, 2);
  } catch {
    return content.text;
  }
}
