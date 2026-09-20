import { describe, expect, it, vi } from "vitest";
import { boundExecutionStream } from "./execution-receipt.js";

describe("receipt-bound execution transport", () => {
  it("forwards exact byte lengths including multibyte text", async () => {
    const bytes = new TextEncoder().encode("µ电路");
    expect(
      await new Response(
        boundExecutionStream(new Blob([bytes]).stream(), bytes.length),
      ).text(),
    ).toBe("µ电路");
  });
  it.each([2, 4])(
    "rejects a body whose length differs from receipt %s",
    async (length) => {
      await expect(
        new Response(
          boundExecutionStream(new Blob(["abc"]).stream(), length),
        ).text(),
      ).rejects.toThrow();
    },
  );
  it("propagates downstream cancellation without draining the result", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const reader = boundExecutionStream(body, 1000000).getReader();
    await reader.read();
    await reader.cancel("closed");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("closed"));
  });
});
