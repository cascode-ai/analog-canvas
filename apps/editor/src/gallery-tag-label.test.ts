import { describe, expect, it } from "vitest";
import {
  compareGalleryLabels,
  compareGalleryTagLabels,
  galleryTagLabel,
} from "./gallery-tag-label";

describe("galleryTagLabel", () => {
  it("presents normalized tags as readable labels without changing identity", () => {
    expect(galleryTagLabel("amplifier")).toBe("General Amplifier");
    expect(galleryTagLabel("auto zero")).toBe("Auto-Zero");
    expect(galleryTagLabel("differential pair")).toBe("Differential Pair");
    expect(galleryTagLabel("rf switch")).toBe("RF Switch");
    expect(galleryTagLabel("cmfb")).toBe("CMFB");
    expect(galleryTagLabel("nand")).toBe("NAND");
    expect(galleryTagLabel("dcdc")).toBe("DC–DC");
    expect(galleryTagLabel("lc oscillator")).toBe("LC Oscillator");
    expect(galleryTagLabel("active rc")).toBe("Active RC");
    expect(galleryTagLabel("gm c")).toBe("gm-C");
    expect(galleryTagLabel("custom legacy tag")).toBe("Custom Legacy Tag");
  });

  it("sorts by the displayed label instead of popularity", () => {
    expect(
      ["logic", "latch", "inverter", "cml", "nand"].sort(
        compareGalleryTagLabels,
      ),
    ).toEqual(["cml", "inverter", "latch", "logic", "nand"]);
    expect(
      ["Conversion", "Bias & references", "Amplifiers"].sort(
        compareGalleryLabels,
      ),
    ).toEqual(["Amplifiers", "Bias & references", "Conversion"]);
  });
});
