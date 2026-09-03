import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterizeFormalSvgInBrowser } from "./browser-raster.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser PNG lifecycle", () => {
  it("rejects excessive dimensions before allocating a canvas or URL", async () => {
    const allocate = vi.spyOn(URL, "createObjectURL");
    await expect(
      rasterizeFormalSvgInBrowser({
        svg: "<svg/>",
        bounds: { x: 0, y: 0, width: 100000, height: 100000 },
      }),
    ).rejects.toThrow("too large");
    expect(allocate).not.toHaveBeenCalled();
  });
  it.each(["white", "transparent"] as const)(
    "uses %s background and releases the canvas and URL",
    async (background) => {
      const fillRect = vi.fn();
      const drawImage = vi.fn();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ fillRect, drawImage, fillStyle: "" }),
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])),
      };
      vi.stubGlobal("document", { createElement: () => canvas });
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          set src(_: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      const release = vi.spyOn(URL, "revokeObjectURL");
      const image = await rasterizeFormalSvgInBrowser(
        {
          svg: "<svg/>",
          bounds: { x: 0, y: 0, width: 20, height: 10 },
        },
        3,
        { background },
      );
      expect(image.width).toBe(60);
      expect(image.height).toBe(30);
      expect(fillRect).toHaveBeenCalledTimes(background === "white" ? 1 : 0);
      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    },
  );
});
