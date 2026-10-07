import { z } from "zod";
import { StableIdSchema } from "./common.js";
import {
  MAX_SIMULATION_INPUT_BYTES,
  SimulationInputPathSchema,
  SimulationRawFileSchema,
  SimulationRawDependencySchema,
} from "./simulation.js";

/** Applied native model source; draft text never replaces executable bytes. */
export const ProjectModelSourceSchema = z
  .strictObject({
    id: StableIdSchema,
    language: z.literal("spice"),
    entry: SimulationInputPathSchema,
    files: z.array(SimulationRawFileSchema).min(1).max(256),
    dependencies: z.array(SimulationRawDependencySchema).max(256).default([]),
    revision: z.number().int().nonnegative(),
    draft: z
      .strictObject({
        entry: SimulationInputPathSchema,
        files: z.array(SimulationRawFileSchema).min(1).max(256),
        baseRevision: z.number().int().nonnegative(),
        dependencies: z
          .array(SimulationRawDependencySchema)
          .max(256)
          .optional(),
      })
      .optional(),
  })
  .superRefine((source, context) => {
    const validate = (
      input: {
        entry: string;
        files: { path: string; text: string }[];
        dependencies: { id: string; mountPath: string }[];
      },
      prefix: string[],
    ) => {
      const paths = new Set<string>();
      let bytes = 0;
      for (const [index, file] of input.files.entries()) {
        if (paths.has(file.path))
          context.addIssue({
            code: "custom",
            message: "Duplicate model source path",
            path: [...prefix, "files", index, "path"],
          });
        paths.add(file.path);
        bytes += new TextEncoder().encode(file.text).byteLength;
      }
      if (bytes > MAX_SIMULATION_INPUT_BYTES)
        context.addIssue({
          code: "custom",
          message: "Model source exceeds 1 MiB",
          path: [...prefix, "files"],
        });
      if (!paths.has(input.entry))
        context.addIssue({
          code: "custom",
          message: "Model entry must address an owned source file",
          path: [...prefix, "entry"],
        });
      const dependencyIds = new Set<string>();
      for (const [index, dependency] of input.dependencies.entries()) {
        if (dependencyIds.has(dependency.id))
          context.addIssue({
            code: "custom",
            message: "Duplicate model dependency identity",
            path: [...prefix, "dependencies", index, "id"],
          });
        dependencyIds.add(dependency.id);
        if (paths.has(dependency.mountPath))
          context.addIssue({
            code: "custom",
            message: "Model path has more than one owner",
            path: [...prefix, "dependencies", index, "mountPath"],
          });
        paths.add(dependency.mountPath);
      }
    };
    validate(source, []);
    if (source.draft)
      validate(
        {
          ...source.draft,
          dependencies: source.draft.dependencies ?? source.dependencies,
        },
        ["draft"],
      );
  });
