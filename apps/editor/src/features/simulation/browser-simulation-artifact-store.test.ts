import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";

describe("persistent simulation evidence", () => {
  it("spills a file above the old cache limit and reopens it after clear without crossing Projects", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const get = vi.spyOn(store, "get");
    let now = 0;
    const files = new SimulationFiles(() => now, undefined, undefined, store);
    const text = "0123456789abcdef".repeat(17 * 65536);
    const ref = await files.put("large.raw", "text/plain", text, {
      role: "raw",
    });
    now = 24 * 60 * 60 * 1000;
    expect(await files.readArtifact(ref.id)).toMatchObject({ ok: true, text });
    expect(get).toHaveBeenCalledTimes(1); // body was evicted from the 16 MiB cache
    files.clear();
    const reopened = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("project", factory),
    );
    const restored = await reopened.readArtifact(ref.id);
    expect(restored).toEqual({ ok: true, artifact: ref, text });
    const other = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("other-project", factory),
    );
    expect(await other.readArtifact(ref.id)).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_UNAVAILABLE" },
    });
    expect(
      await reopened.handle({
        action: "artifact",
        artifactId: ref.id,
        maxChars: 5,
      }),
    ).toMatchObject({
      ok: true,
      text: "01234",
      nextOffset: 5,
    });
    const publisher = vi.fn(
      async () => "/api/agent/sessions/new/artifacts/file",
    );
    reopened.setArtifactPublisher(publisher);
    await vi.waitFor(async () => {
      expect(
        await reopened.handle({ action: "download", artifactId: ref.id }),
      ).toMatchObject({
        ok: true,
        download: { path: "/api/agent/sessions/new/artifacts/file" },
      });
    });
    expect(publisher).toHaveBeenCalledWith(ref, text);
    expect(publisher).toHaveBeenCalledTimes(1);
  });

  it("rejects immutable identity collisions and storage failures instead of reporting durable success", async () => {
    const store = createBrowserSimulationArtifactStore(
      "project",
      new IDBFactory(),
    )!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put("one.raw", "text/plain", "one");
    await store.put(ref, "one");
    await expect(
      store.put({ ...ref, name: "another.raw" }, "one"),
    ).rejects.toThrow("ARTIFACT_ID_CONFLICT");
    expect((await store.get(ref.id))?.text).toBe("one");
    const failing = new SimulationFiles(Date.now, undefined, undefined, {
      put: async () => {
        throw new DOMException("Full", "QuotaExceededError");
      },
      get: async () => {
        throw new Error("Unavailable");
      },
    });
    await expect(failing.put("x", "text/plain", "x")).rejects.toThrow(
      "ARTIFACT_STORAGE_UNAVAILABLE",
    );
    expect(await failing.readArtifact("unknown")).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_STORAGE_UNAVAILABLE" },
    });
  });
});
