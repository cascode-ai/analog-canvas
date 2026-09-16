import {
  ProjectSimulationFolderSchema,
  SimulationExperimentConfigSchema,
  NativeSimulationExperimentConfigSchema,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "./schema.js";

/** The same small starter text for a human or Agent; no hidden analyses writer. */
export function createSimulationFolder(options: {
  id: string;
  name: string;
  profileId: string;
  /** Resolved from the selected environment; not a second persisted authority. */
  engine?: "ngspice" | "vacask";
  documentId?: string;
  template?: "op" | "ac" | "tran";
  /** Supplied from the canonical netlist interface when authoring a textual TB. */
  dut?: { name: string; ports: string[] };
}): ProjectSimulationFolder {
  const ngspice = options.engine === "ngspice";
  const comment = ngspice ? "*" : "//";
  // Always-quoted interface identifiers preserve exact case and punctuation.
  // These are names, not source snippets; never interpolate new statements.
  const identifier = (name: string) => {
    if (!name || /\s/u.test(name))
      throw new Error(
        "A native DUT identifier must be non-empty and contain no whitespace",
      );
    return ngspice ? name : `'${name.replaceAll("'", "''")}'`;
  };
  const config = NativeSimulationExperimentConfigSchema.parse({
    version: 2,
    environment: { profileId: options.profileId },
  });
  return ProjectSimulationFolderSchema.parse({
    id: options.id,
    name: options.name,
    version: 4,
    input: {
      kind: "source",
      // Virtual filenames remain stable for the workspace/API. Syntax is native
      // VACASK regardless of extension; it is never selected by the filename.
      entry: "run.cir",
      configPath: "experiment.json",
      files: [
        ...(options.dut
          ? [
              {
                path: "testbench.spice",
                text: [
                  `${comment} Text Testbench — add your sources and loads here.`,
                  `${comment} DUT port order: ${options.dut.ports.map(identifier).join(" ")}`,
                  options.dut.ports.length
                    ? ngspice
                      ? `XDUT ${[...options.dut.ports, options.dut.name].map(identifier).join(" ")}`
                      : `XDUT (${options.dut.ports.map(identifier).join(" ")}) ${identifier(options.dut.name)}`
                    : `${comment} This Cell has no formal ports. Add its interface and DUT call here, or run the Cell directly.`,
                  "",
                ].join("\n"),
              },
            ]
          : []),
        {
          path: "run.cir",
          text: [
            options.name.replace(/[\r\n]/gu, " "),
            options.dut
              ? `${comment} 1. Complete sources, loads and DUT connections in testbench.spice.`
              : options.documentId
                ? `${comment} 1. Check Canvas sources and model dependencies; set the analysis below.`
                : `${comment} 1. Add your circuit, sources and model includes above ${ngspice ? ".control" : "control"}.`,
            `${comment} 2. Click Run.`,
            options.template === "ac" || options.template === "tran"
              ? `${comment} 3. Open Plot for waveforms; use Console to inspect errors.`
              : `${comment} 3. Open Operating Point for bias values; use Console to inspect errors.`,
            ...(ngspice ? [] : ["ground 0"]),
            ...(options.documentId
              ? [`${ngspice ? "." : ""}include "circuit.spice"`]
              : []),
            ...(options.dut
              ? [`${ngspice ? "." : ""}include "testbench.spice"`]
              : []),
            ngspice ? ".control" : "control",
            ...(ngspice
              ? ["set filetype=ascii", "set appendwrite"]
              : ['options rawfile="ascii" strictsave=2', "save default"]),
            options.template === "ac"
              ? ngspice
                ? "ac dec 20 1 1G"
                : 'analysis ac ac from=1 to=1G mode="dec" points=20'
              : options.template === "tran"
                ? ngspice
                  ? "tran 1n 1u"
                  : "analysis tran tran step=1n stop=1u"
                : ngspice
                  ? "op"
                  : "analysis op op",
            ...(ngspice ? ["write out.raw", ".endc", ".end"] : ["endc"]),
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
              emission: options.dut ? "subcircuit" : "top-level",
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
  | {
      ok: true;
      config: SimulationExperimentConfig;
      authority: "code" | "legacy-config";
    }
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
  const native =
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 2;
  const parsed = native
    ? NativeSimulationExperimentConfigSchema.safeParse(value)
    : SimulationExperimentConfigSchema.safeParse(value);
  return parsed.success
    ? {
        ok: true,
        authority: native ? "code" : "legacy-config",
        // Compatibility-shaped execution metadata is derived, never persisted beside Code.
        config: native
          ? SimulationExperimentConfigSchema.parse({
              version: 1,
              environment: parsed.data.environment,
            })
          : (parsed.data as SimulationExperimentConfig),
      }
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
