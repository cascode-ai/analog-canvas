// Where Analog Canvas stands against RNL upstream (#2102): a report, never a
// gate. It names what is behind or out of step; each finding is for a person
// to act on in an upgrade pull request.
//
//   pnpm rnl:reconcile
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canvasPackageLock as lock } from "../apps/editor/src/features/netlist-export/rnl-canvas-package.ts";

const RUNTIME = "@rich-netlist/runtime";
const UPSTREAM_LOCK =
  "https://raw.githubusercontent.com/rich-netlist/rnl/main/packages.lock.json";

const newest = (versions) =>
  [...versions].sort((a, b) => {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  })[versions.length - 1];

/** The findings for a set of facts; each is one line a person acts on. */
export function reconcile(facts) {
  const findings = [];
  if (facts.runtimeLocked !== facts.runtimeLatest)
    findings.push(
      `runtime: locked ${facts.runtimeLocked}, npm has ${facts.runtimeLatest}`,
    );
  const written = newest(facts.canvasLocked);
  const published = newest(facts.canvasCatalog);
  if (written !== published)
    findings.push(
      `${lock.name}: the editor writes ${written}, the catalog's newest is ${published}`,
    );
  if (!facts.upstreamLocked.includes(written))
    findings.push(
      `${lock.name} ${written} is not in rnl's packages.lock.json (upstream CI does not read what Analog Canvas writes)`,
    );
  if (facts.privateReferences > 0)
    findings.push(
      `${facts.privateReferences} references to the private rnl-dev remain`,
    );
  return findings;
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function facts() {
  const editor = JSON.parse(
    await readFile(new URL("../apps/editor/package.json", import.meta.url)),
  );
  const [latest, catalog, upstream] = await Promise.all([
    json(`https://registry.npmjs.org/${RUNTIME}/latest`),
    json(lock.catalogUrl),
    json(UPSTREAM_LOCK),
  ]);
  const grep = (() => {
    // Published package files keep their bytes, header comments included.
    try {
      return execFileSync(
        "git",
        ["grep", "-c", "rnl-dev", "--", ".", ":!*.rnl"],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          encoding: "utf8",
        },
      );
    } catch {
      return ""; // no match
    }
  })();
  return {
    runtimeLocked: editor.dependencies[RUNTIME],
    runtimeLatest: latest.version,
    canvasLocked: lock.versions.map((item) => item.version),
    canvasCatalog: catalog.packages
      .filter((item) => item.name === lock.name)
      .map((item) => item.version),
    upstreamLocked: upstream.packages
      .filter((item) => item.name === lock.name)
      .map((item) => item.version),
    privateReferences: grep
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.startsWith("scripts/rnl-reconcile"))
      .reduce((sum, line) => sum + Number(line.split(":").at(-1)), 0),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = reconcile(await facts());
  console.log(
    findings.length
      ? findings.map((line) => `- ${line}`).join("\n")
      : "RNL upstream and Analog Canvas are in step.",
  );
}
