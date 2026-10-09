// The render-and-grade service (docs/specs/analog-arena.md), called the way
// AnalogArena calls it: over a service binding to the Analog Canvas Worker's
// named entrypoint, in the Workers runtime, with the real renderer and the
// real #1524 grading.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializeProject } from "@icm/project-protocol";
import { importSpiceSources } from "../packages/spice/src/importer.js";
import { environment, ORIGIN, route, submitOne } from "./gallery.test-support";
import type { RenderAndGradeAnswer } from "./render-and-grade";

const root = fileURLToPath(new URL("../", import.meta.url));
const editorRequire = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
);
const wranglerRequire = createRequire(
  editorRequire.resolve("wrangler/package.json"),
);
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");

/** A five-transistor OTA, as a Task states it. */
const OTA = `* Five-transistor OTA
M1 x inn tail 0 nch w=1u l=1u
M2 out inp tail 0 nch w=1u l=1u
M3 x x vdd vdd pch w=2u l=1u
M4 out x vdd vdd pch w=2u l=1u
M5 tail vb 0 0 nch w=1u l=1u
.model nch nmos
.model pch pmos
.end
`;

/**
 * A Submission drawn from `spice` as the editor's SPICE import draws one,
 * every device placed on a grid.
 */
async function drawingOf(spice: string): Promise<string> {
  const imported = await importSpiceSources(
    [{ path: "task.sp", bytes: new TextEncoder().encode(spice) }],
    "task.sp",
  );
  if (!imported.project) throw new Error("The fixture netlist did not import");
  return serializeProject(imported.project);
}

/** The deployed Worker's settings that the runtime reads. */
function compatibilityDate(): string {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), {
    encoding: "utf8",
  });
  return /"compatibility_date":\s*"([^"]+)"/u.exec(source)![1]!;
}

/** Arena's side of the binding: it forwards each request to the service. */
const ARENA = `export default {
  async fetch(request, env) {
    return Response.json(await env.CANVAS.renderAndGrade(await request.json()));
  },
};`;

let runtime: {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};

beforeAll(async () => {
  const worker = await build({
    absWorkingDir: root,
    entryPoints: ["worker/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "development"],
    external: ["cloudflare:*"],
    write: false,
    logLevel: "error",
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "arena",
          modules: true,
          compatibilityDate: compatibilityDate(),
          routes: ["arena.test/*"],
          serviceBindings: {
            CANVAS: { name: "canvas", entrypoint: "RenderAndGradeService" },
          },
          script: ARENA,
        },
        {
          name: "canvas",
          modules: true,
          compatibilityDate: compatibilityDate(),
          routes: ["canvas.test/*"],
          // The static assets the public `fetch` falls back to.
          serviceBindings: {
            ASSETS: () => new Response("No such asset", { status: 404 }),
          },
          script: worker.outputFiles[0].text,
        },
      ],
    }),
  );
}, 60_000);

afterAll(async () => {
  await runtime?.dispose();
});

async function renderAndGrade(request: unknown): Promise<RenderAndGradeAnswer> {
  const response = await runtime.dispatchFetch("https://arena.test/", {
    method: "POST",
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as RenderAndGradeAnswer;
}

describe("the render-and-grade service", () => {
  it("renders a Submission, exports its netlist and finds it equivalent to its Task", async () => {
    const answer = await renderAndGrade({
      projectText: await drawingOf(OTA),
      taskNetlist: OTA,
    });

    expect(answer).toMatchObject({
      status: "graded",
      verdict: { equivalent: true },
    });
    if (answer.status !== "graded") return;
    expect(answer.svg).toMatch(/^<svg[\s>]/u);
    expect(answer.netlist).toContain("M4 out x vdd vdd pch");
    expect(answer.rendererVersion).toMatch(/\S/u);
  });

  it("draws a Submission exactly as the Gallery previews the same Project", async () => {
    // A Cell placed as an instance draws only with the Project's own symbols.
    const projectText = readFileSync(
      new URL(
        "../fixtures/projects/hierarchical-gain-stage/project.icproj.json",
        import.meta.url,
      ),
      "utf8",
    );
    const gallery = environment();
    const id = await submitOne(gallery, "Gain stage pair", {
      text: projectText,
    });
    const preview = await route(
      gallery,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );

    const answer = await renderAndGrade({ projectText, taskNetlist: OTA });

    expect(preview.status).toBe(200);
    expect(answer).toMatchObject({
      status: "graded",
      svg: await preview.text(),
    });
  });

  it("finds a Submission equivalent whatever its nets and devices are called", async () => {
    // The supply and ground keep their class under other names (#1524).
    const renamed = `* The same OTA under other names
MA n1 vinm ntail gnd nch w=1u l=1u
MB vout vinp ntail gnd nch w=1u l=1u
MC n1 n1 avdd avdd pch w=2u l=1u
MD vout n1 avdd avdd pch w=2u l=1u
ME ntail vbias gnd gnd nch w=1u l=1u
.model nch nmos
.model pch pmos
.end
`;

    const answer = await renderAndGrade({
      projectText: await drawingOf(OTA),
      taskNetlist: renamed,
    });

    expect(answer).toMatchObject({
      status: "graded",
      verdict: { equivalent: true },
    });
  });

  it("finds a Submission with one wrong connection not equivalent, and says why", async () => {
    // M4's gate drawn on the output instead of the mirror node.
    const miswired = OTA.replace(
      "M4 out x vdd vdd pch",
      "M4 out out vdd vdd pch",
    );

    const answer = await renderAndGrade({
      projectText: await drawingOf(miswired),
      taskNetlist: OTA,
    });

    expect(answer).toMatchObject({
      status: "graded",
      verdict: {
        equivalent: false,
        reason: expect.stringMatching(/connection/iu),
      },
    });
    if (answer.status !== "graded") return;
    expect(answer.netlist).toContain("M4 out out vdd vdd pch");
  });

  it("names the devices a Submission draws too few or too many of", async () => {
    // The tail transistor is left out.
    const tailless = OTA.replace("M5 tail vb 0 0 nch w=1u l=1u\n", "");

    const answer = await renderAndGrade({
      projectText: await drawingOf(tailless),
      taskNetlist: OTA,
    });

    expect(answer).toMatchObject({
      status: "graded",
      verdict: {
        equivalent: false,
        reason: expect.stringMatching(/2 nmos drawn, 3 in the Task/u),
      },
    });
  });

  it("draws a Submission whose netlist does not export, and says why it is not equivalent", async () => {
    // A transistor drawn without its width and length.
    const unsized = OTA.replace(
      "M5 tail vb 0 0 nch w=1u l=1u",
      "M5 tail vb 0 0 nch",
    );

    const answer = await renderAndGrade({
      projectText: await drawingOf(unsized),
      taskNetlist: OTA,
    });

    expect(answer).toMatchObject({
      status: "graded",
      netlist: null,
      verdict: {
        equivalent: false,
        reason: expect.stringMatching(/M5 requires parameter w/u),
      },
    });
    if (answer.status !== "graded") return;
    expect(answer.svg).toMatch(/^<svg[\s>]/u);
  });

  it.each([
    ["text that is not JSON", async () => "Two-stage Miller OTA"],
    [
      "JSON that is not a Project",
      async () => JSON.stringify({ schemaVersion: 68, documents: [] }),
    ],
    [
      "a Project object instead of its text",
      async () => JSON.parse(await drawingOf(OTA)) as unknown,
    ],
  ])("answers %s with an error, not a verdict", async (_input, projectText) => {
    const answer = await renderAndGrade({
      projectText: await projectText(),
      taskNetlist: OTA,
    });

    expect(answer).toEqual({
      status: "error",
      error: "project-unreadable",
      message: expect.stringMatching(/\S/u),
      rendererVersion: expect.stringMatching(/\S/u),
    });
  });

  it.each([
    ["a netlist with no devices", "* Nothing here\n.end\n"],
    ["a statement it cannot read", "* Broken\nM1 a b\n.end\n"],
    ["no netlist", undefined],
  ])(
    "answers a Task given as %s with an error, not a verdict against the Submission",
    async (_input, taskNetlist) => {
      const answer = await renderAndGrade({
        projectText: await drawingOf(OTA),
        taskNetlist,
      });

      expect(answer).toEqual({
        status: "error",
        error: "task-netlist-unreadable",
        message: expect.stringMatching(/\S/u),
        rendererVersion: expect.stringMatching(/\S/u),
      });
    },
  );

  it("carries one renderer version on every answer, graded or not", async () => {
    const graded = await renderAndGrade({
      projectText: await drawingOf(OTA),
      taskNetlist: OTA,
    });
    const refused = await renderAndGrade({
      projectText: "Two-stage Miller OTA",
      taskNetlist: OTA,
    });

    expect(graded.rendererVersion).toMatch(/\S/u);
    expect(refused.rendererVersion).toBe(graded.rendererVersion);
  });
});

describe("the render-and-grade service's reach", () => {
  it.each([
    "/",
    "/render-and-grade",
    "/RenderAndGradeService/renderAndGrade",
    "/api/render-and-grade",
    "/api/arena/render-and-grade",
    "/api/RenderAndGradeService/renderAndGrade",
  ])("is not answered by the public Worker at %s", async (path) => {
    const response = await runtime.dispatchFetch(`https://canvas.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectText: await drawingOf(OTA),
        taskNetlist: OTA,
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toMatch(/rendererVersion|verdict/u);
  });
});
