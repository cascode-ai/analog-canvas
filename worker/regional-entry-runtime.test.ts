import { afterEach, expect, it, vi } from "vitest";
import distribution from "../config/agent-mcp-distribution.json" with { type: "json" };
import canvas from "./index";
import * as regionalModule from "./regional-entry";
import entry from "./regional-entry";
import {
  REGIONAL_SCHEDULED_PATH,
  regionalRateLimiters,
} from "./regional-runtime";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import { environment, ORIGIN } from "./gallery.test-support";

afterEach(() => vi.restoreAllMocks());
const origin = "http://localhost:18082";
function target(extra: Record<string, unknown> = {}) {
  const source = environment();
  return {
    ...source,
    AUTH: source.AUTH!,
    ...regionalRuntimeBindings(),
    AUTH_REGIONAL_CLIENT: JSON.stringify({
      origin: ORIGIN,
      clientOrigin: origin,
      secret: "regional-runtime-client-secret-0123456789",
    }),
    PROJECT_SYNC_ADMIN_TOKEN: "regional-admin-token",
    ...extra,
  };
}

it("advertises the verified release archive from the regional editor origin", async () => {
  const response = await entry.fetch(
    new Request(`${origin}/api/agent/mcp-manifest.json`),
    target(),
  );
  expect(response.status).toBe(200);
  const manifest = await response.json();
  const downloadUrl = `${origin}/downloads/mcp/${distribution.release.asset}`;
  expect(manifest).toMatchObject({
    version: distribution.version,
    distribution: { downloadUrl, sha256: distribution.release.sha256 },
    launch: { command: "npx", env: { ANALOG_CANVAS_API_URL: origin } },
  });
  expect(manifest.launch.args.join(" ")).toContain("https://github.com/");
  expect(manifest.installation.command).toMatch(/^node /u);
  expect(manifest.installation.command).toContain(downloadUrl);
  expect(manifest.installation.command).toContain(distribution.release.sha256);
  expect(manifest.hosts.codex.command).toContain(downloadUrl);
});

it("exports only entrypoints workerd accepts: the handler and classes", () => {
  for (const [name, value] of Object.entries(regionalModule)) {
    if (name === "default") continue;
    expect(
      typeof value === "function" &&
        /^class\b/u.test(Function.prototype.toString.call(value)),
      `${name} must be a Durable Object or entrypoint class`,
    ).toBe(true);
  }
});

it("keeps Production's simple limit per client address in one window", async () => {
  let now = 0;
  const { API: limiter } = regionalRateLimiters(
    JSON.stringify({ API: { limit: 2, period: 60 } }),
    () => now,
  );
  const results = [];
  for (let i = 0; i < 3; i++)
    results.push((await limiter!.limit({ key: "203.0.113.9" })).success);
  expect(results).toEqual([true, true, false]);
  expect((await limiter!.limit({ key: "203.0.113.10" })).success).toBe(true);
  now = 60_000;
  expect((await limiter!.limit({ key: "203.0.113.9" })).success).toBe(true);
});

it("limits API floods by the proxy's address and ignores a client's own header", async () => {
  const env = target({
    REGIONAL_RATE_LIMITS: JSON.stringify({
      API_RATE_LIMITER: { limit: 1, period: 60 },
    }),
  });
  const ask = (headers: Record<string, string>) =>
    entry.fetch(new Request(`${origin}/api/gallery`, { headers }), env);
  // A client-chosen address never selects a fresh allowance.
  expect((await ask({ "x-real-ip": "198.51.100.7" })).status).toBe(200);
  expect(
    (
      await ask({
        "x-real-ip": "198.51.100.7",
        "cf-connecting-ip": "192.0.2.1",
      })
    ).status,
  ).toBe(429);
  // Loopback services without a proxy address are not counted.
  expect((await ask({})).status).toBe(200);
});

it("runs Production's scheduled work only for the loopback timer's credential", async () => {
  const scheduled = vi
    .spyOn(canvas, "scheduled")
    .mockResolvedValue(undefined as never);
  const env = target();
  const call = (headers: Record<string, string>, method = "POST") =>
    entry.fetch(
      new Request(origin + REGIONAL_SCHEDULED_PATH, { method, headers }),
      env,
    );
  expect((await call({})).status).toBe(404);
  expect(
    (
      await call({
        authorization: "Bearer regional-admin-token",
        "x-real-ip": "198.51.100.7",
      })
    ).status,
  ).toBe(404);
  expect(
    (await call({ authorization: "Bearer regional-admin-token" }, "GET"))
      .status,
  ).toBe(404);
  expect(scheduled).not.toHaveBeenCalled();
  const ran = await call({ authorization: "Bearer regional-admin-token" });
  expect(ran.status).toBe(200);
  expect(scheduled).toHaveBeenCalledTimes(1);
});
