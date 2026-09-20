import { describe, expect, it } from "vitest";
import { galleryTagLabel } from "./gallery-tag-label";

describe("galleryTagLabel", () => {
  it("presents normalized tags as readable labels without changing identity", () => {
    expect(galleryTagLabel("amplifier")).toBe("General Amplifier");
    expect(galleryTagLabel("differential pair")).toBe("Differential Pair");
    expect(galleryTagLabel("rf switch")).toBe("RF Switch");
    expect(galleryTagLabel("cmfb")).toBe("CMFB");
    expect(galleryTagLabel("gm c")).toBe("gm-C");
    expect(galleryTagLabel("custom legacy tag")).toBe("Custom Legacy Tag");
  });
});
