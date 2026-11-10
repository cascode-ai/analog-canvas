import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseArgs,
  UsageError,
  wallLinkParams,
  wholeEntry,
} from "./gallery-download.mjs";

const script = fileURLToPath(
  new URL("./gallery-download.mjs", import.meta.url),
);

describe("a Gallery wall link", () => {
  it("names the list API's filters, netlist as netlistable", () => {
    expect(
      wallLinkParams(
        "https://analog-canvas.tokenzhang.com/?source=amsnet&q=common+gate&netlist=1&parts=0-5,6-10&tags=bias,ota&author=Lu+Jie&ai=dataset&reference=0&view=gallery&entry=x&utm=y",
      ).toString(),
    ).toBe(
      "source=amsnet&q=common+gate&tags=bias%2Cota&author=Lu+Jie&parts=0-5%2C6-10&netlistable=1&reference=0&ai=dataset",
    );
    // An account narrows by its id; the byline only labels it.
    expect(
      wallLinkParams("https://x.test/?owner=u1&author=Old").toString(),
    ).toBe("owner=u1");
  });

  it("is refused when it needs a signed-in reader", () => {
    for (const link of [
      "https://x.test/?liked=1",
      "https://x.test/?attention=1&reason=unrouted",
      "https://x.test/?view=shelf",
      "not a link",
    ])
      expect(() => wallLinkParams(link)).toThrow(UsageError);
  });
});

describe("the arguments", () => {
  it("default to everything from the site into gallery-download", () => {
    const { out, params, max, base } = parseArgs([]);
    expect([out, params.toString(), max, base]).toEqual([
      "gallery-download",
      "",
      Infinity,
      "https://analog-canvas.tokenzhang.com",
    ]);
  });

  it("let flags override a link, whose site is the default base", () => {
    const { out, params, base } = parseArgs([
      "out",
      "--url",
      "http://127.0.0.1:9/?source=circuitthink&parts=6-10&netlist=0",
      "--netlistable",
      "1",
      "--tags",
      "bias",
    ]);
    expect([out, params.toString(), base]).toEqual([
      "out",
      "source=circuitthink&parts=6-10&netlistable=1&tags=bias",
      "http://127.0.0.1:9",
    ]);
  });

  it("refuse what they cannot mean", () => {
    for (const argv of [
      ["--netlistable", "yes"],
      ["--parts", "small"],
      ["--max", "0"],
      ["--source"],
      ["--tag", "bias"],
      ["a", "b"],
    ])
      expect(() => parseArgs(argv)).toThrow(UsageError);
  });
});

it("keeps a saved circuit only if its file is whole", () => {
  const whole = JSON.stringify({ entry: { id: "a" }, projectText: "{}" });
  expect(wholeEntry(whole, "a")).toBe(true);
  expect(wholeEntry(whole.slice(0, 20), "a")).toBe(false);
  expect(wholeEntry(whole, "b")).toBe(false);
  expect(
    wholeEntry(JSON.stringify({ entry: { id: "a" }, projectText: "" }), "a"),
  ).toBe(false);
});

/** A list entry as GET /api/gallery sends it (worker/gallery-store.ts). */
function summary(id, minute) {
  return {
    curationRevision: 0,
    id,
    name: `Circuit ${id}`,
    author: "Ada",
    ownerUserId: null,
    description: "",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString(),
    previewRevision: `rev-${id}`,
    schemaVersion: 78,
    tags: [],
    netlistable: true,
    componentCount: 3,
    likes: 0,
    likedByViewer: false,
  };
}

const projectOf = (id) => JSON.stringify({ format: "icproj", id });

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * The Gallery's public reads in the Worker's shapes: the keyset list, one
 * circuit, and the datasets. `refuse` may answer a request first.
 */
async function gallery(entries, refuse = () => null) {
  const asked = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://local");
    asked.push(url.pathname + url.search);
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const refused = refuse(url);
    if (refused) return send(refused.status, refused.body);
    if (url.pathname === "/api/gallery/sources")
      return send(200, {
        sources: [
          { key: "circuitthink", prefix: "ct", name: "CircuitThink", count: 1 },
        ],
      });
    if (url.pathname === "/api/gallery") {
      const limit = Number(url.searchParams.get("limit") ?? 60);
      const cursor = url.searchParams.get("cursor");
      const start = cursor
        ? entries.findIndex((entry) => entry.id === cursor.split("|")[1]) + 1
        : 0;
      const page = entries.slice(start, start + limit);
      const last = page.at(-1);
      return send(200, {
        entries: page,
        nextCursor:
          start + limit < entries.length && last
            ? `o${last.createdAt}|${last.id}`
            : null,
        ...(cursor ? {} : { total: entries.length, authors: [] }),
      });
    }
    const id = url.pathname.split("/")[3];
    const entry = entries.find((each) => each.id === id);
    if (!entry) return send(404, { error: "not-found" });
    return send(200, {
      entry,
      status: "public",
      ownerUserId: null,
      projectText: projectOf(id),
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, asked };
}

function outDir() {
  const dir = mkdtempSync(join(tmpdir(), "gallery-download-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args) {
  return new Promise((done) =>
    execFile(process.execPath, [script, ...args], (error, stdout, stderr) =>
      done({ code: error?.code ?? 0, stdout, stderr }),
    ),
  );
}

it("rereads a truncated or foreign file, keeps a whole one and says so", async () => {
  const { base, asked } = await gallery([
    summary("a", 1),
    summary("b", 2),
    summary("c", 3),
  ]);
  const out = outDir();
  mkdirSync(join(out, "entries"));
  const whole = JSON.stringify({ entry: { id: "a" }, projectText: "{}" });
  writeFileSync(join(out, "entries", "a.json"), whole);
  const kept = statSync(join(out, "entries", "a.json")).mtimeMs;
  writeFileSync(join(out, "entries", "b.json"), '{"entry":{"id":"b"},"proj');

  const { code, stdout } = await run([out, "--base", base]);
  expect(code).toBe(0);
  expect(stdout).toContain(
    `3 circuits in ${out}: 2 downloaded, 1 already on disk, 0 failed`,
  );
  expect(asked).not.toContain("/api/gallery/a");
  expect(statSync(join(out, "entries", "a.json")).mtimeMs).toBe(kept);
  for (const id of ["b", "c"])
    expect(
      JSON.parse(readFileSync(join(out, "entries", `${id}.json`), "utf8")),
    ).toEqual({
      entry: summary(id, id === "b" ? 2 : 3),
      projectText: projectOf(id),
    });
  expect(readdirSync(join(out, "entries")).sort()).toEqual([
    "a.json",
    "b.json",
    "c.json",
  ]);
  expect(
    JSON.parse(readFileSync(join(out, "index.json"), "utf8")).map(
      ({ id }) => id,
    ),
  ).toEqual(["a", "b", "c"]);
});

it("fails when a circuit cannot be read, naming it, after saving the rest", async () => {
  const { base } = await gallery(
    [summary("a", 1), summary("gone", 2)],
    (url) =>
      url.pathname === "/api/gallery/gone"
        ? { status: 404, body: { error: "not-found" } }
        : null,
  );
  const out = outDir();
  const { code, stdout, stderr } = await run([out, "--base", base]);
  expect(code).toBe(1);
  expect(stdout).toContain("1 downloaded, 0 already on disk, 1 failed");
  expect(stderr).toContain(
    'failed gone: /api/gallery/gone?download=1: 404 {"error":"not-found"}',
  );
  expect(readdirSync(join(out, "entries"))).toEqual(["a.json"]);
});

it("lists only what a wall link selects, from the link's site", async () => {
  const { base, asked } = await gallery([summary("ct-001", 1)]);
  const out = outDir();
  const { code } = await run([
    out,
    "--url",
    `${base}/?source=circuitthink&netlist=1&parts=6-10&q=lna`,
  ]);
  expect(code).toBe(0);
  expect(asked.filter((path) => path.startsWith("/api/gallery?"))).toEqual([
    "/api/gallery?source=circuitthink&q=lna&parts=6-10&netlistable=1&limit=60&order=oldest",
  ]);
});

it("refuses a dataset the site does not have, by its list or by its answer", async () => {
  const listed = await gallery([summary("a", 1)]);
  const unknown = await run([
    outDir(),
    "--base",
    listed.base,
    "--source",
    "ams-net",
  ]);
  expect(unknown.code).toBe(1);
  expect(unknown.stderr).toContain(
    "Unknown --source ams-net. Datasets: circuitthink, or community.",
  );
  expect(listed.asked).toEqual(["/api/gallery/sources"]);

  const refused = await gallery([summary("a", 1)], (url) =>
    url.pathname === "/api/gallery/sources"
      ? { status: 404, body: { error: "not-found" } }
      : url.pathname === "/api/gallery"
        ? { status: 400, body: { error: "unknown-source" } }
        : null,
  );
  const answer = await run([outDir(), "--base", refused.base, "--source", "x"]);
  expect(answer.code).toBe(1);
  expect(answer.stderr).toContain(
    'The list failed: /api/gallery?source=x&limit=60&order=oldest: 400 {"error":"unknown-source"}',
  );
});
