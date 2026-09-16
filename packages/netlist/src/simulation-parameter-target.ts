import type { CircuitProject } from "@icm/model";

/** Mutates only the caller's run projection. Both legacy and native compilers share target resolution. */
export function applySimulationParameter(
  project: CircuitProject,
  target: {
    readonly documentId: string;
    readonly instanceId: string;
    readonly parameter: string;
  },
  value: string,
  source: string,
  codePrefix: string,
  requireExisting = false,
): { ok: true } | { ok: false; code: string; message: string } {
  const document = project.documents.find((d) => d.id === target.documentId);
  if (!document)
    return {
      ok: false,
      code: `${codePrefix}_DOCUMENT_MISSING`,
      message: `${source} Document does not exist: ${target.documentId}`,
    };
  const instance = document.instances.find((i) => i.id === target.instanceId);
  if (!instance?.netlist)
    return {
      ok: false,
      code: `${codePrefix}_INSTANCE_MISSING`,
      message: `${source} Instance is unavailable or has no netlist parameters: ${target.instanceId}`,
    };
  if (requireExisting && !(target.parameter in instance.netlist.parameters))
    return {
      ok: false,
      code: `${codePrefix}_PARAMETER_MISSING`,
      message: `${source} parameter does not exist: ${target.instanceId}.${target.parameter}`,
    };
  instance.netlist.parameters[target.parameter] = value;
  return { ok: true };
}
