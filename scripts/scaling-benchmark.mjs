import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  arch,
  cpus,
  freemem,
  hostname,
  platform,
  release,
  totalmem,
} from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

import { browserContext, measureBrowser } from "./lib/scaling-browser.mjs";
import {
  createScalingInputs,
  createSharedSupplyInput,
  verifyScalingInput,
} from "./lib/scaling-fixtures.mjs";
import {
  assembleReport,
  compareReports,
  matrix,
  readJson,
  sha256,
  summarize,
} from "./lib/scaling-metrics.mjs";
import { productModule, sharedSupply } from "./lib/scaling-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {
  values: opts,
  positionals: [command],
} = parseArgs({
  allowPositionals: true,
  options: {
    checkout: { type: "string" },
    dist: { type: "string" },
    inputs: { type: "string" },
    output: { type: "string" },
    compare: { type: "string" },
    group: { type: "string" },
    case: { type: "string" },
    resume: { type: "boolean" },
    channel: { type: "string", default: "chrome" },
  },
});
const checkout = resolve(opts.checkout ?? root);
const directory = resolve(opts.inputs ?? join(root, "output/scaling/inputs"));
const output = resolve(
  opts.output ?? join(root, "output/scaling/measurements"),
);
const file = (name) => join(directory, name + ".icproj.json");
function write(path, value) {
  const pending = path + "." + process.pid + ".tmp";
  writeFileSync(pending, JSON.stringify(value, null, 2) + "\n");
  renameSync(pending, path);
}
const manifestFile = join(directory, "manifest.json");

async function prepare() {
  mkdirSync(directory, { recursive: true });
  const { importSpiceSources } = await productModule(root, "spice");
  const generated = createScalingInputs();
  generated.set(
    "high-fanout",
    await createSharedSupplyInput(importSpiceSources),
  );
  for (const [name, bytes] of generated) {
    verifyScalingInput(name, bytes);
    writeFileSync(file(name), bytes);
  }
  const example = "five-transistor-ota";
  copyFileSync(
    join(root, "apps/editor/public/office/examples", example + ".icproj.json"),
    file(example),
  );
  const manifest = readJson(
    join(root, "fixtures/projects/compatibility-corpus.json"),
  );
  const corpus = [
    ...manifest.current.map((path) => ({ path })),
    ...manifest.migrated,
    ...manifest.rejected,
  ];
  for (const [i, entry] of corpus.entries()) {
    entry.name = "corpus-" + i;
    copyFileSync(join(root, entry.path), file(entry.name));
  }
  const names = [...generated.keys(), example, ...corpus.map((e) => e.name)];
  const hashes = Object.fromEntries(
    names.map((name) => [name, sha256(readFileSync(file(name)))]),
  );
  write(manifestFile, { hashes, corpus });
  console.log("Prepared", names.length, "portable inputs in", directory);
}

async function corpusSignatures(parseProject, corpus) {
  const result = {};
  for (const entry of corpus) {
    const body = readFileSync(file(entry.name), "utf8");
    if (entry.error) {
      let failure;
      try {
        parseProject(body);
      } catch (error) {
        failure = { name: error.name, message: error.message };
      }
      assert.ok(
        failure?.message.includes(entry.error),
        "Expected documented rejection for " + entry.path,
      );
      result[entry.path] = failure;
    } else {
      const project = parseProject(body);
      assert.ok(
        project.documents.some((doc) => doc.id === project.topDocumentId),
      );
      result[entry.path] = sha256(JSON.stringify(project));
    }
  }
  return result;
}

async function measure() {
  const selected = Object.entries(matrix).flatMap(([group, entry]) =>
    entry.cases
      .filter(
        (name) =>
          (!opts.group ||
            group === opts.group ||
            entry.family === opts.group) &&
          (!opts.case || name === opts.case),
      )
      .map((name) => ({ group, name })),
  );
  assert.ok(
    selected.length,
    "No matching group/case. Groups: " + Object.keys(matrix).join(", "),
  );
  const { hashes, corpus } = readJson(manifestFile);
  for (const [name, expected] of Object.entries(hashes)) {
    assert.equal(
      sha256(readFileSync(file(name))),
      expected,
      "Input changed after prepare: " + name,
    );
  }
  const dist = resolve(opts.dist ?? join(checkout, "apps/editor/dist"));
  const build = sha256(readFileSync(join(dist, "index.html")));
  const harnessFiles = [
    "scripts/scaling-benchmark.mjs",
    ...["browser", "contracts", "fixtures", "metrics", "model"].map(
      (part) => "scripts/lib/scaling-" + part + ".mjs",
    ),
    "apps/editor/e2e/editor-fixtures.ts",
    "apps/editor/src/canvas/fit-view.ts",
    "pnpm-lock.yaml",
  ];
  const harness = sha256(
    JSON.stringify(
      harnessFiles.map((path) => [
        path,
        sha256(readFileSync(join(root, path))),
      ]),
    ),
  );
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim();
  const { parseProject } = await productModule(checkout, "project-protocol");
  const editor = join(checkout, "apps/editor");
  const require = createRequire(join(editor, "package.json"));
  const { preview } = await import(pathToFileURL(require.resolve("vite")).href);
  const server = await preview({
    root: editor,
    build: { outDir: dist },
    logLevel: "silent",
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  let browser;
  try {
    browser = await chromium.launch({
      ...(opts.channel !== "chromium" && { channel: opts.channel }),
      headless: true,
    });
    const environment = {
      host: hostname(),
      os: platform() + " " + release(),
      arch: arch(),
      cpu: cpus()[0].model,
      ramBytes: totalmem(),
      node: process.version,
      browser: browser.version(),
      channel: opts.channel,
      viewport: browserContext.viewport,
      dpr: browserContext.deviceScaleFactor,
    };
    const url = server.resolvedUrls.local[0];
    mkdirSync(output, { recursive: true });
    for (const { group, name } of selected) {
      const reportFile = join(output, group + "-" + name + ".json");
      if (opts.resume && existsSync(reportFile)) {
        let prior;
        try {
          prior = readJson(reportFile);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (
          prior?.complete &&
          Object.entries(matrix[group].counts).every(
            ([metric, n]) => prior.metrics?.[metric]?.n >= n,
          ) &&
          prior.commit === commit &&
          prior.build === build &&
          prior.harness === harness &&
          JSON.stringify(prior.inputs) === JSON.stringify(hashes) &&
          JSON.stringify(prior.environment) === JSON.stringify(environment)
        )
          continue;
      }
      const report = {
        group,
        name,
        commit,
        build,
        harness,
        inputs: hashes,
        environment,
        startedAt: new Date().toISOString(),
        freeBytesBefore: freemem(),
        sampling:
          group === "open"
            ? "fresh ready editor context per file open"
            : group === "agent"
              ? "one warm-up each discarded; model trace call and real HTTP request to complete 129-location, 16512-hop response measured separately"
              : group === "exports"
                ? "semantic comparison outside timings"
                : "one warm-up discarded per action",
      };
      write(reportFile, report);
      console.log("Measuring", group, name);
      try {
        const bytes = readFileSync(file(name));
        const project = parseProject(bytes.toString("utf8"));
        let metrics;
        if (group === "model") {
          // The external process keeps JIT state and allocations isolated across input sizes and revisions.
          const worker = fileURLToPath(
            new URL("./lib/scaling-model.mjs", import.meta.url),
          );
          const result = JSON.parse(
            execFileSync(process.execPath, [worker, checkout, file(name)], {
              encoding: "utf8",
            }),
          );
          metrics = result.metrics;
          report.signatures = result.signatures;
        } else if (matrix[group].family === "contracts") {
          const { contractSignatures } =
            await import("./lib/scaling-contracts.mjs");
          const measured = await contractSignatures({
            checkout,
            browser,
            url,
            file: file(name),
            name,
            project,
            directory,
          });
          report.signatures = measured.signatures;
          metrics = measured.metrics;
          if (name === "five-transistor-ota")
            report.signatures.files = await corpusSignatures(
              parseProject,
              corpus,
            );
        } else {
          const supply =
            group === "trace"
              ? await sharedSupply(checkout, project)
              : undefined;
          report.workload = {};
          metrics = await measureBrowser({
            browser,
            url,
            file: file(name),
            name,
            project,
            group,
            family: matrix[group].family,
            supply,
            workload: report.workload,
          });
        }
        report.metrics = Object.fromEntries(
          Object.entries(matrix[group].counts).map(([key, n]) => [
            key,
            summarize(metrics[key] ?? [], n),
          ]),
        );
        report.complete = true;
      } catch (error) {
        report.failure = String(error.stack ?? error);
        throw error;
      } finally {
        report.freeBytesAfter = freemem();
        write(reportFile, report);
      }
    }
  } finally {
    await browser?.close();
    server.httpServer.closeAllConnections();
    await server.close();
  }
}

if (command === "prepare") await prepare();
else if (command === "measure") await measure();
else if (command === "report") {
  const report = assembleReport(output);
  if (opts.compare)
    report.comparison = compareReports(
      assembleReport(resolve(opts.compare)),
      report,
    );
  write(join(output, "report.json"), report);
  console.log(
    "Verified",
    Object.keys(report.results).length,
    "group/case reports for",
    report.commit,
  );
} else
  throw new Error(
    "Use prepare [--inputs DIR], measure [--checkout BUILT_CHECKOUT] [--dist DIR] [--inputs DIR] [--output DIR] [--group GROUP] [--case CASE] [--resume], or report [--output DIR] [--compare BASELINE_DIR].",
  );
