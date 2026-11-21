import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { markdown, reconcile, skillLanguage } from "./rnl-reconcile.mjs";
import lock from "../packages/rnl/src/rnl-canvas-package.lock.json" with { type: "json" };
import line from "../packages/rnl/src/rnl-version-line.json" with { type: "json" };

const released = {
  package: "@rich-netlist/runtime",
  source: "npm",
  version: "0.6.0",
  built: "npm",
};
const inStep = {
  line: {
    language: "0.4",
    standardSeries: "0.4",
    toolsRelease: "0.6.0",
    specRelease: "spec-0.4-r1",
    runtime: released,
  },
  releasedCore: "0.6.0",
  releasedSkillLanguage: "0.4",
  releasedSpecLanguage: "0.4",
  mainSkillLanguage: "0.4",
  mainHead: "5347dcb2f0b1a8f7c3e9d4a6b2c1e0f9a8b7c6d5",
  commitsBehindMain: 0,
  runtimeLatest: "0.6.0",
  canvasLocked: ["0.1", "0.10", "0.9"],
  canvasCatalog: ["0.9", "0.10"],
  upstreamLocked: ["0.10"],
  privateReferences: 0,
};

it("finds nothing when Analog Canvas and upstream are in step", () => {
  // 0.10 is newer than 0.9: versions compare by number, not by text.
  expect(reconcile(inStep)).toEqual([]);
});

it.each([
  [null, "The release spec-0.4-r1 has no readable normative RNL text."],
  ["0.3", "The published spec spec-0.4-r1 describes RNL 0.3."],
])(
  "reports a missing or mismatched spec (%s) before runtime drift",
  (language, detail) => {
    expect(
      reconcile({
        ...inStep,
        releasedSpecLanguage: language,
        runtimeLatest: "0.6.1",
      }),
    ).toEqual([
      `version line: Analog Canvas reads and writes RNL 0.4. ${detail}`,
      "runtime: locked 0.6.0, npm has 0.6.1",
    ]);
  },
);

it("names first a language that no released tool or guide reads, then a runtime built from main", () => {
  expect(
    reconcile({
      ...inStep,
      line: {
        ...inStep.line,
        runtime: {
          ...released,
          source: "commit",
          commit: "7d9659817323a415b99c7db615ef1dc53ac91507",
          version: "0.6.0-dev.7d965981",
        },
      },
      releasedCore: "0.5.5",
      releasedSkillLanguage: "0.3",
      mainSkillLanguage: "0.3",
      commitsBehindMain: 12,
      runtimeLatest: "0.5.5",
    }),
  ).toEqual([
    "version line: Analog Canvas reads and writes RNL 0.4. The latest core is 0.5.5. Core 0.6.0 is the first to read it. The released RNL Skill teaches 0.3.",
    "the RNL Skill on rnl main teaches 0.3, not 0.4",
    "runtime: built from rnl main 7d965981, unreleased; npm has 0.5.5",
    "runtime: 12 commits behind rnl main (5347dcb2)",
  ]);
});

it("says when a release can replace the vendored build", () => {
  expect(
    reconcile({
      ...inStep,
      line: {
        ...inStep.line,
        runtime: {
          ...released,
          source: "commit",
          commit: "7d9659817323a415b99c7db615ef1dc53ac91507",
        },
      },
    }),
  ).toContain(
    "runtime: npm 0.6.0 reads RNL 0.4; replace the vendored build with it",
  );
});

it("names each package and reference out of step", () => {
  expect(
    reconcile({
      ...inStep,
      runtimeLatest: "0.6.1",
      canvasCatalog: ["0.10", "0.11"],
      upstreamLocked: ["0.1"],
      privateReferences: 3,
    }),
  ).toEqual([
    "runtime: locked 0.6.0, npm has 0.6.1",
    "analog-canvas-extensions: the editor writes 0.10, the catalog's newest is 0.11",
    "analog-canvas-extensions 0.10 is not in rnl's packages.lock.json (upstream CI does not read what Analog Canvas writes)",
    "3 references to the private rnl-dev remain",
  ]);
});

it("reads the language an RNL Skill teaches from its title", () => {
  expect(
    skillLanguage("---\nname: rnl\n---\n\n# RNL (Rich Netlist) 0.3\n"),
  ).toBe("0.3");
  expect(skillLanguage("# Something else")).toBeNull();
});

it("writes the report for the issue, with the combination it checked", () => {
  const text = markdown(["runtime: x"], inStep, "2026-11-17");
  expect(text).toContain("### RNL upstream reconcile, 2026-11-17");
  expect(text).toContain("- runtime: x");
  expect(text).toContain("Analog Canvas: RNL 0.4, standard series 0.4");
  expect(text).toContain("core 0.6.0 released, main 5347dcb2");
  expect(text).toContain("spec spec-0.4-r1 (0.4)");
});

it.each([true, false])(
  "checks the published normative text through the CLI (release available: %s)",
  { timeout: 20_000 },
  (available) => {
    const repo = "rich-netlist/rnl";
    const api = `https://api.github.com/repos/${repo}`;
    const raw = `https://raw.githubusercontent.com/${repo}`;
    const core = `core-v${line.toolsRelease}`;
    const name = `rnl-${line.language}.md`;
    const asset = `https://github.com/${repo}/releases/download/${line.specRelease}/${name}`;
    const skill = `# RNL (Rich Netlist) ${line.language}`;
    const packages = [
      { name: lock.name, version: lock.versions.at(-1).version },
    ];
    const replies = {
      "https://registry.npmjs.org/@rich-netlist/runtime/latest": {
        version: line.runtime.version,
      },
      [lock.catalogUrl]: { packages },
      [`${raw}/main/packages.lock.json`]: { packages },
      [`${api}/releases/latest`]: { tag_name: core },
      [`${api}/commits/main`]: { sha: inStep.mainHead },
      [`${api}/compare/${line.runtime.commit}...main`]: { ahead_by: 0 },
      [`${raw}/main/skills/rnl/SKILL.md`]: skill,
      [`${raw}/${core}/skills/rnl/SKILL.md`]: skill,
      [`${api}/releases/tags/${line.specRelease}`]: available
        ? {
            assets: [{ name, browser_download_url: asset }],
            draft: false,
            prerelease: false,
          }
        : null,
      [asset]: `# RNL language standard, version ${line.language}\n`,
    };
    const fixtures = `
      const replies = ${JSON.stringify(replies)};
      globalThis.fetch = async (url) => {
        if (!Object.hasOwn(replies, url)) throw new Error("Unexpected request: " + url);
        const body = replies[url];
        if (body === null) return new Response(null, { status: 404 });
        return typeof body === "string" ? new Response(body) : Response.json(body);
      };
    `;
    const script = fileURLToPath(
      new URL("./rnl-reconcile.mjs", import.meta.url),
    );
    const preload = `data:text/javascript;base64,${Buffer.from(fixtures).toString("base64")}`;
    const report = execFileSync(
      process.execPath,
      ["--import", preload, script, "--markdown"],
      {
        encoding: "utf8",
      },
    );

    expect(report).toContain(
      `spec ${line.specRelease} (${available ? line.language : "unavailable"})`,
    );
    if (available) expect(report).not.toContain("- version line:");
    else
      expect(report.split("\n")[2]).toContain(
        `The release ${line.specRelease} has no readable normative RNL text.`,
      );
  },
);
