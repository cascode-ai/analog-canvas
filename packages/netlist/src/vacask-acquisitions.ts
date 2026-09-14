import type { CircuitAcquisitionAddress } from "./simulation-compile.js";
import type { ResolvedAuthoredScope } from "./authored-circuit-scopes.js";
import { vacaskIdentifier } from "./vacask-printer.js";

/** Raw identity and save syntax are derived together from the exact electrical
 * address. In particular, i(instance) is saved as instance:flow(br), not i(...).
 * A scope resolves authored formal aliases before extending internal paths. */
export function vacaskAcquisition(
  address: CircuitAcquisitionAddress,
  scope?: Pick<
    Extract<ResolvedAuthoredScope, { ok: true }>,
    "node" | "instance"
  >,
) {
  if (address.kind === "voltage") {
    const local = [...address.path, address.node].join(":");
    const vector = scope ? scope.node(local) : local;
    return {
      quantity: "voltage" as const,
      vector,
      save: `v(${vacaskIdentifier(vector)})`,
    };
  }
  const local = [...address.path, address.senseReference].join(":");
  const instance = scope ? scope.instance(local) : local;
  return {
    quantity: "current" as const,
    vector: `${instance}:flow(br)`,
    save: `i(${vacaskIdentifier(instance)})`,
  };
}
