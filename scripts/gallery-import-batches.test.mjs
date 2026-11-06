import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  entryId,
  importBatches,
  keptDrawing,
  main,
  ownerToken,
  parseArguments,
} from "./gallery-import-batches.mjs";

const root = resolve(import.meta.dirname, "..");
const made = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function task(run, id, verdict, project = { name: `Circuit ${id}` }) {
  const dir = join(run, id);
  mkdirSync(join(dir, "second"), { recursive: true });
  writeFileSync(join(dir, "verdict.json"), JSON.stringify({ id, ...verdict }));
  writeFileSync(
    join(dir, "project.icproj.json"),
    JSON.stringify({ ...project, side: "first" }),
  );
  writeFileSync(
    join(dir, "second", "project.icproj.json"),
    JSON.stringify({ ...project, side: "second" }),
  );
}

describe("dataset import batches from a draw:batch run (#1498)", () => {
  it("keeps accepted drawings only, the suspect ones when asked", () => {
    expect(keptDrawing({ accepted: "first", path: "first" }, false)).toEqual({
      project: "project.icproj.json",
    });
    expect(keptDrawing({ accepted: "second", path: "second" }, false)).toEqual({
      project: "second/project.icproj.json",
    });
    expect(
      keptDrawing(
        { accepted: null, path: "review", reason: "two drawings differ" },
        false,
      ),
    ).toEqual({
      skip: "two drawings differ",
    });
    expect(
      keptDrawing(
        { accepted: "first", datasetSuspect: true, path: "agreed" },
        false,
      ).skip,
    ).toMatch(/include-suspect/u);
    expect(
      keptDrawing(
        { accepted: "first", datasetSuspect: true, path: "agreed" },
        true,
      ).project,
    ).toBe("project.icproj.json");
  });

  it("gives each entry the source's prefix and a safe id", () => {
    expect(entryId("ar", "chai/0012")).toBe("ar-chai-0012");
    expect(entryId("ag", "308")).toBe("ag-308");
    expect(() => entryId("ag", "///")).toThrow(/nothing usable/u);
    expect(() => parseArguments(["run"])).toThrow(/usage/u);
  });

  it("writes ten entries a file in the import body, and lists what it left out", () => {
    const run = mkdtempSync(join(tmpdir(), "icm-import-"));
    made.push(run);
    for (let index = 1; index <= 12; index += 1)
      task(run, String(index), {
        accepted: index === 12 ? "second" : "first",
        path: "first",
      });
    task(run, "13", {
      accepted: null,
      path: "review",
      reason: "two drawings differ",
    });
    writeFileSync(
      join(run, "tasks.jsonl"),
      `${JSON.stringify({ id: "1", name: "Folded cascode" })}\n`,
    );
    const result = importBatches(
      {
        run,
        source: "analogretriever",
        manifest: join(run, "tasks.jsonl"),
        includeSuspect: false,
      },
      root,
    );
    expect(result.entries).toBe(12);
    expect(result.files.map((file) => basename(file))).toEqual([
      "analogretriever-0001.json",
      "analogretriever-0002.json",
    ]);
    const first = JSON.parse(readFileSync(result.files[0], "utf8")).entries;
    expect(first).toHaveLength(10);
    expect(first[0]).toMatchObject({ id: "ar-1", name: "Folded cascode" });
    // Task directories in name order: 1, 10, 11, 12, 2, … 9.
    const second = JSON.parse(readFileSync(result.files[1], "utf8")).entries;
    expect(second.map((entry) => entry.id)).toEqual(["ar-8", "ar-9"]);
    const twelve = first.find((entry) => entry.id === "ar-12");
    expect(JSON.parse(twelve.projectText).side).toBe("second");
    expect(result.left).toEqual([{ id: "13", reason: "two drawings differ" }]);
  });
});

describe("posting import batches with the Owner token (#1769)", () => {
  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), "icm-import-post-"));
    made.push(dir);
    return dir;
  }

  it("reads the token from the environment, else the per-machine file", () => {
    const home = scratch();
    expect(() => ownerToken({}, home)).toThrow(/ANALOG_CANVAS_OWNER_TOKEN/u);
    mkdirSync(join(home, ".config/analog-canvas"), { recursive: true });
    writeFileSync(join(home, ".config/analog-canvas/owner-token"), "acot_f\n");
    expect(ownerToken({}, home)).toBe("acot_f");
    expect(ownerToken({ ANALOG_CANVAS_OWNER_TOKEN: "acot_e" }, home)).toBe(
      "acot_e",
    );
    expect(parseArguments(["--post-dir", "out", "--source", "ag"])).toEqual(
      expect.objectContaining({ postDir: "out", post: true }),
    );
    expect(() =>
      parseArguments(["run", "--post-dir", "out", "--source", "ag"]),
    ).toThrow(/usage/u);
  });

  it("posts three entries a request, retries dropped ones, and reports failures", async () => {
    const run = scratch();
    for (let index = 1; index <= 7; index += 1)
      task(run, String(index), { accepted: "first", path: "first" });
    const requests = [];
    const answers = [
      () => {
        throw new Error("socket hang up");
      },
      () => Response.json({ error: "x" }, { status: 503 }),
      null,
      null,
      () => Response.json({ error: "invalid-fields" }, { status: 400 }),
    ];
    const fetchImpl = async (url, init) => {
      const { entries } = JSON.parse(init.body);
      requests.push({ url, init, ids: entries.map((entry) => entry.id) });
      const answer = answers[requests.length - 1];
      if (answer) return answer();
      return Response.json({
        source: "analoggenie",
        results: entries.map((entry) =>
          entry.id === "ag-4"
            ? { id: entry.id, ok: false, error: "invalid-project" }
            : { id: entry.id, ok: true, created: true },
        ),
      });
    };
    const lines = [];
    const waits = [];
    const code = await main(
      ["--source", "analoggenie", run, "--post", "--origin", "https://x.test/"],
      {
        root,
        env: { ANALOG_CANVAS_OWNER_TOKEN: "acot_t" },
        home: scratch(),
        fetchImpl,
        sleep: async (ms) => waits.push(ms),
        log: (line) => lines.push(line),
      },
    );
    expect(code).toBe(1);
    // 1, 2, 3 after two retries; 4, 5, 6; then 7, refused outright.
    expect(requests.map((request) => request.ids)).toEqual([
      ["ag-1", "ag-2", "ag-3"],
      ["ag-1", "ag-2", "ag-3"],
      ["ag-1", "ag-2", "ag-3"],
      ["ag-4", "ag-5", "ag-6"],
      ["ag-7"],
    ]);
    expect(waits).toEqual([1000, 2000]);
    expect(requests[0].url).toBe(
      "https://x.test/api/gallery/sources/analoggenie/entries",
    );
    expect(requests[0].init.headers).toEqual({
      authorization: "Bearer acot_t",
      "content-type": "application/json",
    });
    expect(lines.slice(-6)).toEqual([
      "posted 3/7",
      "posted 6/7",
      "posted 7/7",
      "5 posted, 2 failed.",
      "failed ag-4: invalid-project",
      "failed ag-7: http-400",
    ]);

    // Batches already built post from their directory, to Production by
    // default; an entry the answer leaves out counts as failed.
    const urls = [];
    expect(
      await main(
        ["--post-dir", join(run, "gallery-import"), "--source", "analoggenie"],
        {
          root,
          env: { ANALOG_CANVAS_OWNER_TOKEN: "acot_t" },
          fetchImpl: async (url, init) => {
            urls.push(url);
            const { entries } = JSON.parse(init.body);
            return Response.json({
              results: entries
                .filter((entry) => entry.id !== "ag-5")
                .map((entry) => ({ id: entry.id, ok: true })),
            });
          },
          log: (line) => lines.push(line),
        },
      ),
    ).toBe(1);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      "https://analog-canvas.tokenzhang.com/api/gallery/sources/analoggenie/entries",
    );
    expect(lines.slice(-2)).toEqual([
      "6 posted, 1 failed.",
      "failed ag-5: no-result",
    ]);
  });

  it("sends the token over https, or plain http to this machine only", () => {
    const origin = (value) =>
      parseArguments(["--post-dir", "out", "--source", "ag", "--origin", value])
        .origin;
    expect(origin("https://staging.example.com/path")).toBe(
      "https://staging.example.com",
    );
    expect(origin("http://localhost:8787")).toBe("http://localhost:8787");
    expect(origin("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173");
    expect(origin("http://[::1]:8787")).toBe("http://[::1]:8787");
    for (const refused of [
      "http://analog-canvas.tokenzhang.com",
      "http://localhost.example.com",
      "http://192.168.1.2:8787",
      "htps://analog-canvas.tokenzhang.com",
      "ftp://localhost",
      "analog-canvas.tokenzhang.com",
    ])
      expect(() => origin(refused)).toThrow(/--origin/u);
  });

  it("stops at the first refused token instead of sending the rest", async () => {
    const run = scratch();
    for (let index = 1; index <= 7; index += 1)
      task(run, String(index), { accepted: "first", path: "first" });
    let requests = 0;
    const lines = [];
    const code = await main(["--source", "analoggenie", run, "--post"], {
      root,
      env: { ANALOG_CANVAS_OWNER_TOKEN: "acot_revoked" },
      fetchImpl: async () => {
        requests += 1;
        return Response.json({ error: "unauthorized" }, { status: 401 });
      },
      sleep: async () => {},
      log: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(requests).toBe(1);
    expect(lines.slice(-5)).toEqual([
      "0 posted, 3 failed.",
      "failed ag-1: http-401",
      "failed ag-2: http-401",
      "failed ag-3: http-401",
      "Stopped at http-401: the Owner token is missing, wrong or revoked, or its account is not the Owner's; 4 entries not sent.",
    ]);
  });
});
