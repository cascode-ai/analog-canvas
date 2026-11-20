import type { CircuitProject } from "@icm/model";
import {
  importSpiceSources,
  type SpiceCompileOptions,
  type SpiceDiagnostic,
  type SpiceImportOptions,
  type SpiceSourceInput,
} from "@icm/spice";
import { prepareImportSources } from "./convert-import-sources";

/**
 * How one caller reads netlist sources: the evidence it holds beyond the
 * files themselves. Every entry (File / Open, an Agent's local circuit, a
 * review's reference, RNL) reads through the same import; they differ only
 * in the evidence they bring.
 */
export interface NetlistImportPolicy {
  /** Device types of models the sources call but no card declares, by
   * name, as the caller states them. A card the sources give decides. */
  modelTypes?: Readonly<Record<string, string>>;
  namingProfile?: SpiceImportOptions["namingProfile"];
  compileOptions?: SpiceCompileOptions;
}

export type NetlistSourceImport =
  | {
      status: "imported";
      project: CircuitProject;
      diagnostics: SpiceDiagnostic[];
    }
  | { status: "refused"; diagnostics: SpiceDiagnostic[] };

export async function importNetlistSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  policy: NetlistImportPolicy = {},
): Promise<NetlistSourceImport> {
  const prepared = prepareImportSources(inputs);
  const result = await importSpiceSources(
    prepared.inputs,
    entryPath,
    policy.compileOptions ?? {},
    {
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
      modelTypes: new Map([
        ...Object.entries(policy.modelTypes ?? {}),
        ...prepared.modelTypes,
      ]),
      ...(policy.namingProfile ? { namingProfile: policy.namingProfile } : {}),
    },
  );
  const diagnostics = [...prepared.diagnostics, ...result.diagnostics];
  return result.successful && result.project
    ? { status: "imported", project: result.project, diagnostics }
    : { status: "refused", diagnostics };
}
