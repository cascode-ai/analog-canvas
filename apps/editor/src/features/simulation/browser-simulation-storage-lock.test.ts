import { describe, expect, it, vi } from "vitest";
import {
  ProjectEvidenceLease,
  withExclusiveEvidence,
} from "./browser-simulation-storage-lock";

describe("evidence storage lifetime", () => {
  it("does not prevent reads on unsupported hosts or authorize unsafe reclamation", async () => {
    vi.stubGlobal("navigator", undefined);
    try {
      const lease = new ProjectEvidenceLease("project", undefined);
      await lease.acquire();
      await lease.release();
      const reclaim = vi.fn(async () => true);
      expect(
        await withExclusiveEvidence("project", reclaim, undefined),
      ).toEqual({
        available: false,
      });
      expect(reclaim).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("aborts pending acquisition on clear and permits the next lifetime", async () => {
    let signal: AbortSignal;
    const locks = {
      request: vi.fn((_name, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }),
    } as unknown as LockManager;
    const lease = new ProjectEvidenceLease("project", locks);
    const pending = lease.acquire();
    void lease.release();
    await expect(pending).rejects.toThrow("aborted");
    expect(signal!.aborted).toBe(true);
    const next = lease.acquire();
    expect(locks.request).toHaveBeenCalledTimes(2);
    void lease.release();
    await expect(next).rejects.toThrow("aborted");
  });
});
