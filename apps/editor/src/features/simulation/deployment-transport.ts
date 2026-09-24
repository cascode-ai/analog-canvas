/** Hosted releases opt into their managed resources; local hosts keep direct execution. */
export function resolveSimulationTransport(
  configured?: string,
): "managed" | "direct" {
  if (configured === "managed" || configured === "direct") return configured;
  return "direct";
}
