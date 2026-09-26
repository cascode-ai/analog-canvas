// Static-serving assertions adapted from LXY-freshman's local-shell.test.ts.
// AGPL-3.0-only; fixed source and scope in ../SOURCES.md.
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { APP_ORIGIN, createAppProtocolHandler } from "./app-protocol";
import { createExportHandler } from "./export-file";

describe("desktop preview protocol", () => {
  it("serves local assets, SPA routes and script CSP without opening an online API", async () => {
    const root = await mkdtemp(join(tmpdir(), "canvas-protocol-"));
    await writeFile(
      join(root, "index.html"),
      '<html><head><script>console.log("theme")</script></head></html>',
    );
    await writeFile(join(root, "app.js"), "export {};");
    const deliver = vi.fn(async () => new Response("export"));
    const handle = await createAppProtocolHandler({
      editorRoot: root,
      exportFile: deliver,
    });
    const index = await handle(new Request(`${APP_ORIGIN}/editor`));
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toMatch(
      /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/u,
    );
    expect(index.headers.get("content-security-policy")).not.toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(
      await (await handle(new Request(`${APP_ORIGIN}/app.js`))).text(),
    ).toBe("export {};");
    for (const url of [
      `${APP_ORIGIN}/api/auth/me`,
      "app://elsewhere/",
      `${APP_ORIGIN}/..%5csecret.txt`,
      `${APP_ORIGIN}/missing.js`,
    ])
      expect((await handle(new Request(url))).status).toBe(404);
    expect((await handle(new Request(`${APP_ORIGIN}/%zz`))).status).toBe(400);
    expect(
      (await handle(new Request(`${APP_ORIGIN}/app.js`, { method: "POST" })))
        .status,
    ).toBe(405);
    expect(deliver).not.toHaveBeenCalled();
    await handle(
      new Request(`${APP_ORIGIN}/desktop/export`, { method: "POST" }),
    );
    expect(deliver).toHaveBeenCalledOnce();
  });
});

describe("preview export delivery", () => {
  const request = (name = "Circuit.icproj.json", origin = APP_ORIGIN) =>
    new Request(`${APP_ORIGIN}/desktop/export`, {
      method: "POST",
      headers: { origin, "x-export-name": encodeURIComponent(name) },
      body: "canonical project bytes",
    });
  it("writes only the dialog-approved destination and reports success after completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-export-"));
    const path = join(directory, "chosen.icproj.json");
    await writeFile(path, "old bytes");
    const choose = vi.fn(async () => path);
    expect(await (await createExportHandler(choose)(request())).json()).toEqual(
      { status: "saved" },
    );
    expect(await readFile(path, "utf8")).toBe("canonical project bytes");
    expect(await readdir(directory)).toEqual(["chosen.icproj.json"]);
    expect(choose).toHaveBeenCalledWith("Circuit.icproj.json");
  });
  it("does not write on cancellation, wrong origin, invalid path or write failure", async () => {
    const choose = vi.fn(async () => null);
    const deliver = createExportHandler(choose);
    expect(await (await deliver(request())).json()).toEqual({
      status: "cancelled",
    });
    expect((await deliver(request("../escape.json"))).status).toBe(400);
    expect(
      (await deliver(request("ok.json", "https://example.com"))).status,
    ).toBe(403);
    expect(choose).toHaveBeenCalledOnce();
    const directory = await mkdtemp(join(tmpdir(), "canvas-export-fail-"));
    const failed = createExportHandler(async () =>
      join(directory, "absent", "file.json"),
    );
    expect(await (await failed(request())).json()).toMatchObject({
      status: "failed",
    });
    expect(await readdir(directory)).toEqual([]);
  });
  it("refuses overlapping exports while a native choice is pending", async () => {
    let finish!: (path: null) => void;
    const choose = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    );
    const deliver = createExportHandler(choose);
    const first = deliver(request());
    await vi.waitFor(() => expect(choose).toHaveBeenCalledOnce());
    expect((await deliver(request())).status).toBe(409);
    finish(null);
    expect(await (await first).json()).toEqual({ status: "cancelled" });
  });
});
