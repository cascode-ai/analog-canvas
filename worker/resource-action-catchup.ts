import { RESOURCE_MAX_BYTES } from "./resource-replica";
import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { readSyncJson } from "./project-sync-http";

export type ResourceCall = (
  operation: string,
  body: unknown,
) => Promise<Response>;
/** Catch up from the durable cursor, including intervening changes and concurrent ticks. */
export async function catchUpResource(
  call: ResourceCall,
  stream: string,
  peer: string,
  token: string | undefined,
  head: { epoch: string; sequence: number },
): Promise<boolean> {
  const until = Date.now() + REGIONAL_ACTION_TIMEOUT_MS;
  for (let attempt = 0; attempt < 64 && Date.now() < until; attempt++) {
    const response = await call("resource-sync/status", { stream });
    if (!response.ok) return false;
    const { received } = await response.json();
    if (received?.epoch === head.epoch && received.sequence >= head.sequence)
      return true;
    if ((received && received.epoch !== head.epoch) || !token) return false;
    const changes = await fetch(
      `${peer}/api/resource-sync/${stream}/changes?after=${received?.sequence ?? 0}`,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, until - Date.now())),
        headers: { authorization: "Bearer " + token },
      },
    );
    if (!changes.ok) return false;
    const applied = await call("resource-sync/receive", {
      stream,
      envelope: await readSyncJson(changes, RESOURCE_MAX_BYTES * 2),
    });
    if (!applied.ok) {
      const current = await (
        await call("resource-sync/status", { stream })
      ).json();
      if (
        current.received?.epoch !== head.epoch ||
        current.received.sequence <= (received?.sequence ?? 0)
      )
        return false;
    }
  }
  return false;
}
