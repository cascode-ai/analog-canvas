import { afterEach, describe, expect, it, vi } from "vitest";
import { browserExportDelivery } from "./browser-export-delivery";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser file delivery", () => {
  it.each([false, true])(
    "releases temporary bytes after a download attempt (click failure: %s)",
    async (failClick) => {
      let release: (() => void) | undefined;
      const click = vi.fn(() => {
        if (failClick) throw new Error("Download blocked");
      });
      const anchor = { href: "", download: "", click };
      vi.stubGlobal("window", {
        document: { createElement: () => anchor },
        setTimeout: (callback: () => void) => {
          release = callback;
        },
      });
      const create = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:export");
      const revoke = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => {});
      const result = browserExportDelivery.deliverFile({
        bytes: "<svg/>",
        mediaType: "image/svg+xml",
        suggestedName: "circuit.svg",
      });
      if (failClick) await expect(result).rejects.toThrow("Download blocked");
      else
        await expect(result).resolves.toEqual({ status: "download-requested" });
      expect(anchor.href).toBe("blob:export");
      expect(anchor.download).toBe("circuit.svg");
      expect(click).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0]![0] as Blob;
      expect(blob.type).toBe("image/svg+xml");
      expect(await blob.text()).toBe("<svg/>");
      expect(revoke).not.toHaveBeenCalled();
      expect(release).toBeDefined();
      release!();
      expect(revoke).toHaveBeenCalledWith("blob:export");
    },
  );
});
