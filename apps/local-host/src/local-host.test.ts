import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startLocalHost } from "./index.js";

describe("portable local host", () => {
  it("serves the PWA shell on loopback with security headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-host-"));
    await writeFile(
      join(root, "index.html"),
      "<!doctype html><title>ICM</title>",
    );
    const running = await startLocalHost({ editorRoot: root });
    try {
      expect(running.origin).toMatch(/^http:\/\/127\.0\.0\.1:/u);
      const response = await fetch(running.origin);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ICM");
      expect(response.headers.get("content-security-policy")).toContain(
        "default-src 'self'",
      );
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await (await fetch(`${running.origin}/healthz`)).json()).toEqual({
        status: "ok",
        version: "0.2.0",
      });
      expect((await fetch(`${running.origin}/..%2Fsecret.txt`)).status).toBe(
        404,
      );
      expect((await fetch(running.origin, { method: "POST" })).status).toBe(
        405,
      );
    } finally {
      await running.close();
    }
  });
});
