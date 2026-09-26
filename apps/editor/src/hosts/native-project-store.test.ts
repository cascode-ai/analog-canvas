import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createNativeProjectStore } from "./native-project-store";
afterEach(() => vi.unstubAllGlobals());
const file = {
  id: "authorized",
  revision: 1,
  name: "A.icproj.json",
  path: "C:\\Projects\\A.icproj.json",
};
it("passes opaque bindings, canonical bytes and explicit Save As without authorizing a path", async () => {
  const fetch = vi.fn(async () => Response.json({ status: "saved", file }));
  vi.stubGlobal("fetch", fetch);
  const store = createNativeProjectStore();
  expect(
    (await store.save(createEmptyProject("a", "A"), file, true)).status,
  ).toBe("saved");
  const call = (fetch.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(call[0]).toBe("/desktop/project/save");
  const body = JSON.parse(call[1].body as string);
  expect(body.saveAs).toBe(true);
  expect(body.binding.id).toBe(file.id);
  expect(JSON.parse(body.text).name).toBe("A");
  expect(body.path).toBeUndefined();
});
it("rejects malformed receipts and preserves cancellation/conflict outcomes", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ status: "saved", file: { path: "arbitrary" } }),
    )
    .mockResolvedValueOnce(Response.json({ status: "cancelled" }))
    .mockResolvedValueOnce(
      Response.json({ status: "conflict", message: "changed" }),
    );
  vi.stubGlobal("fetch", fetch);
  const store = createNativeProjectStore(),
    project = createEmptyProject("a", "A");
  expect((await store.save(project, null)).status).toBe("failed");
  expect(await store.open()).toEqual({ status: "cancelled" });
  expect(await store.save(project, file)).toEqual({
    status: "conflict",
    message: "changed",
  });
});
it("opens a persisted recent id instead of sending a caller-supplied filesystem path", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ status: "opened", file, text: "project" }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await createNativeProjectStore().open("recent-id")).status).toBe(
    "opened",
  );
  const call = (fetch.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(call[1].headers).toMatchObject({ "x-recent-project": "recent-id" });
  expect(call[1].body).toBeUndefined();
});
