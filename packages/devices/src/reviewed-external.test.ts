import { describe, expect, it } from "vitest";

import {
  projectLengthToSky130Micrometres,
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  sky130MicrometresToProjectLength,
} from "./reviewed-external.js";

describe("reviewed external device bindings", () => {
  it("recognizes only exact reviewed names and exact public interfaces", () => {
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__res_high_po", [
        "R0",
        "R1",
        "B",
      ]),
    ).toMatchObject({
      id: "sky130-res-high-po",
      symbolId: "resistor",
      terminals: [
        { targetName: "R0", pinName: "1", interaction: "canvas" },
        { targetName: "R1", pinName: "2", interaction: "canvas" },
        { targetName: "B", pinName: "B", interaction: "property" },
      ],
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__res_high_po", [
        "R1",
        "R0",
        "B",
      ]),
    ).toBeUndefined();
    expect(
      reviewedExternalBindingForMaster("sky130_fd_pr__nfet_g5v0d10v5"),
    ).toBeUndefined();
  });

  it("converts reviewed geometry in both directions without aliasing counts", () => {
    expect(projectLengthToSky130Micrometres("150n")).toBe("0.15");
    expect(projectLengthToSky130Micrometres("5.5u")).toBe("5.5");
    expect(sky130MicrometresToProjectLength("0.15")).toBe("150n");
    expect(sky130MicrometresToProjectLength("5.5")).toBe("5.5u");
    expect(() => sky130MicrometresToProjectLength("150n")).toThrow(
      /plain micrometre/u,
    );
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__nfet_01v8",
      )?.parameters.map((parameter) => parameter.name),
    ).toEqual(["w", "l", "nf", "m"]);
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__nfet_01v8",
      )?.parameters.map((parameter) => [
        parameter.name,
        parameter.targetDefaultValue,
      ]),
    ).toEqual([
      ["w", "1"],
      ["l", "0.15"],
      ["nf", "1"],
      ["m", "1"],
    ]);
  });
});
