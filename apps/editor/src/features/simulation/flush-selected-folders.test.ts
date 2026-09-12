import { createSimulationFolder } from "@icm/model";
import { describe, expect, it, vi } from "vitest";
import {
  flushSelectedFolders,
  type FolderFlush,
} from "./flush-selected-folders";

describe("selected-folder source capture", () => {
  it("flushes background selections too, once each, using the prior committed revision", async () => {
    const flush = vi.fn(
      async (id: string, revision: number): Promise<FolderFlush> => ({
        ok: true,
        revision: revision + 1,
        folder: createSimulationFolder({ id, name: id, profileId: "test" }),
      }),
    );
    const result = await flushSelectedFolders(
      ["background", "active", "background"],
      4,
      flush,
    );
    expect(flush.mock.calls).toEqual([
      ["background", 4],
      ["active", 5],
    ]);
    expect(result.ok && result.revision).toBe(6);
    expect(result.ok && result.folders.map((folder) => folder.id)).toEqual([
      "background",
      "active",
    ]);
  });
  it("does not return runnable inputs when any selected draft cannot be applied", async () => {
    const flush = vi.fn(async (): Promise<FolderFlush> => ({ ok: false }));
    expect(await flushSelectedFolders(["broken", "next"], 4, flush)).toEqual({
      ok: false,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
