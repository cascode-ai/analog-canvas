import { afterEach, describe, expect, it, vi } from "vitest";
import { newComponentDefinition } from "./component-definition-edit";
import {
  loadSharedComponents,
  readSharedComponent,
  saveSharedComponent,
  loadSharedComponentSummaries,
} from "./component-library-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("public component library responses", () => {
  it("bounds summary body reads and reports a timed-out publication as unknown", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })),
    );
    const read = loadSharedComponentSummaries("", null).catch(
      (error: Error) => error,
    );
    const write = saveSharedComponent(
      "bounded-write",
      0,
      newComponentDefinition(),
      undefined,
      { idempotencyKey: "bounded-write-retry" },
    ).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await read).toMatchObject({ status: 408, outcomeUnknown: false });
    expect(await write).toMatchObject({ status: 408, outcomeUnknown: true });
  });
  it("isolates invalid historical definitions while retaining their raw records and strict reads", async () => {
    const definition = newComponentDefinition();
    const metadata = {
      id: "healthy-component",
      revision: 1,
      authorId: "alice",
      author: "Alice",
      status: "shared",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const healthy = { ...metadata, definition };
    const legacy = {
      ...metadata,
      id: "legacy-component",
      definition: {
        ...definition,
        subcircuit: {
          id: "legacy-interface",
          symbolId: definition.symbol.id,
          target: "legacy",
          ports: [{ name: "IN", pinName: "IN", direction: "input" }],
        },
      },
    };
    const fetchLibrary: typeof fetch = vi.fn(async () =>
      Response.json({
        entries: [healthy, legacy],
        nextCursor: "legacy-component",
      }),
    );
    const page = await loadSharedComponents(
      "",
      null,
      false,
      undefined,
      fetchLibrary,
    );
    expect(page.entries.map((entry) => entry.id)).toEqual([
      "healthy-component",
    ]);
    expect(page.nextCursor).toBe("legacy-component");
    expect(page.rejected).toMatchObject([
      {
        id: "legacy-component",
        name: definition.symbol.name,
        author: "Alice",
        record: legacy,
      },
    ]);
    expect(page.rejected![0]!.message).toContain("missing OUT");
    await expect(
      readSharedComponent("legacy-component", async () =>
        Response.json({ entry: legacy }),
      ),
    ).rejects.toThrow("missing OUT");
    await expect(
      saveSharedComponent("legacy-component", 1, definition, undefined, {
        fetch: async () => Response.json({ entry: legacy }),
      }),
    ).rejects.toThrow("missing OUT");
  });
  it("preserves caller cancellation while a response body is being read", async () => {
    const caller = new AbortController();
    let readingBody!: () => void;
    const reading = new Promise<void>((resolve) => {
      readingBody = resolve;
    });
    const fetchLibrary: typeof fetch = vi.fn(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true },
              );
              controller.enqueue(new TextEncoder().encode('{"entries":'));
              readingBody();
            },
          }),
        ),
    );
    const failure = loadSharedComponents(
      "",
      null,
      false,
      caller.signal,
      fetchLibrary,
    ).catch((error: Error) => error);
    await reading;
    caller.abort();
    expect(await failure).toBe(caller.signal.reason);
  });
  it.each(["request", "body"])(
    "bounds a stalled list %s so the library can offer Try Again",
    async (stage) => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      const fetchLibrary: typeof fetch = vi.fn(async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        if (stage === "body") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"entries":'));
                requestSignal?.addEventListener(
                  "abort",
                  () => controller.error(requestSignal?.reason),
                  { once: true },
                );
              },
            }),
          );
        }
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        });
      });
      const failure = loadSharedComponents(
        "",
        null,
        false,
        undefined,
        fetchLibrary,
      ).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(requestSignal?.aborted).toBe(true);
      expect(await failure).toMatchObject({
        message: "Component library timed out. Try again.",
      });
    },
  );
  it.each([
    () => new Response("<!doctype html><html></html>"),
    () => Response.json({}),
    () => Response.json({ entries: [null], nextCursor: null }),
  ])(
    "rejects an unavailable or malformed service without passing broken state to the library",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response()),
      );
      await expect(loadSharedComponents("", null)).rejects.toThrow(
        "Component library unavailable",
      );
    },
  );

  it("accepts an empty public library", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ entries: [], nextCursor: null })),
    );
    await expect(loadSharedComponents("", null)).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it("never treats a malformed successful save as a publicly saved definition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ entry: {} })),
    );
    await expect(
      saveSharedComponent("test-component", 0, newComponentDefinition()),
    ).rejects.toThrow("invalid entry");
  });

  it("preserves the server's useful save failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Sign in to save" }, { status: 401 }),
      ),
    );
    await expect(
      saveSharedComponent("test-component", 0, newComponentDefinition()),
    ).rejects.toThrow("Sign in to save");
  });
  it.each(["request", "body"])(
    "reports a lost write %s as unknown, preserving same-operation recovery",
    async (stage) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (stage === "request") throw new TypeError("Connection lost");
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("Body lost"));
              },
            }),
          );
        }),
      );
      await expect(
        saveSharedComponent("test-component", 0, newComponentDefinition()),
      ).rejects.toMatchObject({ outcomeUnknown: true });
    },
  );
});
