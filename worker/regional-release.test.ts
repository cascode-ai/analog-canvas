import { expect, it } from "vitest";
import worker from "./index";

it("serves CI receipts read-only and never invents one from available assets", async () => {
  const commit = "b".repeat(40),
    digest = "c".repeat(64);
  const path = `/api/regional-release/verification/${commit}/${digest}/123-1`;
  const receipt = {
    schemaVersion: 1,
    commit,
    sha256: digest,
    attempt: "123-1",
    verified: true,
  };
  let stored: string | null = null;
  const keys: string[] = [];
  const env = {
    REGIONAL_RELEASES: {
      get: async (key: string) => {
        keys.push(key);
        return stored === null ? null : { text: async () => stored! };
      },
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const call = (method = "GET", suffix = "") =>
    worker.fetch(
      new Request(
        `https://analog-canvas-origin.tokenzhang.com${path}${suffix}`,
        { method },
      ),
      env,
    );
  expect((await call()).status).toBe(404);
  stored = JSON.stringify(receipt);
  const response = await call();
  expect(await response.json()).toEqual(receipt);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(keys).toEqual([
    `${commit}/${digest}/123-1.json`,
    `${commit}/${digest}/123-1.json`,
  ]);
  expect((await call("POST")).status).toBe(405);
  expect((await call("GET", "/extra")).status).toBe(404);
  expect(keys).toHaveLength(2);
});
