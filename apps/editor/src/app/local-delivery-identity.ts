import type {
  AgentLocalModelTypes,
  AgentLocalSource,
} from "@icm/agent-adapter";
import type { RnlAppearance } from "@icm/rnl";

/** What a Project tab records of the local delivery it holds. */
export interface LocalDeliveryRecord {
  source: Pick<AgentLocalSource, "version" | "format">;
  taskRef?: string;
  rnlAppearance?: RnlAppearance;
  /** The device types the Agent gave, as `canonicalModelTypes` states them. */
  modelTypes?: AgentLocalModelTypes;
}

/** What a new delivery asks for. */
export interface LocalDeliveryRequest {
  sourceVersion: string;
  rnlAppearance: RnlAppearance;
  taskRef?: string;
  modelTypes?: AgentLocalModelTypes;
}

/**
 * Device types as the import reads them: names in any case, so lower case
 * and sorted; none is no types at all.
 */
export function canonicalModelTypes(
  types: AgentLocalModelTypes | undefined,
): AgentLocalModelTypes | undefined {
  const entries = [
    ...new Map(
      Object.entries(types ?? {}).map(
        ([name, type]) => [name.toLowerCase(), type] as const,
      ),
    ),
  ].sort(([left], [right]) => left.localeCompare(right, "en"));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * Whether an open tab holds the copy a delivery asks for: the same files,
 * delivered the same way. The source version names the files alone, so the
 * way they were read counts too: an RNL appearance, and the device types an
 * Agent gave a netlist (#2377). A copy imported under other types is another
 * copy; reusing it would hand back parts drawn without the types asked for.
 */
export function matchesLocalDelivery(
  local: LocalDeliveryRecord | undefined,
  request: LocalDeliveryRequest,
): boolean {
  if (!local || local.source.version !== request.sourceVersion) return false;
  if (request.taskRef && local.taskRef && local.taskRef !== request.taskRef)
    return false;
  // Earlier RNL tabs did not record which appearance was requested.
  if (
    local.source.format === "rnl" &&
    local.rnlAppearance !== request.rnlAppearance
  )
    return false;
  // A native Project takes no device types.
  if (local.source.format === "project") return true;
  return (
    JSON.stringify(canonicalModelTypes(local.modelTypes) ?? null) ===
    JSON.stringify(canonicalModelTypes(request.modelTypes) ?? null)
  );
}
