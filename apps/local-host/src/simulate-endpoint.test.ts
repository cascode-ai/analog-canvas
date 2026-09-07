import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startLocalHost, type LocalHostOptions } from "./index.js";

async function withHost(
  check: (origin: string) => Promise<void>,
  simulationHandler?: LocalHostOptions["simulationHandler"],
) {
  const root = await mkdtemp(join(tmpdir(), "icm-host-"));
  await writeFile(join(root, "index.html"), "<title>Editor</title>");
  const host = await startLocalHost({
    editorRoot: root,
    ...(simulationHandler ? { simulationHandler } : {}),
  });
  try {
    await check(host.origin);
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}
const post = (origin: string, body: unknown) =>
  fetch(origin + "/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("optional local simulation", () => {
  it("advertises unconfigured without probing installed programs and leaves Editor usable", async () => {
    await withHost(async (origin) => {
      const caps = await (
        await post(origin, { operation: "capabilities" })
      ).json();
      expect(caps).toMatchObject({
        configured: false,
        profiles: [],
        analyses: [],
      });
      expect(
        (await post(origin, { operation: "cancel", runToken: "r" })).status,
      ).toBe(503);
      expect((await fetch(origin + "/")).status).toBe(200);
      expect(
        (await fetch(origin + "/api/simulate", { method: "PUT" })).status,
      ).toBe(405);
    });
  });
  it("forwards the same prepared and cancellation protocol to an explicit adapter", async () => {
    const inputs: unknown[] = [];
    await withHost(
      async (origin) => {
        for (const input of [
          { operation: "capabilities" },
          { preparedDeck: "deck", runToken: "r", files: [] },
          { operation: "cancel", runToken: "r" },
        ]) {
          expect((await post(origin, input)).status).toBe(200);
          expect(inputs.at(-1)).toEqual(input);
        }
      },
      async (request) => {
        inputs.push(await request.json());
        return Response.json({ ok: true });
      },
    );
  });
  it("contains adapter failures without terminating the host", async () => {
    await withHost(
      async (origin) => {
        expect((await post(origin, {})).status).toBe(503);
        expect((await fetch(origin + "/healthz")).status).toBe(200);
      },
      async () => {
        throw new Error("offline");
      },
    );
  });
});
