import {
  regionalAgentNamespace,
  regionalDeviceDirectory,
  type AgentRegionalEnv,
} from "./agent-regional-routing";
// Naming, revoking and purging trusted-device directories. Account deletion
// in AuthDO imports this, so it takes only types from the Agent relay: the
// simulation control runtime bundles AuthDO and cannot bundle the relay.

import type { AgentSessionNamespaceLike } from "./agent-session-runtime";
import { sha256Text } from "./sha256-text";

export const DEVICE_TRUST_INTERNAL = "/device-trust/";
const INTERNAL = "https://agent-session.internal";

/** A device whose trust was just removed, with the tasks it had opened. */
export type RemovedDevice = {
  deviceId: string;
  trustId: string;
  sessions: string[];
};

/** One directory per account and site. */
export async function directoryName(origin: string, userId: string) {
  return `agent-device-trust-${await sha256Text(JSON.stringify([origin, userId]))}`;
}

export function directory(namespace: AgentSessionNamespaceLike, name: string) {
  return {
    fetch: (path: string, init: RequestInit) =>
      namespace
        .getByName(name)
        .fetch(`${INTERNAL}${DEVICE_TRUST_INTERNAL}${path}`, init),
  };
}

/** End the tasks devices opened under trust that was just removed. */
async function endTasks(
  namespace: AgentSessionNamespaceLike,
  name: string,
  devices: RemovedDevice[],
  except?: string,
) {
  await Promise.allSettled(
    devices.flatMap(({ deviceId, trustId, sessions }) =>
      sessions
        .filter((sessionId) => sessionId !== except)
        .map((sessionId) =>
          namespace
            .getByName(sessionId)
            .fetch(`${INTERNAL}/revoke-trusted-device`, {
              method: "POST",
              body: JSON.stringify({ directory: name, deviceId, trustId }),
            }),
        ),
    ),
  );
}

/**
 * Remove one device's trust and end its tasks. A task its revocation does not
 * reach ends at its next request, which finds the trust gone.
 */
export async function untrustDevice(
  namespace: AgentSessionNamespaceLike,
  name: string,
  deviceId: string,
  options: { trustId?: string; except?: string } = {},
): Promise<boolean> {
  const response = await directory(namespace, name).fetch(
    deviceId + (options.trustId ? `?trust=${options.trustId}` : ""),
    { method: "DELETE" },
  );
  if (!response.ok) return false;
  const { sessions, trustId } = (await response.json()) as {
    sessions: string[];
    trustId?: string;
  };
  if (trustId)
    await endTasks(
      namespace,
      name,
      [{ deviceId, trustId, sessions }],
      options.except,
    );
  return true;
}

/** Account deletion forgets every device the account trusted on this site. */
export async function purgeTrustedDevices(
  namespace: AgentSessionNamespaceLike | undefined,
  origin: string,
  userId: string,
  env: AgentRegionalEnv = {},
): Promise<boolean> {
  if (!namespace) return true;
  try {
    namespace = regionalAgentNamespace(namespace, env);
    const name = regionalDeviceDirectory(
      await directoryName(origin, userId),
      env,
    );
    const response = await directory(namespace, name).fetch("all", {
      method: "DELETE",
    });
    if (!response.ok) return false;
    const { devices } = (await response.json()) as {
      devices: RemovedDevice[];
    };
    await endTasks(namespace, name, devices);
    return true;
  } catch {
    return false;
  }
}
