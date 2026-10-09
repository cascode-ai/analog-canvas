// PREVIEW_RENDERER_VERSION names what renderPreview draws, so whoever keeps a
// preview (AnalogArena's Submissions, docs/specs/analog-arena.md) knows when
// to draw it again. This guard fails when a fixture's preview changes while
// the version stays.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { PREVIEW_RENDERER_VERSION, renderPreview } from "./gallery-requests";

/**
 * The SHA-256 of each fixture's preview at one renderer version. Refresh it
 * from the record the guard prints, after bumping the version.
 */
const RECORDED = {
  version: "1",
  previews: {
    "crossing-routes":
      "f8f8a5bb93fd35cbd055ef62628b9b2c499556d5308092f14211107f7ac1186d",
    "differential-stage":
      "5dbdb0bb62a9d608f822bb76fb68c3a2d72fb0d48f5a6df44c825ad2ed43776a",
    "instance-value-display":
      "e8594cb981b7eb137b7164c3a686fee344e8df696568740d30969febbd1b41fb",
    "hierarchical-gain-stage":
      "d4c31acdddc7bb0f4de6a12e89f0ee278a931ce826b932b29be6b3887f4289c9",
    formulas:
      "0a75486d7ecaaedaa7d60573e6caa4f62b15d4d5a70351ee66321b7c91f4331c",
  },
};

function fixture(name: string): CircuitProject {
  return parseProject(
    readFileSync(
      new URL(
        `../fixtures/projects/${name}/project.icproj.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

/** A formula in each typography a preview sets: label type and MathJax. */
function formulas(): CircuitProject {
  const project = fixture("minimal");
  const top = project.documents.find(
    (document) => document.id === project.topDocumentId,
  )!;
  const formula = (id: string, latex: string, y: number) => ({
    id,
    kind: "text" as const,
    locked: false,
    zIndex: 0,
    anchor: { kind: "free" as const, position: { x: 0, y } },
    alignment: "start" as const,
    rotation: 0 as const,
    content: {
      runs: [{ kind: "math" as const, latex, display: "inline" as const }],
    },
  });
  top.drafting = {
    objects: [
      formula("gain", String.raw`A_v=\frac{g_m}{1+s/\omega_p}`, 0),
      formula("brace", String.raw`\overbrace{a+b}`, 80),
    ],
  };
  return project;
}

/** The visual-golden Projects, and formulas, which none of them draws. */
const PREVIEWED: Record<string, () => CircuitProject> = {
  "crossing-routes": () => fixture("crossing-routes"),
  "differential-stage": () => fixture("differential-stage"),
  "instance-value-display": () => fixture("instance-value-display"),
  "hierarchical-gain-stage": () => fixture("hierarchical-gain-stage"),
  formulas,
};

async function previewDigests(): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const [name, projectOf] of Object.entries(PREVIEWED)) {
    const project = projectOf();
    const svg = await renderPreview(
      project,
      createProjectSymbolResolver(project, builtInSymbols),
    );
    digests[name] = createHash("sha256").update(svg).digest("hex");
  }
  return digests;
}

describe("the preview renderer's version", () => {
  it("changes whenever a preview changes", async () => {
    const current = {
      version: PREVIEW_RENDERER_VERSION,
      previews: await previewDigests(),
    };
    const record = JSON.stringify(current, null, 2);

    expect(
      current.version,
      `PREVIEW_RENDERER_VERSION is now ${current.version}. Set RECORDED in worker/gallery-requests.test.ts to:\n${record}`,
    ).toBe(RECORDED.version);
    expect(
      current.previews,
      `A preview changed while PREVIEW_RENDERER_VERSION stayed ${current.version}. Bump it in worker/gallery-requests.ts, then set RECORDED here to the record this test prints.`,
    ).toEqual(RECORDED.previews);
  });
});
