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

  it("keeps a mixed-case term's capitals inside a longer tag", () => {
    expect(galleryTagLabel("r-2r ladder")).toBe("R-2R Ladder");
    expect(galleryTagLabel("dc-dc converter")).toBe("DC–DC Converter");
    expect(galleryTagLabel("dc-ac-dc")).toBe("DC–AC–DC");
    expect(galleryTagLabel("power amplifier")).toBe("Power Amplifier");
    expect(galleryTagLabel("vga")).toBe("VGA");
    expect(galleryTagLabel("bicmos")).toBe("BiCMOS");
    expect(galleryTagLabel("class-ab output")).toBe("Class-AB Output");
  });

  it("keeps small words lowercase after the first word, gate names aside", () => {
    expect(galleryTagLabel("sample and hold")).toBe("Sample and Hold");
    expect(galleryTagLabel("sample-and-hold")).toBe("Sample-and-Hold");
    expect(galleryTagLabel("computing in memory")).toBe("Computing in Memory");
    expect(galleryTagLabel("voltage to current")).toBe("Voltage to Current");
    expect(galleryTagLabel("and")).toBe("AND");
    expect(galleryTagLabel("or gate")).toBe("OR Gate");
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
