import { AgentSessionError, type AgentSessionClient } from "@icm/agent-client";
import type { AgentFileResourceResponse } from "@icm/agent-adapter";
import type { FetchArtifact } from "./local-workspace.js";

/** One sync's metadata preparation. Local cache hits never enter this function. */
export function workspaceTransfer(client: AgentSessionClient): FetchArtifact {
  let ids: string[] = [];
  const batches = new Map<
    number,
    Promise<AgentFileResourceResponse | undefined>
  >();
  let legacy = false;
  const fetch: FetchArtifact = async (ref, offset) => {
    const position = ids.indexOf(ref.id);
    let descriptor: AgentFileResourceResponse | undefined;
    if (!legacy && position >= 0 && ids.length > 1) {
      const group = Math.floor(position / 32);
      let pending = batches.get(group);
      if (!pending) {
        pending = client
          .fileResource({
            apiVersion: "3.0",
            requestId: crypto.randomUUID(),
            operation: "simulation-input",
            input: {
              action: "downloads",
              artifactIds: ids.slice(group * 32, group * 32 + 32),
            },
          })
          .catch((error: unknown) => {
            if (
              error instanceof AgentSessionError &&
              error.code === "FILE_CONTENT_INVALID" &&
              error.httpStatus === 400
            ) {
              legacy = true;
              return undefined;
            }
            throw error;
          });
        batches.set(group, pending);
      }
      const response = await pending;
      if (response?.ok && response.operation === "simulation-input") {
        if (response.result.ok && "downloads" in response.result) {
          const entry = response.result.downloads.find(
            (item) => item.artifactId === ref.id,
          );
          if (!entry) throw new Error("DOWNLOAD_DESCRIPTOR_MISSING");
          if (
            entry.result.ok ||
            entry.result.error.code !== "ARTIFACT_TRANSFER_PENDING"
          )
            descriptor = { ...response, result: entry.result };
        } else if (
          response.result.ok ||
          response.result.error.code !== "SIMULATION_FILE_INVALID"
        ) {
          throw new Error(JSON.stringify(response));
        } else legacy = true;
        // A pre-batch editor's definite schema rejection falls back once per sync group.
      } else if (response) throw new Error(JSON.stringify(response));
    }
    descriptor ??= await client.prepareArtifactDownload(ref.id);
    if (
      !descriptor.ok ||
      descriptor.operation !== "simulation-input" ||
      !descriptor.result.ok ||
      !("download" in descriptor.result)
    )
      throw new Error(JSON.stringify(descriptor));
    return client.downloadArtifact(
      descriptor.result.download.path,
      offset,
      ref.sha256,
    );
  };
  fetch.select = (refs) => {
    ids = [...new Set(refs.map((ref) => ref.id))];
  };
  return fetch;
}
