import { mkdir, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ResultCatalog } from "@icm/simulation-service/contract";
import { LocalWorkspace } from "./local-workspace.js";
import { plotTemplate } from "./plot-template.js";

const Vector = z.strictObject({
  signal: z.string().min(1),
  component: z.enum(["real", "imag", "magnitude", "phase"]).optional(),
  unit: z.string().min(1).optional(),
});
export const PreparePlotSchema = z.strictObject({
  action: z.literal("prepare-plot"),
  runId: z.string().min(1),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u),
  title: z.string().optional(),
  formats: z
    .array(z.enum(["png", "svg", "pdf"]))
    .min(1)
    .optional(),
  panels: z
    .array(
      z.strictObject({
        analysisIndex: z.number().int().nonnegative(),
        x: Vector.optional(),
        signals: z
          .array(Vector.extend({ label: z.string().optional() }))
          .min(1),
        title: z.string().optional(),
        xLabel: z.string().optional(),
        yLabel: z.string().optional(),
        xScale: z.enum(["linear", "log"]).optional(),
        yScale: z.enum(["linear", "log"]).optional(),
        xRange: z.tuple([z.number(), z.number()]).optional(),
        yRange: z.tuple([z.number(), z.number()]).optional(),
        legend: z.boolean().optional(),
      }),
    )
    .min(1),
});

/** Preparation never executes Python or overwrites an existing customization. */
export async function preparePlot(
  workspace: LocalWorkspace,
  catalog: ResultCatalog,
  request: z.infer<typeof PreparePlotSchema>,
  fetchArtifact: Parameters<LocalWorkspace["sync"]>[1],
) {
  const selections = request.panels.map((panel) => {
    const dataset = catalog.datasets.find(
      (d) => d.analysisIndex === panel.analysisIndex,
    );
    if (!dataset?.axis) throw new Error("PLOT_REQUIRES_SAMPLED_ANALYSIS");
    const tables = catalog.files.filter(
      (file) =>
        file.role === "table" &&
        dataset.representations.some(
          (r) =>
            r.artifactId === file.id || r.fileId === (file.fileId ?? file.id),
        ),
    );
    if (tables.length !== 1) throw new Error("PLOT_TABLE_MISSING_OR_AMBIGUOUS");
    const x = panel.x ?? { signal: dataset.axis.name };
    for (const selection of [x, ...panel.signals]) {
      if (
        selection.signal !== dataset.axis.name &&
        !dataset.signals.some((s) => s.name === selection.signal)
      )
        throw new Error(`PLOT_SIGNAL_NOT_IN_DATASET: ${selection.signal}`);
    }
    return { panel, x, table: tables[0]! };
  });
  // Reserve the whole directory before downloading: repeated calls cannot mix
  // a new config with a previously customized script (including concurrent calls).
  const parent = join(workspace.basePath, "plots");
  await mkdir(parent, { recursive: true });
  const directory = join(parent, request.name);
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return {
      ok: false,
      error: {
        code: "PLOT_ALREADY_EXISTS",
        message:
          "Edit the existing local copy, or choose a new name. No files were changed.",
      },
      directory,
    };
  }
  const sync = await workspace.sync(catalog, fetchArtifact, [
    ...new Set(selections.map((s) => s.table.fileId ?? s.table.id)),
  ]);
  if (!sync.ok) {
    // Remove only our still-empty reservation; never delete a user-created file.
    await rmdir(directory).catch(() => undefined);
    return { ...sync, directory };
  }
  const config = {
    title: request.title ?? "",
    formats: request.formats ?? ["png"],
    panels: selections.map(({ panel, x, table }) => {
      const { analysisIndex: _index, signals, x: _x, ...style } = panel;
      const downloaded = sync.files.find((f) => f.id === table.id);
      if (!downloaded) throw new Error("PLOT_DOWNLOAD_MISSING");
      return {
        ...style,
        curves: signals.map(({ label, ...y }) => ({
          csv: downloaded.outputPath,
          x,
          y,
          ...(label === undefined ? {} : { label }),
        })),
      };
    }),
  };
  const scriptPath = join(directory, "plot.py");
  const configPath = join(directory, "plot.json");
  await writeFile(scriptPath, plotTemplate, { flag: "wx" });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
    flag: "wx",
  });
  return {
    ok: true,
    status: "prepared",
    filesystem: "mcp-host",
    directory,
    scriptPath,
    configPath,
    execution: {
      executable: "python",
      args: [scriptPath, configPath],
      requirements: ["Python >=3.10", "matplotlib"],
    },
    next: "Run locally using an available Python environment, then inspect the image. Edit these copies for custom plots; the installed template is unchanged.",
  };
}
