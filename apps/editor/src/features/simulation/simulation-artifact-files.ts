import { strToU8, zip } from "fflate";
import type { ArtifactRef, Problem } from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";

const PREVIEW_CHARS = 65_536;

export interface SimulationArtifactContent {
  readonly artifact: ArtifactRef;
  readonly text: string;
  readonly truncated: boolean;
}

export type SimulationWorkspaceArchiveEntry =
  | { readonly kind: "text"; readonly path: string; readonly text: string }
  | {
      readonly kind: "artifact";
      readonly path: string;
      readonly artifact: ArtifactRef;
    };

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

export async function buildSimulationWorkspaceArchive(
  files: SimulationFiles,
  items: readonly SimulationWorkspaceArchiveEntry[],
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: Problem }
> {
  try {
    const entries: Record<string, Uint8Array> = {};
    for (const item of items) {
      let text: string;
      if (item.kind === "text") text = item.text;
      else {
        const result = await readSimulationArtifact(files, item.artifact);
        if (!result.ok) return result;
        text = result.content.text;
      }
      entries[archivePath(item.path)] = strToU8(text);
    }
    return {
      ok: true,
      bytes: await new Promise<Uint8Array>((resolve, reject) =>
        zip(
          entries,
          { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") },
          (error, bytes) => (error ? reject(error) : resolve(bytes)),
        ),
      ),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "ARTIFACT_ARCHIVE_FAILED",
        message:
          "The selected file bundle could not be created in this browser",
        stage: "export",
        recovery: "retry-after",
      },
    };
  }
}

function archivePath(path: string): string {
  const safe = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return safe || "file.txt";
}

export function simulationArtifactCategory(artifact: ArtifactRef): string {
  const name = artifact.name.toLocaleLowerCase();
  if (name.endsWith(".cir") || name.endsWith(".spi")) return "Netlist";
  if (name.endsWith(".raw") || name.endsWith(".csv")) return "Results";
  if (name.endsWith(".json")) return "Evidence";
  if (name.endsWith(".log") || name.endsWith(".txt")) return "Log";
  return "Other";
}

/** Explorer shows usable outputs, while diagnostic exports retain every artifact. */
export function simulationExplorerArtifactCategory(
  artifact: ArtifactRef,
): "Results" | "Logs" | null {
  const category = simulationArtifactCategory(artifact);
  return category === "Results"
    ? "Results"
    : category === "Log"
      ? "Logs"
      : null;
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
