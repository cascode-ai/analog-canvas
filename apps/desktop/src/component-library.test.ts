import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { newComponentDefinition } from "../../editor/src/features/user-components/component-definition-edit";
import { createLocalComponentHandler } from "./component-library";
import { APP_ORIGIN } from "./app-protocol";
import { nativePackage } from "../../../worker/component-library.test-support";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("keeps complete native source packages, refuses stale changes and replays an acknowledged save", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-components-"));
  directories.push(directory);
  const path = join(directory, "components.json");
  const handle = createLocalComponentHandler(path);
  const request = (action: string, body = {}, origin = APP_ORIGIN) =>
    new Request(`${APP_ORIGIN}/desktop/components/${action}`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(body),
    });
  const payload = nativePackage();
  const save = {
    id: "native-package",
    revision: 0,
    ...payload,
    idempotencyKey: "save-native",
  };
  expect((await handle(request("save", save))).ok).toBe(true);
  const restarted = createLocalComponentHandler(path);
  const replay = await restarted(request("save", save));
  expect((await replay.json()).entry).toMatchObject({
    revision: 1,
    ...payload,
  });
  expect(
    (
      await handle(
        request("save", {
          ...save,
          definition: {
            ...payload.definition,
            symbol: { ...payload.definition.symbol, name: "Other" },
          },
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (await handle(request("save", { ...save, idempotencyKey: "stale" })))
      .status,
  ).toBe(409);
  expect(
    (await handle(request("check", { id: save.id, revision: 1 }))).ok,
  ).toBe(true);
  expect(
    (await handle(request("delete", { id: save.id, revision: 1 }))).ok,
  ).toBe(true);
  expect(
    (await handle(request("check", { id: save.id, revision: 2 }))).status,
  ).toBe(409);
  expect(
    (await handle(request("restore", { id: save.id, revision: 2 }))).ok,
  ).toBe(true);
  const restored = await restarted(request("read", { id: save.id }));
  expect((await restored.json()).entry).toMatchObject({
    revision: 3,
    status: "shared",
    ...payload,
  });
  expect(
    (
      await handle(
        request("save", {
          ...save,
          revision: 3,
          circuit: {
            ...payload.circuit,
            source: {
              ...payload.circuit.source,
              files: [{ path: "bad.sp", text: "invalid source" }],
            },
          },
        }),
      )
    ).ok,
  ).toBe(false);
  expect(
    (await handle(request("read", { id: save.id }, "https://example.com")))
      .status,
  ).toBe(403);
  expect(
    (await handle(request("save", { ...save, id: "../../secret" }))).ok,
  ).toBe(false);
  expect((await handle(request("unknown", { id: save.id }))).status).toBe(404);
  expect(
    (await (await restarted(request("read", { id: save.id }))).json()).entry,
  ).toMatchObject({ revision: 3, ...payload });
});

it("refuses oversized requests before saving a local component", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-components-"));
  directories.push(directory);
  const handle = createLocalComponentHandler(
    join(directory, "components.json"),
  );
  const response = await handle(
    new Request(`${APP_ORIGIN}/desktop/components/save`, {
      method: "POST",
      headers: { origin: APP_ORIGIN },
      body: JSON.stringify({
        id: "oversized",
        revision: 0,
        definition: newComponentDefinition(),
        unused: "x".repeat(300 * 1024),
      }),
    }),
  );
  expect(response.status).toBe(413);
});

it("saves a reusable definition on this computer and reopens it after restarting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-components-"));
  directories.push(directory);
  const path = join(directory, "components.json");
  const definition = newComponentDefinition();
  definition.symbol.name = "Local test component";
  const request = (action: string, body = {}) =>
    new Request(`${APP_ORIGIN}/desktop/components/${action}`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const first = createLocalComponentHandler(path);
  const saved = await first(
    request("save", {
      id: "local-test-component",
      revision: 0,
      definition,
      idempotencyKey: "first-save",
    }),
  );
  expect(saved.ok).toBe(true);
  expect((await saved.json()).entry).toMatchObject({
    id: "local-test-component",
    revision: 1,
    definition,
  });
  const restarted = createLocalComponentHandler(path);
  const response = await restarted(
    request("read", { id: "local-test-component" }),
  );
  expect(response.ok).toBe(true);
  expect((await response.json()).entry).toMatchObject({
    revision: 1,
    definition,
  });
});
