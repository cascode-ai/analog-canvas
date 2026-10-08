import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
// The editor's own headless workspace, from source: what the bundle holds.
import * as headless from "../../editor/src/headless/index";
import { runHttpCommand } from "./http-cli.js";
import {
  headlessBundleCandidates,
  openLocalMode,
  parseLocalArguments,
  type LocalArguments,
  type LocalMode,
} from "./local-mode.js";
import { executeOperation, operationDefinitions } from "./operations.js";

// The first tool call builds every tool's contract once per worker.
beforeAll(() => void operationDefinitions(), 30_000);

const made: string[] = [];
const opened: LocalMode[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "icm-mcp-local-"));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  for (const mode of opened.splice(0)) await mode.close();
  for (const dir of made.splice(0)) await rm(dir, { recursive: true });
});

async function open(options: LocalArguments) {
  const mode = await openLocalMode(options, { headless });
  opened.push(mode);
  // The calls the stdio server and the command line make, by tool name.
  const tool = (name: string, args: unknown = {}) =>
    executeOperation(name, args, mode.session) as Promise<
      Record<string, unknown>
    >;
  return { mode, tool };
}

const stored = async (dir: string) =>
  parseProject(await readFile(join(dir, "project.icproj.json"), "utf8"));
const references = (project: Awaited<ReturnType<typeof stored>>) =>
  project.documents[0]!.instances.map((instance) => instance.reference);

const pin = (instance: string, name: string) => ({
  kind: "pin",
  instance,
  pin: name,
});
const wire = (from: [string, string], to: [string, string]) => ({
  kind: "connect",
  from: pin(...from),
  to: pin(...to),
});
const DIVIDER = [
  {
    kind: "place-component",
    symbol: "resistor",
    reference: "R1",
    position: { x: 100, y: 100 },
    parameters: { value: "1k" },
  },
  {
    kind: "place-component",
    symbol: "resistor",
    reference: "R2",
    position: { x: 100, y: 200 },
    parameters: { value: "2k" },
  },
  {
    kind: "place-component",
    symbol: "ground",
    id: "gnd",
    position: { x: 100, y: 260 },
  },
  {
    kind: "place-component",
    symbol: "port",
    reference: "IN",
    position: { x: 200, y: 20 },
  },
  {
    kind: "place-component",
    symbol: "port",
    reference: "OUT",
    position: { x: 200, y: 150 },
  },
];
const REFERENCE = [
  ".subckt dut VSS IN OUT",
  "R1 IN OUT 1k",
  "R2 OUT VSS 2k",
  ".ends dut",
].join("\n");

describe("MCP local mode (#1498)", () => {
  it("draws, renders and verifies with no browser, the Project file saved after each call", async () => {
    const root = await temporary();
    const dir = join(root, "divider");
    const referencePath = join(root, "divider.sp");
    await writeFile(referencePath, REFERENCE);
    const { mode, tool } = await open({
      dir,
      process: "abstract",
      create: { name: "Divider", referencePath },
    });
    expect(await readFile(join(dir, "reference.sp"), "utf8")).toBe(REFERENCE);

    // No claim code: the workspace is its owner's own.
    expect(await tool("connect")).toMatchObject({
      ok: true,
      documentIds: ["main"],
      context: { projectName: "Divider", documentId: "main" },
    });
    const placed = await tool("apply_actions", { actions: DIVIDER });
    expect(placed, JSON.stringify(placed)).toMatchObject({
      ok: true,
      applied: true,
    });
    // On disk before the process lets the workspace go.
    expect(references(await stored(dir))).toEqual(
      expect.arrayContaining(["R1", "R2"]),
    );
    const wired = await tool("apply_actions", {
      actions: [
        wire(["IN", "P"], ["R1", "1"]),
        wire(["R1", "2"], ["R2", "1"]),
        wire(["OUT", "P"], ["R1", "2"]),
        wire(["R2", "2"], ["gnd", "0"]),
      ],
    });
    expect(wired, JSON.stringify(wired)).toMatchObject({ ok: true });

    const rendered = await tool("render");
    const artifact = rendered.artifact as { mediaType: string; data: string };
    expect(artifact.mediaType).toBe("image/svg+xml");
    expect(Buffer.from(artifact.data, "base64").toString("utf8")).toContain(
      "<svg",
    );
    expect(await tool("netlist_code", { action: "read" })).toMatchObject({
      ok: true,
      netlist: { status: "ready", text: expect.stringContaining("R2") },
    });
    const reference = await readFile(join(dir, "reference.sp"), "utf8");
    expect(
      await tool("verify", { expectedNetlist: { text: reference } }),
    ).toMatchObject({ comparison: { status: "equal" } });
    expect(
      await tool("verify", {
        expectedNetlist: {
          text: reference.replace("R2 OUT VSS", "R2 IN VSS"),
        },
      }),
    ).toMatchObject({ comparison: { status: "different" } });

    // Simulation needs the website: refused, by name.
    expect(
      await tool("simulation", { request: { operation: "capabilities" } }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_UNAVAILABLE",
        message: expect.stringContaining("needs the website"),
      },
    });
    // So do the Gallery and the figure files the editor measures in a page.
    for (const [name, args] of [
      ["gallery_circuits", { action: "list" }],
      [
        "export_file",
        { artifact: "svg", documentId: "main", outputPath: `${root}/f.svg` },
      ],
    ] as const)
      expect(await tool(name, args)).toMatchObject({
        ok: false,
        error: { code: "WEBSITE_REQUIRED" },
      });

    // The one-shot command line, on the same session.
    const status = (await runHttpCommand(
      { toolSession: mode.session },
      "connection_status",
      "{}",
    )) as { content: { text: string }[] };
    expect(JSON.parse(status.content[0]!.text)).toMatchObject({
      projectId: (await stored(dir)).id,
      documentIds: ["main"],
      runtime: { apiBaseUrl: expect.stringMatching(/^file:\/\//u) },
    });

    // The lock names this process until it lets the workspace go.
    expect(await readFile(mode.lockPath, "utf8")).toBe(String(process.pid));
    await mode.close();
    await expect(access(mode.lockPath)).rejects.toThrow();
    const saved = await stored(dir);
    expect(saved.documents[0]!.routes.length).toBeGreaterThan(0);

    // A later process resumes the file where this one left it.
    const later = await open({ dir });
    expect(await later.tool("get_context")).toMatchObject({
      revision: saved.documents[0]!.revision,
      instanceCount: saved.documents[0]!.instances.length,
    });
  });

  it("places transistors in the editor's default Process unless one is named", async () => {
    const dir = join(await temporary(), "nmos");
    const { tool } = await open({ dir, create: {} });
    const placed = await tool("apply_actions", {
      actions: [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M1",
          position: { x: 200, y: 200 },
        },
      ],
    });
    expect(placed, JSON.stringify(placed)).toMatchObject({ ok: true });
    const project = await stored(dir);
    expect(
      project.externalSubcircuitDefinitions.map((model) => model.name),
    ).toEqual([expect.stringMatching(/sky130.*nfet/u)]);
  });

  it("opens an existing workspace as it is, and names what is missing", async () => {
    const dir = join(await temporary(), "kept");
    await expect(openLocalMode({ dir }, { headless })).rejects.toThrow(
      "add --new to create one",
    );
    const first = await open({ dir, create: { name: "First" } });
    expect(
      await first.tool("apply_actions", { actions: DIVIDER.slice(0, 1) }),
    ).toMatchObject({ ok: true });
    await first.mode.close();
    // --new again (a restarted worker) keeps the drawing.
    const again = await open({ dir, create: { name: "Second" } });
    expect(await again.tool("get_context")).toMatchObject({
      instanceCount: 1,
    });
    expect((await stored(dir)).name).toBe("First");
    await expect(
      openLocalMode({ dir, process: "sky999" }, { headless }),
    ).rejects.toThrow("--process sky999 is not a Process");
  });

  it("reads its options, and finds the bundle where a release or checkout keeps it", () => {
    expect(
      parseLocalArguments([
        "ws",
        "--process",
        "sg13g2",
        "--new",
        "--name",
        "Amp",
        "--reference",
        "amp.sp",
        "--http",
        "apply_actions",
      ]),
    ).toEqual({
      dir: "ws",
      process: "sg13g2",
      create: { name: "Amp", referencePath: "amp.sp" },
      http: "apply_actions",
    });
    expect(parseLocalArguments(["ws", "--http"])).toEqual({
      dir: "ws",
      http: "connection_status",
    });
    expect(() => parseLocalArguments([])).toThrow("Name the workspace");
    expect(() => parseLocalArguments(["ws", "--name", "Amp"])).toThrow(
      "add --new",
    );
    expect(() => parseLocalArguments(["ws", "--process"])).toThrow(
      "--process needs a value",
    );
    expect(() => parseLocalArguments(["ws", "--claim", "x"])).toThrow(
      "Unknown option --claim",
    );

    expect(
      headlessBundleCandidates({}, "/pkg/bin/analog-canvas-mcp.mjs")[0],
    ).toBe(resolve("/pkg/bin", "analog-canvas-headless.mjs"));
    expect(
      headlessBundleCandidates({}, "/repo/apps/mcp-server/dist/main.js")[1],
    ).toBe(resolve("/repo/output/headless", "analog-canvas-headless.mjs"));
    expect(
      headlessBundleCandidates(
        { ANALOG_CANVAS_HEADLESS: "/opt/headless.mjs" },
        "/pkg/bin/analog-canvas-mcp.mjs",
      ),
    ).toEqual([resolve("/opt/headless.mjs")]);
  });
});
