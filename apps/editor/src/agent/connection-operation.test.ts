import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionOperation } from "./connection-operation";

afterEach(() => vi.useRealTimers());

describe("connection operation deadlines", () => {
  it("releases a hung recovery flush without waiting for that work to finish", async () => {
    vi.useFakeTimers();
    const operation = new ConnectionOperation("creating");
    const result = expect(
      operation.wait(new Promise(() => {})),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(operation.signal.aborted).toBe(true);
    operation.finish();
    expect(operation.pending).toBe(false);
  });

  it("cancels an old operation even if the underlying work later succeeds", async () => {
    let complete!: (value: string) => void;
    const operation = new ConnectionOperation("creating");
    const work = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const result = expect(operation.wait(work)).rejects.toThrow("superseded");
    operation.cancel();
    complete("late session");
    await result;
    expect(operation.pending).toBe(false);
  });

  it("clears the deadline on success and propagates preparation failures", async () => {
    vi.useFakeTimers();
    const operation = new ConnectionOperation("creating");
    await expect(
      operation.wait(Promise.reject(new Error("Cannot save draft"))),
    ).rejects.toThrow("Cannot save draft");
    operation.finish();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(operation.signal.aborted).toBe(false);
    expect(operation.pending).toBe(false);
  });
});
