import { AgentSessionError, type AgentSessionClient } from "@icm/agent-client";
import type { AgentFileResourceResponse } from "@icm/agent-adapter";
import type { FetchArtifact } from "./local-workspace.js";
import { TransferPending } from "./transfer-pending.js";

/** One sync's metadata preparation. Local cache hits never enter this function. */
export function workspaceTransfer(
  client: AgentSessionClient,
  prepared?: AgentFileResourceResponse,
): FetchArtifact {
  let ids: string[] = [];
  const batches = new Map<string, Promise<AgentFileResourceResponse>>();
  let deferPending = false;
  const pendingIds = new Set<string>();
  const attempts = new Map<string, { started: number; count: number }>();
  const consumerId = crypto.randomUUID();
  let protocol: Promise<1 | 2> | undefined;
  const leases = new Map<string, { path: string; leaseId: string }>();
  const descriptors = new Map<string, AgentFileResourceResponse>();
  if (
    prepared?.ok &&
    prepared.operation === "simulation-input" &&
    prepared.result.ok &&
    "download" in prepared.result
  )
    descriptors.set(prepared.result.artifact.id, prepared);
  const fetch: FetchArtifact = async (ref, offset) => {
    protocol ??= client.artifactTransferVersion();
    const leased = (await protocol) === 2;
    const attempt = attempts.get(ref.id) ?? { started: Date.now(), count: 0 };
    attempts.set(ref.id, attempt);
    const first = attempt.count++ === 0;
    const position = ids.indexOf(ref.id);
    let descriptor: AgentFileResourceResponse | undefined = descriptors.get(
      ref.id,
    );
    if (
      !descriptor &&
      (first || deferPending) &&
      position >= 0 &&
      ids.length > 1
    ) {
      const group = Math.floor(position / 32);
      // A publication retry is still one batch per round, not N individual
      // descriptor requests. Ready/cache-hit files do not enter later rounds.
      const key = `${group}:${deferPending ? attempt.count : 1}`;
      let pending = batches.get(key);
      if (!pending) {
        pending = client
          .fileResource({
            apiVersion: "3.0",
            requestId: crypto.randomUUID(),
            operation: "simulation-input",
            input: {
              ...(leased
                ? { action: "downloads-v2" as const, consumerId }
                : { action: "downloads" as const }),
              artifactIds: ids
                .slice(group * 32, group * 32 + 32)
                .filter((id) => first || pendingIds.has(id) || id === ref.id),
            },
          })
          .then((response) => {
            if (
              response.ok &&
              response.operation === "simulation-input" &&
              response.result.ok &&
              "downloads" in response.result
            )
              for (const item of response.result.downloads) {
                if (
                  !item.result.ok &&
                  item.result.error.code === "ARTIFACT_TRANSFER_PENDING"
                )
                  pendingIds.add(item.artifactId);
                else pendingIds.delete(item.artifactId);
              }
            return response;
          });
        batches.set(key, pending);
      }
      const response = await pending;
      if (response.ok && response.operation === "simulation-input") {
        if (response.result.ok && "downloads" in response.result) {
          const entry = response.result.downloads.find(
            (item) => item.artifactId === ref.id,
          );
          if (!entry) throw new Error("DOWNLOAD_DESCRIPTOR_MISSING");
          if (
            deferPending ||
            entry.result.ok ||
            entry.result.error.code !== "ARTIFACT_TRANSFER_PENDING"
          )
            descriptor = { ...response, result: entry.result };
        } else throw new Error(JSON.stringify(response));
      } else throw new Error(JSON.stringify(response));
    }
    descriptor ??= await client.prepareArtifactDownload(ref.id, undefined, {
      ...(deferPending ? { waitMs: 0 } : {}),
      ...(leased ? { consumerId } : {}),
    });
    if (
      deferPending &&
      descriptor.ok &&
      descriptor.operation === "simulation-input" &&
      !descriptor.result.ok &&
      descriptor.result.error.code === "ARTIFACT_TRANSFER_PENDING"
    ) {
      const remaining = 120_000 - (Date.now() - attempt.started);
      if (remaining > 0 && attempt.count <= 60)
        throw new TransferPending(
          Math.min(
            remaining,
            Math.max(
              500,
              Math.min(5000, descriptor.result.error.retryAfterMs ?? 2000),
            ),
          ),
        );
    }
    const ready = (response: AgentFileResourceResponse) => {
      if (
        !response.ok ||
        response.operation !== "simulation-input" ||
        !response.result.ok ||
        !("download" in response.result)
      )
        throw new Error(JSON.stringify(response));
      descriptors.set(ref.id, response);
      const download = response.result.download;
      if ("leaseId" in download)
        leases.set(ref.id, { path: download.path, leaseId: download.leaseId });
      return download;
    };
    const refresh = async () => {
      if (
        !leased ||
        attempt.count > 60 ||
        Date.now() - attempt.started >= 120_000
      )
        throw new Error("ARTIFACT_LEASE_RECOVERY_EXHAUSTED");
      return ready(
        await client.prepareArtifactDownload(ref.id, undefined, {
          consumerId: crypto.randomUUID(),
          waitMs: Math.max(0, 120_000 - (Date.now() - attempt.started)),
        }),
      );
    };
    let download = ready(descriptor);
    if ("expiresAt" in download && download.expiresAt <= Date.now())
      download = await refresh();
    const stream = () =>
      client.downloadArtifact(
        download.path,
        offset,
        ref.sha256,
        "leaseId" in download ? download.leaseId : undefined,
      );
    try {
      const response = await stream();
      attempts.delete(ref.id);
      return response;
    } catch (error) {
      if (
        !(error instanceof AgentSessionError) ||
        !["ARTIFACT_LEASE_EXPIRED", "ARTIFACT_UNAVAILABLE"].includes(error.code)
      )
        throw error;
      download = await refresh();
      const response = await stream();
      attempts.delete(ref.id);
      return response;
    }
  };
  fetch.completed = async (ref) => {
    const lease = leases.get(ref.id);
    if (lease) {
      await client.releaseArtifactDownload(lease.path, lease.leaseId);
      leases.delete(ref.id);
      descriptors.delete(ref.id);
    }
  };
  fetch.select = (refs, options) => {
    ids = [...new Set(refs.map((ref) => ref.id))];
    deferPending = options?.deferPending ?? false;
    batches.clear();
    pendingIds.clear();
    attempts.clear();
  };
  return fetch;
}
