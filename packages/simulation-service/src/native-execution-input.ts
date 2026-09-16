import { z } from "zod";
import {
  isSimulationInputPath,
  SimulationRawFileSchema,
  SimulationRawDependencySchema,
} from "@icm/model";
import { EnvironmentSchema, type Problem } from "./contract.js";
import type { ExecutionInput } from "./executor.js";

export interface NativeInputPolicy {
  profileId: string;
  dependencies: readonly { id: string; sha256: string }[];
  maxInputFiles: number;
  maxInputBytes: number;
}
const fail = (
  code: string,
  message: string,
  recovery: Problem["recovery"] = "fix-input",
) => ({
  ok: false as const,
  error: { code, message, stage: "start" as const, recovery },
});
const fields = z.object({
  entryPath: z.string().refine(isSimulationInputPath),
  files: z.array(SimulationRawFileSchema).min(1),
  dependencies: z.array(SimulationRawDependencySchema),
});

/** One portable admission check for Worker and native harness. It validates
 * existing ExecutionInput, not source syntax or a second persisted protocol. */
export function validateNativeExecutionInput(
  value: unknown,
  policy: NativeInputPolicy,
): { ok: true; input: ExecutionInput } | { ok: false; error: Problem } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(
      "native-input-required",
      "Native VACASK source input is required.",
    );
  const body = value as Record<string, unknown>;
  if (
    body.language !== "vacask" ||
    body.mode !== "raw" ||
    !z
      .strictObject({ kind: z.literal("native-multi-ascii") })
      .safeParse(body.collection).success
  )
    return fail(
      "native-input-required",
      "Only native VACASK source and its native collector are accepted.",
    );
  const environment = EnvironmentSchema.safeParse(body.environment);
  if (!environment.success || environment.data.profileId !== policy.profileId)
    return fail(
      "prepared-environment-changed",
      "Prepare against this runtime Profile.",
      "reprepare",
    );
  const parsed = fields.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.files.length + parsed.data.dependencies.length >
      policy.maxInputFiles
  )
    return fail(
      "invalid-input-files",
      "Invalid input files or dependency paths, or too many files.",
    );
  const { files, dependencies, entryPath } = parsed.data;
  const paths = [
    ...files.map((f) => f.path),
    ...dependencies.map((d) => d.mountPath),
  ];
  if (
    paths.some((path, i) =>
      paths
        .slice(i + 1)
        .some(
          (other) =>
            path === other ||
            path.startsWith(`${other}/`) ||
            other.startsWith(`${path}/`),
        ),
    )
  )
    return fail(
      "invalid-input-files",
      "File and dependency ownership must be unique and disjoint.",
    );
  const entry = files.find((file) => file.path === entryPath);
  if (
    !entry ||
    body.preparedDeck !== entry.text ||
    body.testbench !== entry.text ||
    body.netlist !== ""
  )
    return fail(
      "prepared-input-changed",
      "Prepared entry and submitted source bytes differ.",
      "reprepare",
    );
  if (
    files.reduce(
      (sum, f) => sum + new TextEncoder().encode(f.text).byteLength,
      0,
    ) > policy.maxInputBytes
  )
    return fail(
      "input-too-large",
      "Native input files exceed the combined byte limit.",
    );
  for (const dependency of dependencies)
    if (
      !policy.dependencies.some(
        (d) => d.id === dependency.id && d.sha256 === dependency.sha256,
      )
    )
      return fail(
        "simulation-dependency-unavailable",
        `Dependency ${dependency.id} does not match this runtime.`,
        "reprepare",
      );
  if (
    body.runToken !== undefined &&
    (typeof body.runToken !== "string" ||
      !/^[0-9a-f-]{36}$/u.test(body.runToken))
  )
    return fail("invalid-run-token", "Invalid execution token.");
  if (
    typeof body.inputRevision !== "string" ||
    !body.inputRevision ||
    body.inputRevision.length > 256
  )
    return fail(
      "prepared-input-identity-missing",
      "Prepare a revision-bound input before executing.",
      "reprepare",
    );
  return {
    ok: true,
    input: {
      language: "vacask",
      mode: "raw",
      netlist: "",
      testbench: entry.text,
      preparedDeck: entry.text,
      inputRevision: body.inputRevision,
      environment: environment.data,
      files,
      dependencies,
      entryPath,
      collection: { kind: "native-multi-ascii" },
    },
  };
}
