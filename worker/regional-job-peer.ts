import type { AuthEnv, SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";

export type JobRegion = "cn" | "overseas";
export type RegionalJobEnv = Partial<AuthEnv> & {
  RESOURCE_REGION?: string;
  RESOURCE_ACTION_PEER?: string;
};
export interface JobCommand {
  action: "local" | "lookup" | "reserve";
  method: string;
  path: string;
  body: string | null;
  target: JobRegion;
}
export const jobFailure = (error = "regional-job-unavailable", status = 503) =>
  Response.json(
    {
      error,
      recovery:
        status >= 500 || status === 429
          ? "retry-same-request"
          : "not-retryable",
    },
    {
      status,
      headers: { "cache-control": "private, no-store" },
    },
  );
export function jobPeerConfigured(env: RegionalJobEnv): boolean {
  return !!(
    ["cn", "overseas"].includes(env.RESOURCE_REGION ?? "") &&
    env.RESOURCE_ACTION_PEER &&
    env.AUTH
  );
}
function auth(
  env: RegionalJobEnv,
  request: Request,
  operation: string,
  body: unknown,
) {
  return env
    .AUTH!.getByName("auth")
    .fetch("https://auth/internal/resource-action-" + operation, {
      method: "POST",
      headers: { cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify(body),
    });
}
export async function sendJobCommand(
  request: Request,
  env: RegionalJobEnv,
  peerPath: string,
  command: Omit<JobCommand, "target">,
): Promise<Response> {
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER!);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return jobFailure();
    const payload = {
      ...command,
      target: env.RESOURCE_REGION === "cn" ? "overseas" : "cn",
    };
    const authorization = await auth(env, request, "authorize", {
      binding: await digest(JSON.stringify(payload)),
    });
    if (!authorization.ok)
      return jobFailure("authorization-unavailable", authorization.status);
    const { token } = await authorization.json();
    return await fetch(peer.origin + peerPath, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return jobFailure();
  }
}
export async function receiveJobCommand(
  request: Request,
  env: RegionalJobEnv,
  handle: (command: JobCommand, user: SessionUser) => Promise<Response>,
): Promise<Response> {
  if (!jobPeerConfigured(env)) return jobFailure("not-found", 404);
  if (request.method !== "POST") return jobFailure("method-not-allowed", 405);
  try {
    const command = (await readSyncJson(
      request,
      6 * 1024 * 1024,
    )) as JobCommand | null;
    if (
      !command ||
      !["local", "lookup", "reserve"].includes(command.action) ||
      !["GET", "POST", "PATCH", "DELETE"].includes(command.method) ||
      typeof command.path !== "string" ||
      command.path.length > 2048 ||
      !(command.body === null || typeof command.body === "string") ||
      command.target !== env.RESOURCE_REGION
    )
      return jobFailure("invalid-command", 400);
    const verified = await auth(env, request, "verify", {
      token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
      binding: await digest(JSON.stringify(command)),
    });
    if (!verified.ok) return jobFailure("unauthorized", verified.status);
    const user = sessionIdentity((await verified.json()).user);
    return user ? await handle(command, user) : jobFailure("unauthorized", 401);
  } catch {
    return jobFailure();
  }
}
