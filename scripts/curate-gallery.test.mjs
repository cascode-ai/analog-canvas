import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { it, expect } from "vitest";

const execFileAsync = promisify(execFile);

it("validates a complete visual audit without an origin, credential or writes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gallery-curation-"));
  try {
    const report = path.join(dir, "report.json");
    const row = {
      id: "circuit-1",
      previewRevision: "existing-revision",
      imageReviewed: true,
      tags: ["amplifier"],
      issues: [],
    };
    writeFileSync(report, JSON.stringify({ total: 1, entries: [row] }));
    const output = execFileSync(
      process.execPath,
      ["scripts/curate-gallery.mjs", "--report", report],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({
      reviewed: 1,
      needsAttention: 0,
      mode: "validate-only",
    });
    for (const invalid of [
      { total: 1, entries: [{ ...row, imageReviewed: false }] },
      { total: 2, entries: [row] },
      {
        total: 1,
        entries: [
          {
            id: "circuit-1",
            previewRevision: "existing-revision",
            imageReviewed: true,
            addTags: ["ota", "ota"],
            preserveAttention: true,
          },
        ],
      },
      {
        total: 1,
        entries: [
          {
            id: "circuit-1",
            previewRevision: "existing-revision",
            imageReviewed: true,
            addTags: ["ota"],
            preserveAttention: true,
            issues: [{ kind: "overlap", detail: "not allowed" }],
          },
        ],
      },
    ]) {
      writeFileSync(report, JSON.stringify(invalid));
      expect(() =>
        execFileSync(
          process.execPath,
          ["scripts/curate-gallery.mjs", "--report", report],
          { stdio: "pipe" },
        ),
      ).toThrow();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("applies additive addTags with --token, preserves tag order and server-side attention, skips already-tagged, and guards overflow/conflicts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gallery-curation-apply-"));
  const patched = [];
  const entries = {
    "ag-10": {
      id: "ag-10",
      tags: ["custom legacy", "small signal model"],
      previewRevision: "rev-1",
      curationRevision: 2,
    },
    "ag-11": {
      id: "ag-11",
      tags: ["small signal model", "amplifier"],
      previewRevision: "rev-1",
      curationRevision: 1,
    },
    "ag-12": {
      id: "ag-12",
      tags: Array.from({ length: 12 }, (_, i) => `tag-${i}`),
      previewRevision: "rev-1",
      curationRevision: 0,
    },
    "ag-13": {
      id: "ag-13",
      tags: ["amplifier"],
      previewRevision: "rev-1",
      curationRevision: 3,
    },
  };
  const handleRequest = async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : null;
    const getMatch = /^\/api\/gallery\/([^/?]+)\?summary=1$/.exec(
      req.url ?? "",
    );
    if (req.method === "GET" && getMatch) {
      const entry = entries[getMatch[1]];
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ entry }));
      return;
    }
    const patchMatch = /^\/api\/gallery\/([^/?]+)\/curation$/.exec(
      req.url ?? "",
    );
    if (req.method === "PATCH" && patchMatch) {
      patched.push({
        id: patchMatch[1],
        auth: req.headers.authorization,
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          entry: {
            id: patchMatch[1],
            tags: body.tags,
            curationRevision: body.expectedCurationRevision + 1,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  };
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const report = path.join(dir, "report.json");
    const receipt = path.join(dir, "receipt.jsonl");
    writeFileSync(
      report,
      JSON.stringify({
        total: 4,
        entries: [
          {
            id: "ag-10",
            previewRevision: "rev-1",
            imageReviewed: true,
            addTags: ["small signal model", "multi circuit"],
            preserveAttention: true,
          },
          {
            id: "ag-11",
            previewRevision: "rev-1",
            imageReviewed: true,
            addTags: ["small signal model"],
            preserveAttention: true,
          },
          {
            id: "ag-12",
            previewRevision: "rev-1",
            imageReviewed: true,
            addTags: ["multi circuit"],
            preserveAttention: true,
          },
          {
            id: "ag-13",
            previewRevision: "rev-1",
            imageReviewed: true,
            tags: ["buffer"],
            issues: [],
          },
        ],
      }),
    );
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/curate-gallery.mjs",
      "--report",
      report,
      "--apply",
      "--origin",
      `http://127.0.0.1:${port}`,
      "--token",
      "acot_test_token",
      "--concurrency",
      "2",
      "--receipt",
      receipt,
    ]);
    const lines = stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.at(-1)).toEqual({ applied: 1, skipped: 1, conflicts: 2 });
    expect(patched).toEqual([
      {
        id: "ag-10",
        auth: "Bearer acot_test_token",
        body: {
          tags: ["custom legacy", "small signal model", "multi circuit"],
          expectedPreviewRevision: "rev-1",
          expectedCurationRevision: 2,
          source: "visual-audit",
        },
      },
    ]);
    const receiptText = readFileSync(receipt, "utf8");
    expect(receiptText).toContain('"status":"applied"');
    expect(receiptText).toContain('"status":"tags-full"');
    expect(receiptText).toContain('"status":"changed-since-review"');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
