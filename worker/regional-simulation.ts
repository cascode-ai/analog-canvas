import type { SessionUser } from "./auth";
import type { SimulationOperationsEnv } from "./simulation-operations";
import {
  jobFailure,
  sendJobCommand,
  type JobCommand,
  type JobRegion,
} from "./regional-job-peer";

export const simulationJobPeerPath = "/api/resource-actions/simulation-job";
export async function simulationRegistryCommand(
  command: JobCommand,
  user: SessionUser,
  env: SimulationOperationsEnv,
): Promise<Response> {
  const url = new URL(command.path, "https://simulation-control");
  if (
    command.action === "lookup" &&
    command.method === "GET" &&
    ["/request", "/regional-request"].includes(url.pathname)
  ) {
    const id = url.searchParams.get("requestId");
    if (!id || id.length > 256) return jobFailure("invalid-command", 400);
    url.searchParams.set("ownerId", user.id);
    return env.SIMULATION_CONTROL!.getByName("simulation").fetch(url.href);
  }
  if (
    command.action !== "reserve" ||
    command.method !== "POST" ||
    command.path !== "/regional-request" ||
    env.RESOURCE_REGION !== "overseas"
  )
    return jobFailure("invalid-command", 400);
  const body = JSON.parse(command.body ?? "null");
  return env.SIMULATION_CONTROL!.getByName("simulation").fetch(url.href, {
    method: "POST",
    body: JSON.stringify({ ...body, ownerId: user.id }),
  });
}

/** An authority reservation is never timed out into permission for a second executor. */
export async function simulationStartRegion(
  request: Request,
  env: SimulationOperationsEnv,
  user: SessionUser,
  requestId: string,
  fingerprint: string,
): Promise<JobRegion | Response> {
  const localRegion = env.RESOURCE_REGION as JobRegion;
  const remote = (command: Omit<JobCommand, "target">) =>
    sendJobCommand(request, env, simulationJobPeerPath, command);
  const local = (command: Omit<JobCommand, "target">) =>
    simulationRegistryCommand({ ...command, target: localRegion }, user, env);
  const authority = localRegion === "overseas" ? local : remote;
  try {
    const lookup = {
      action: "lookup" as const,
      method: "GET",
      path: "/regional-request?requestId=" + encodeURIComponent(requestId),
      body: null,
    };
    const existing = await authority(lookup);
    if (!existing.ok) return existing;
    const { reservation } = await existing.json();
    if (reservation)
      return reservation.fingerprint === fingerprint
        ? reservation.region
        : jobFailure("REQUEST_ID_REUSED", 409);
    // Upgrade discovery is read-only. Both old stores must answer before a new
    // reservation can rule out an execution accepted by pre-routing code.
    const probe = {
      ...lookup,
      path: "/request?requestId=" + encodeURIComponent(requestId),
    };
    const localReply = await local(probe),
      peerReply = await remote(probe);
    if (!localReply.ok) return localReply;
    if (!peerReply.ok) return peerReply;
    const own = (await localReply.json()).request,
      other = (await peerReply.json()).request;
    if (
      (own && own.request_fingerprint !== fingerprint) ||
      (other && other.request_fingerprint !== fingerprint)
    )
      return jobFailure("REQUEST_ID_REUSED", 409);
    if (own && other) return jobFailure("regional-job-conflict", 409);
    const region = other
      ? localRegion === "cn"
        ? "overseas"
        : "cn"
      : localRegion;
    const reserved = await authority({
      action: "reserve",
      method: "POST",
      path: "/regional-request",
      body: JSON.stringify({ requestId, fingerprint, region }),
    });
    if (!reserved.ok) return reserved;
    return (await reserved.json()).reservation.region;
  } catch {
    return jobFailure();
  }
}
