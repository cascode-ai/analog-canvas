import {
  ProjectSimulationFolderSchema,
  SimulationExperimentConfigSchema,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "./schema.js";

/** The same small starter text for a human or Agent; no hidden analyses writer. */
export function createSimulationFolder(options: {
  id: string;
  name: string;
  profileId: string;
  documentId?: string;
  template?: "op" | "ac" | "tran";
}): ProjectSimulationFolder {
  const config = SimulationExperimentConfigSchema.parse({
    version: 1,
    environment: { profileId: options.profileId },
  });
  return ProjectSimulationFolderSchema.parse({
    id: options.id,
    name: options.name,
    version: 4,
    input: {
      kind: "source",
      entry: "run.cir",
      configPath: "experiment.json",
      files: [
        {
          path: "run.cir",
          text: [
            `* ${options.name.replace(/[\r\n]/gu, " ")}`,
            ...(options.documentId ? ['.include "circuit.spice"'] : []),
            ".control",
            "set filetype=ascii",
            "set appendwrite",
            options.template === "ac"
              ? "ac dec 20 1 1G"
              : options.template === "tran"
                ? "tran 1n 1u"
                : "op",
            "write out.raw",
            ".endc",
            ".end",
            "",
          ].join("\n"),
        },
        {
          path: "experiment.json",
          text: JSON.stringify(config, null, 2) + "\n",
        },
      ],
      circuitBindings: options.documentId
        ? [
            {
              id: "circuit",
              path: "circuit.spice",
              documentId: options.documentId,
              emission: "top-level",
            },
          ]
        : [],
      dependencies: [],
    },
  });
}

/** Broken JSON is normal authoring state, not a thrown error or a fallback configuration. */
export function readSimulationExperimentConfig(
  folder: ProjectSimulationFolder,
):
  | { ok: true; config: SimulationExperimentConfig }
  | {
      ok: false;
      message: string;
      path: string;
      fields: Array<{ field: string; message: string }>;
    } {
  const path = folder.input.configPath;
  const text = folder.input.files.find((file) => file.path === path)?.text;
  let value: unknown;
  try {
    value = JSON.parse(text ?? "");
  } catch {
    return {
      ok: false,
      message: "The experiment configuration must contain valid JSON",
      path,
      fields: [],
    };
  }
  const parsed = SimulationExperimentConfigSchema.safeParse(value);
  return parsed.success
    ? { ok: true, config: parsed.data }
    : {
        ok: false,
        message: "Correct the experiment configuration",
        path,
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      };
}

/** Pure helper: caller commits the returned source through the normal File/Project transaction. */
export function replaceSimulationExperimentConfig(
  folder: ProjectSimulationFolder,
  config: SimulationExperimentConfig,
): ProjectSimulationFolder {
  const text =
    JSON.stringify(SimulationExperimentConfigSchema.parse(config), null, 2) +
    "\n";
  return {
    ...folder,
    input: {
      ...folder.input,
      files: [
        ...folder.input.files.filter(
          (file) => file.path !== folder.input.configPath,
        ),
        { path: folder.input.configPath, text },
      ],
    },
  };
}
