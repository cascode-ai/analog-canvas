// Where Analog Canvas stands against RNL upstream (#2102): a report, never a
// gate. It names what is behind or out of step; each finding is for a person
// to act on in an upgrade pull request. First, the version line: Analog
// Canvas reads and writes one RNL language, which the released rnl tools and
// RNL Skill must read and teach.
//
//   pnpm rnl:reconcile [-- --markdown]
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canvasPackageLock as lock } from "../apps/editor/src/features/netlist-export/rnl-canvas-package.ts";

const RUNTIME = "@rich-netlist/runtime";
const REPO = "rich-netlist/rnl";
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}`;

/** Compare dotted version numbers by number: 0.10 after 0.9. */
const byVersion = (a, b) => {
  const [x, y] = [a, b].map((v) =>
    v.split(/[.-]/u).map((part) => Number(part) || 0),
  );
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const newest = (versions) => [...versions].sort(byVersion).at(-1);

/** The language an RNL Skill teaches, from its title, or null. */
export const skillLanguage = (text) =>
  /^# RNL \(Rich Netlist\) (\d+\.\d+)/mu.exec(text ?? "")?.[1] ?? null;

/** The findings for a set of facts; each is one line a person acts on. */
export function reconcile(facts) {
  const findings = [];
  const { line } = facts;
  const short = (sha) => sha.slice(0, 8);
  // The version line: what Canvas reads and writes must be what the released
  // tools read and the released guide teaches.
  const released = facts.releasedCore;
  const behind = [
    ...(byVersion(released, line.toolsRelease) < 0
      ? [
          `the latest rnl release, core ${released}, comes before ${line.toolsRelease}, the first to read it,`,
        ]
      : []),
    ...(facts.releasedSkillLanguage !== line.language
      ? [
          `its RNL Skill teaches ${facts.releasedSkillLanguage ?? "no language"}`,
        ]
      : []),
  ];
  if (behind.length)
    findings.push(
      `version line: Analog Canvas reads and writes RNL ${line.language}, but ${behind.join(" and ")}: no released tool or guide writes what Analog Canvas reads`,
    );
  if (facts.mainSkillLanguage !== line.language)
    findings.push(
      `the RNL Skill on rnl main teaches ${facts.mainSkillLanguage ?? "no language"}, not ${line.language}`,
    );
  // The runtime: a release, or one commit of main until a release reads the
  // language.
  if (line.runtime.source === "commit") {
    findings.push(
      `runtime: built from rnl main ${short(line.runtime.commit)}, unreleased; npm has ${facts.runtimeLatest}`,
    );
    if (facts.commitsBehindMain > 0)
      findings.push(
        `runtime: ${facts.commitsBehindMain} commits behind rnl main (${short(facts.mainHead)})`,
      );
    if (byVersion(facts.runtimeLatest, line.toolsRelease) >= 0)
      findings.push(
        `runtime: npm ${facts.runtimeLatest} reads RNL ${line.language}; replace the vendored build with it`,
      );
  } else if (line.runtime.version !== facts.runtimeLatest)
    findings.push(
      `runtime: locked ${line.runtime.version}, npm has ${facts.runtimeLatest}`,
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

/** The report as Markdown, for the comment on #2102. */
export function markdown(findings, facts, date) {
  const { line } = facts;
  return [
    `### RNL upstream reconcile, ${date}`,
    "",
    findings.length
      ? findings.map((item) => `- ${item}`).join("\n")
      : "RNL upstream and Analog Canvas are in step.",
    "",
    `Analog Canvas: RNL ${line.language}, standard series ${line.standardSeries}, ${lock.name} ${newest(facts.canvasLocked)}, runtime ${line.runtime.version} (${line.runtime.built}). Upstream: core ${facts.releasedCore} released, main ${facts.mainHead.slice(0, 8)}.`,
    "",
    "Reported by `pnpm rnl:reconcile` (`.github/workflows/rnl-reconcile.yml`); it never blocks.",
  ].join("\n");
}

/** A URL's answer; a reset connection is tried twice more. */
async function fetched(url, as, tries = 3) {
  const headers =
    process.env.GH_TOKEN && url.startsWith(API)
      ? { authorization: `Bearer ${process.env.GH_TOKEN}` }
      : {};
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    if (tries <= 1) throw error;
    await new Promise((done) => setTimeout(done, 1000));
    return fetched(url, as, tries - 1);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return as === "text" ? response.text() : response.json();
}

async function facts() {
  const line = JSON.parse(
    await readFile(
      new URL("../packages/rnl/src/rnl-version-line.json", import.meta.url),
    ),
  );
  const [latest, catalog, upstream, release, main] = await Promise.all([
    fetched(`https://registry.npmjs.org/${RUNTIME}/latest`),
    fetched(lock.catalogUrl),
    fetched(`${RAW}/main/packages.lock.json`),
    fetched(`${API}/releases/latest`),
    fetched(`${API}/commits/main`),
  ]);
  const [releasedSkill, mainSkill, comparison] = await Promise.all([
    fetched(`${RAW}/${release.tag_name}/skills/rnl/SKILL.md`, "text"),
    fetched(`${RAW}/main/skills/rnl/SKILL.md`, "text"),
    line.runtime.source === "commit"
      ? fetched(`${API}/compare/${line.runtime.commit}...main`)
      : Promise.resolve({ ahead_by: 0 }),
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
    line,
    releasedCore: release.tag_name.replace(/^core-v/u, ""),
    releasedSkillLanguage: skillLanguage(releasedSkill),
    mainSkillLanguage: skillLanguage(mainSkill),
    mainHead: main.sha,
    commitsBehindMain: comparison.ahead_by,
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
  const known = await facts();
  const findings = reconcile(known);
  console.log(
    process.argv.includes("--markdown")
      ? markdown(findings, known, new Date().toISOString().slice(0, 10))
      : findings.length
        ? findings.map((item) => `- ${item}`).join("\n")
        : "RNL upstream and Analog Canvas are in step.",
  );
}
