import { afterEach, describe, expect, it, vi } from "vitest";
import { newComponentDefinition } from "./component-definition-edit";
import {
  loadSharedComponents,
  saveSharedComponent,
} from "./component-library-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("public component library responses", () => {
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
});
