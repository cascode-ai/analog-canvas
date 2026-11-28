import {
  ProjectSimulationFolderSchema,
  SimulationExperimentConfigSchema,
  NativeSimulationExperimentConfigSchema,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "./schema.js";

/**
 * The same small starter text for a human or Agent; no hidden analyses writer.
 * Without a Profile the folder has no configuration file and SPICE syntax: it
 * is the author's Testbench, run with their own simulator (#2110).
 */
export function createSimulationFolder(options: {
  id: string;
  name: string;
  profileId?: string | undefined;
  /** Resolved from the selected environment; not a second persisted authority. */
  engine?: "ngspice" | undefined;
  documentId?: string | undefined;
  /**
   * `testbench` is one entry file holding the DUT call, with no run steps;
   * the others are hosted-run starters.
   */
  template?: "op" | "ac" | "tran" | "testbench" | undefined;
  /** Supplied from the canonical netlist interface when authoring a textual TB. */
  dut?: { name: string; ports: string[] } | undefined;
}): ProjectSimulationFolder {
  if (options.template === "testbench") return testbenchFolder(options);
  const identifier = (name: string) => {
    if (!name || /\s/u.test(name))
      throw new Error(
        "A DUT identifier must be non-empty and contain no whitespace",
      );
    return name;
  };
  const config =
    options.profileId === undefined
      ? null
      : NativeSimulationExperimentConfigSchema.parse({
          version: 2,
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
        ...(options.dut
          ? [
              {
                path: "testbench.spice",
                text: [
                  "* Text Testbench — add your sources and loads here.",
                  `* DUT port order: ${options.dut.ports.map(identifier).join(" ")}`,
                  options.dut.ports.length
                    ? `XDUT ${[...options.dut.ports, options.dut.name].map(identifier).join(" ")}`
                    : "* This Cell has no formal ports. Add its interface and DUT call here, or run the Cell directly.",
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
              ? "* 1. Complete sources, loads and DUT connections in testbench.spice."
              : options.documentId
                ? "* 1. Check Canvas sources and model dependencies; set the analysis below."
                : "* 1. Add your circuit, sources and model includes above .control.",
            "* 2. Click Run.",
            options.template === "ac" || options.template === "tran"
              ? "* 3. Open Plot for waveforms; use Console to inspect errors."
              : "* 3. Open Operating Point for bias values; use Console to inspect errors.",
            ...(options.documentId ? ['.include "circuit.spice"'] : []),
            ...(options.dut ? ['.include "testbench.spice"'] : []),
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
        ...(config
          ? [
              {
                path: "experiment.json",
                text: JSON.stringify(config, null, 2) + "\n",
              },
            ]
          : []),
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

/**
 * An author's Testbench: one SPICE entry that includes the Cell and calls it.
 * The configuration path is reserved but holds no file until a Profile is
 * chosen, so nothing here depends on a hosted environment.
 */
function testbenchFolder(options: {
  id: string;
  name: string;
  documentId?: string | undefined;
  dut?: { name: string; ports: string[] } | undefined;
}): ProjectSimulationFolder {
  const dut = options.dut;
  if (dut && [dut.name, ...dut.ports].some((name) => !name || /\s/u.test(name)))
    throw new Error(
      "A DUT identifier must be non-empty and contain no whitespace",
    );
  const text = [
    // Short lines: they are read in the editor's side panel.
    `* ${options.name.replace(/[\r\n]/gu, " ")}`,
    "* Run with your own simulator and PDK.",
    "* circuit.spice: File › Export netlist.",
    "* Specs, e.g.  * @spec gain >= 60 unit=dB",
    ...(options.documentId ? ['.include "circuit.spice"'] : []),
    ...(dut
      ? dut.ports.length
        ? [`XDUT ${[...dut.ports, dut.name].join(" ")}`]
        : ["* The Cell has no pins: it is the bench."]
      : []),
    "* Sources, loads and analyses here.",
    ".end",
    "",
  ].join("\n");
  return ProjectSimulationFolderSchema.parse({
    id: options.id,
    name: options.name,
    version: 4,
    input: {
      kind: "source",
      entry: "testbench.spice",
      configPath: "experiment.json",
      files: [{ path: "testbench.spice", text }],
      circuitBindings: options.documentId
        ? [
            {
              id: "circuit",
              path: "circuit.spice",
              documentId: options.documentId,
              emission: dut?.ports.length ? "subcircuit" : "top-level",
            },
          ]
        : [],
      dependencies: [],
    },
  });
}

/** Broken JSON is normal authoring state, not a thrown error or a fallback configuration. */
function formatExperimentConfigIssues(
  issues: ReadonlyArray<{
    readonly code: string;
    readonly path: readonly PropertyKey[];
    readonly message: string;
    readonly keys?: readonly string[];
  }>,
  native: boolean,
): Array<{ field: string; message: string }> {
  const fields: Array<{ field: string; message: string }> = [];
  for (const issue of issues) {
    const basePath = issue.path.map(String).join(".");
    if (
      native &&
      issue.code === "unrecognized_keys" &&
      Array.isArray(issue.keys) &&
      issue.keys.length > 0
    ) {
      for (const key of issue.keys) {
        const field = basePath ? `${basePath}.${key}` : key;
        if (basePath === "environment" && key === "corner") {
          fields.push({
            field,
            message:
              'Native v2 experiment.json only accepts environment.profileId; select corners in SPICE source (.lib ...) and remove "corner" from experiment.json',
          });
        } else if (basePath === "environment" && key === "temperatureC") {
          fields.push({
            field,
            message:
              'Native v2 experiment.json only accepts environment.profileId; set temperature in SPICE source (.temp ...) and remove "temperatureC" from experiment.json',
          });
        } else if (basePath === "environment") {
          fields.push({
            field,
            message: `Native v2 experiment.json only accepts environment.profileId; remove "${key}" from experiment.json`,
          });
        } else {
          fields.push({
            field,
            message: `Native v2 experiment.json only accepts version and environment.profileId; define "${key}" in SPICE source and remove it from experiment.json`,
          });
        }
      }
      continue;
    }
    fields.push({ field: basePath, message: issue.message });
  }
  return fields;
}

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
        fields: formatExperimentConfigIssues(parsed.error.issues, native),
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
