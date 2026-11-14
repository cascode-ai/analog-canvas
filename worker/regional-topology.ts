import type { SessionUser } from "./auth";
import type { TopologyTaskEnv } from "./topology-task";
import {
  jobFailure,
  sendJobCommand,
  type JobCommand,
  type JobRegion,
} from "./regional-job-peer";

export const topologyJobPeerPath = "/api/resource-actions/topology-job";

export async function topologyRegistryCommand(
  command: JobCommand,
  user: SessionUser,
  env: TopologyTaskEnv,
): Promise<Response> {
  if (
    env.RESOURCE_REGION !== "overseas" ||
    !env.TOPOLOGY_TASK ||
    command.path !== "/regional-owner" ||
    !(
      (command.action === "lookup" && command.method === "GET") ||
      (command.action === "reserve" && command.method === "POST")
    )
  )
    return jobFailure("invalid-command", 400);
  return env.TOPOLOGY_TASK.getByName(`user:${user.id}`).fetch(
    "https://topology/regional-owner",
    {
      method: command.method,
      ...(command.body === null ? {} : { body: command.body }),
    },
  );
}

export async function topologyRegion(
  request: Request,
  env: TopologyTaskEnv,
  user: SessionUser,
  local: (request: Request) => Promise<Response>,
): Promise<JobRegion | Response> {
  const region = env.RESOURCE_REGION as JobRegion;
  const remote = (command: Omit<JobCommand, "target">) =>
    sendJobCommand(request, env, topologyJobPeerPath, command);
  const authority =
    region === "overseas"
      ? (command: Omit<JobCommand, "target">) =>
          topologyRegistryCommand({ ...command, target: region }, user, env)
      : remote;
  const directory = env.TOPOLOGY_TASK!.getByName(`user:${user.id}`);
  const remember = async (owner: JobRegion): Promise<JobRegion | Response> => {
    if (region === "overseas") return owner;
    const response = await directory.fetch("https://topology/regional-owner", {
      method: "POST",
      body: JSON.stringify({ region: owner }),
    });
    if (!response.ok) return response;
    return (await response.json()).region === owner
      ? owner
      : jobFailure("regional-job-conflict", 409);
  };
  try {
    // Ownership never migrates or expires. A confirmed local copy therefore
    // removes cross-border I/O from ordinary progress polling and cancellation.
    const cached = await directory.fetch("https://topology/regional-owner");
    if (!cached.ok) return cached;
    const cachedRegion = (await cached.json()).region;
    if (cachedRegion) return cachedRegion;
    const owner = await authority({
      action: "lookup",
      method: "GET",
      path: "/regional-owner",
      body: null,
    });
    if (!owner.ok) return owner;
    const current = (await owner.json()).region;
    if (current) return remember(current);
    const read = new Request(new URL("/api/topology-task", request.url));
    const ownResponse = await local(read),
      peerResponse = await remote({
        action: "local",
        method: "GET",
        path: "/api/topology-task",
        body: null,
      });
    if (!ownResponse.ok) return ownResponse;
    if (!peerResponse.ok) return peerResponse;
    const own = (await ownResponse.json()).job,
      other = (await peerResponse.json()).job;
    const peerRegion = region === "cn" ? "overseas" : "cn";
    if (own && other) {
      // Never erase a job accepted by the old regional implementation. Its ID
      // still permits reading/stopping/dismissing it while starts stay fenced.
      const id = new URL(request.url).searchParams.get("id");
      if (
        request.method !== "POST" &&
        id &&
        (own.id === id) !== (other.id === id)
      )
        return own.id === id ? region : peerRegion;
      return Response.json(
        {
          error: "regional-job-conflict",
          jobs: [
            { region, id: own.id, running: own.running },
            { region: peerRegion, id: other.id, running: other.running },
          ],
        },
        { status: 409, headers: { "cache-control": "private, no-store" } },
      );
    }
    if (!own && !other && request.method !== "POST") return region;
    const reserved = await authority({
      action: "reserve",
      method: "POST",
      path: "/regional-owner",
      body: JSON.stringify({ region: other ? peerRegion : region }),
    });
    if (!reserved.ok) return reserved;
    return remember((await reserved.json()).region);
  } catch {
    return jobFailure();
  }
}
