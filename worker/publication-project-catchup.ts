import type { GalleryEnv } from "./gallery-store";
import type { ProjectSyncStatus } from "./project-sync-journal";
import { MAX_SYNC_BYTES } from "./project-sync-protocol";
import { readSyncJson } from "./project-sync-http";
import { routeProjectSync } from "./project-sync";

type Head = { epoch: string; sequence: number };
const projectCall = (env: GalleryEnv, operation: string, body: unknown) =>
  env
    .PROJECTS!.getByName(env.PROJECTS_STORE_NAME ?? "projects")
    .fetch(`https://projects/${operation}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
export async function publicationProjectHead(
  env: GalleryEnv,
): Promise<Head | null> {
  if (!env.PROJECTS) return null;
  const response = await projectCall(env, "sync-status", {});
  if (!response.ok) throw new Error("Project journal unavailable");
  const status = (await response.json()) as ProjectSyncStatus;
  return { epoch: status.epoch, sequence: status.sequence };
}

/** Apply the existing authenticated Project stream, bounded to this publication request. */
export async function catchUpPublicationProjects(
  env: GalleryEnv,
  head?: Head,
): Promise<boolean> {
  if (!env.PROJECTS) return !head;
  if (
    !env.PROJECT_SYNC_PEER_URL ||
    !env.PROJECT_SYNC_PEER_TOKEN ||
    !env.PROJECT_SYNC_TOKEN
  )
    return false;
  const peer = new URL(env.PROJECT_SYNC_PEER_URL);
  if (
    peer.protocol !== "https:" ||
    peer.username ||
    peer.password ||
    peer.pathname !== "/" ||
    peer.search ||
    peer.hash
  )
    return false;
  const until = Date.now() + 20_000;
  const headers = { authorization: "Bearer " + env.PROJECT_SYNC_PEER_TOKEN };
  if (!head) {
    const response = await fetch(peer.origin + "/api/project-sync/status", {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, until - Date.now())),
    });
    if (!response.ok) return false;
    const status = (await readSyncJson(response, 4096)) as ProjectSyncStatus;
    head = { epoch: status.epoch, sequence: status.sequence };
  }
  if (
    typeof head.epoch !== "string" ||
    !Number.isSafeInteger(head.sequence) ||
    head.sequence < 0
  )
    return false;
  for (let attempt = 0; attempt < 64 && Date.now() < until; attempt++) {
    const localResponse = await projectCall(env, "sync-status", {});
    if (!localResponse.ok) return false;
    const local = (await localResponse.json()) as ProjectSyncStatus;
    if (local.fenced) return false;
    if (
      (!local.received && head.sequence === 0) ||
      (local.received?.epoch === head.epoch &&
        local.received.sequence >= head.sequence)
    )
      return true;
    if (local.received && local.received.epoch !== head.epoch) return false;
    const response = await fetch(peer.origin + "/api/project-sync/pull", {
      method: "POST",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, until - Date.now())),
      body: JSON.stringify({ status: local }),
    });
    if (!response.ok) return false;
    const result = (await readSyncJson(
      response,
      MAX_SYNC_BYTES * 2 + 4096,
    )) as { peer: ProjectSyncStatus; events: unknown[] };
    if (!result || !Array.isArray(result.events) || result.events.length !== 1)
      return false;
    if (!(await projectCall(env, "sync-reconcile", { peer: result.peer })).ok)
      return false;
    const applied = await routeProjectSync(
      new Request("https://canvas/api/project-sync/events", {
        method: "POST",
        headers: { authorization: "Bearer " + env.PROJECT_SYNC_TOKEN },
        body: JSON.stringify({ event: result.events[0] }),
      }),
      env,
    );
    if (!applied?.ok) return false;
  }
  return false;
}
