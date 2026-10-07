import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterizeFormalSvgInBrowser } from "./browser-raster.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A canvas and Image the rasterizer can draw on, keeping the SVG it read. */
function stubRasterGlobals() {
  const drawn: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    drawn.push(blob as Blob);
    return "blob:svg";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: "" }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])),
    }),
  });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  return drawn;
}

const labelled = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><text>R1</text></svg>',
  bounds: { x: 0, y: 0, width: 20, height: 10 },
};

describe("a PNG carries the schematic faces (#1413)", () => {
  it("draws the SVG with DejaVu Sans inlined, as an image loads no font", async () => {
    const drawn = stubRasterGlobals();
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([119, 79, 70, 70]));
    });
    await rasterizeFormalSvgInBrowser(labelled);
    const svg = await drawn[0]!.text();
    expect(fetched).toHaveLength(4);
    expect(svg.match(/@font-face\{font-family:"DejaVu Sans"/gu)).toHaveLength(
      4,
    );
    expect(svg).toContain('src:url("data:font/woff;base64,d09GRg==")');
    // The faces style the document before anything it draws.
    expect(svg.indexOf("<style>")).toBeLessThan(svg.indexOf("<text>"));
    expect(svg.endsWith("<text>R1</text></svg>")).toBe(true);
  });

  it("still draws, in the system's faces, when they cannot be read", async () => {
    vi.resetModules();
    const { rasterizeFormalSvgInBrowser: rasterize } =
      await import("./browser-raster.js");
    const drawn = stubRasterGlobals();
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const image = await rasterize(labelled);
    expect(image.width).toBeGreaterThan(0);
    expect(await drawn[0]!.text()).toBe(labelled.svg);
  });
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
