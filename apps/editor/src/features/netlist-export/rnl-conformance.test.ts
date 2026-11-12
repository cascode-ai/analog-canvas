// Analog Canvas's driver for the RNL conformance suite
// (https://github.com/rich-netlist/rnl-benchmark, `conformance/`): the
// suite's files go into Analog Canvas and are written out again, and the
// suite grades what comes out against what went in with the RNL runtime
// alone, as it grades any tool. Skipped unless one of its modes is asked for:
//
//   Write the suite's files from Gallery circuits (a Gallery download):
//     RNL_CONF_PROJECTS=<download>/entries RNL_CONF_IDS=<selection.json>
//     RNL_CONF_OUT=<conformance>/cases
//   Read each case and write it again, for grading:
//     RNL_CONF_CORPUS=<conformance>/cases RNL_CONF_OUT=<out dir>
//
//   npx vitest run apps/editor/src/features/netlist-export/rnl-conformance.test.ts
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, it } from "vitest";

import { parseProject } from "@icm/project-protocol";
import { createRnlExport } from "@icm/rnl";

import { createRnlTestCore } from "./rnl-core.test-support";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

const PROJECTS = process.env.RNL_CONF_PROJECTS ?? "";
const IDS = process.env.RNL_CONF_IDS ?? "";
const CORPUS = process.env.RNL_CONF_CORPUS ?? "";
const OUT = process.env.RNL_CONF_OUT ?? "";
const NETLIST = /\.(sp|spi|cir|net|scs)$/iu;

const core = (PROJECTS || CORPUS) && OUT ? await createRnlTestCore() : null;
afterAll(() => core?.terminate());
const runtime = core as unknown as RnlRuntime;

const formatOf = (path: string) =>
  /\.scs$/iu.test(path) ? ("spectre" as const) : ("spice" as const);

/** Every file below a directory, by its path relative to it. */
function filesIn(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? filesIn(root, path)
      : [relative(root, path)];
  });
}

describe.skipIf(!(PROJECTS && IDS && OUT))("write the suite's files", () => {
  const ids =
    PROJECTS && IDS ? Object.keys(JSON.parse(readFileSync(IDS, "utf8"))) : [];
  it.each(ids)(
    "%s",
    async (id) => {
      const saved = JSON.parse(
        readFileSync(join(PROJECTS, `${id}.json`), "utf8"),
      ) as { projectText: string };
      const project = parseProject(saved.projectText);
      mkdirSync(join(OUT, id), { recursive: true });
      for (const format of ["spice", "spectre"] as const) {
        const exported = createRnlExport(project, { format });
        if (exported.status !== "ready") continue;
        const { text } = await runtime.write({
          write: exported.request,
          svg: false,
        });
        writeFileSync(
          join(OUT, id, `${id}.${format === "spice" ? "sp" : "scs"}`),
          text,
        );
      }
    },
    300_000,
  );
});

describe.skipIf(!(CORPUS && OUT))("read each case and write it again", () => {
  const cases = CORPUS
    ? readdirSync(CORPUS).filter((name) =>
        statSync(join(CORPUS, name)).isDirectory(),
      )
    : [];
  const entries = cases.flatMap((name) => {
    const files = filesIn(join(CORPUS, name));
    const manifest = files.includes("case.json")
      ? (JSON.parse(readFileSync(join(CORPUS, name, "case.json"), "utf8")) as {
          entries?: string[];
        })
      : {};
    return (manifest.entries ?? files.filter((path) => NETLIST.test(path))).map(
      (entry) => [name, entry, files] as const,
    );
  });
  it.each(entries)(
    "%s %s",
    async (name, entry, files) => {
      const out = join(OUT, name);
      mkdirSync(out, { recursive: true });
      const report: Record<string, unknown> = { case: name, entry };
      const format = formatOf(entry);
      try {
        const plan = await planRnlImport({
          inputs: files.map((path) => ({
            path,
            bytes: readFileSync(join(CORPUS, name, path)),
          })),
          entryPath: entry,
          runtime,
        });
        report.import = plan.status;
        report.importDiagnostics = plan.diagnostics.map((item) => item.code);
        if (plan.status === "ready") {
          const exported = createRnlExport(plan.project, { format });
          report.export = exported.status;
          if (exported.status === "ready") {
            const { text } = await runtime.write({
              write: exported.request,
              svg: false,
            });
            writeFileSync(join(out, entry.replace(/\//gu, "__")), text);
          }
        }
      } catch (error) {
        report.error = String(error).slice(0, 2000);
      }
      writeFileSync(
        join(out, `${entry.replace(/\//gu, "__")}.driver.json`),
        `${JSON.stringify(report, null, 1)}\n`,
      );
    },
    // A whole design written elsewhere (ext-risca, 1.3 MB) takes minutes.
    3_600_000,
  );
});
