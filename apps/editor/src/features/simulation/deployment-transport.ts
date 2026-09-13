import type { ReleaseChannel } from "../../document/release-channel";

/** Hosted releases opt into their managed resources; local hosts keep direct execution. */
export function resolveSimulationTransport(
  channel: ReleaseChannel,
  configured?: string,
): "managed" | "direct" {
  if (configured === "managed" || configured === "direct") return configured;
  return channel === "preview" ? "managed" : "direct";
}
