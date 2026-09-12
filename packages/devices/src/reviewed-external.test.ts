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
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__pnp_05v5_W0p68L0p68", [
        "C",
        "B",
        "E",
      ]),
    ).toMatchObject({
      id: "sky130-pnp-05v5-w0p68l0p68",
      symbolId: "pnp",
      deviceClass: "bjt",
      terminals: [
        { pinName: "C", interaction: "canvas" },
        { pinName: "B", interaction: "canvas" },
        { pinName: "E", interaction: "canvas" },
      ],
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__npn_05v5_W1p00L1p00", [
        "C",
        "B",
        "E",
        "S",
      ]),
    ).toMatchObject({
      id: "sky130-npn-05v5-w1p00l1p00",
      symbolId: "npn",
      deviceClass: "bjt",
    });
    expect(
      resolveReviewedExternalBinding("sky130_fd_pr__pnp_05v5_W0p68L0p68", [
        "C",
        "B",
        "E",
        "S",
      ]),
    ).toBeUndefined();
  });

  it("converts reviewed geometry in both directions without aliasing counts", () => {
    expect(projectLengthToSky130Micrometres("150n")).toBe("0.15");
    expect(projectLengthToSky130Micrometres("{WIDTH}")).toBe("{(WIDTH) / 1u}");
    expect(sky130MicrometresToProjectLength("{WIDTH}")).toBe("{(WIDTH) * 1u}");
    expect(
      projectLengthToSky130Micrometres(
        sky130MicrometresToProjectLength("{WIDTH * 2}"),
      ),
    ).toBe("{WIDTH * 2}");
    expect(
      sky130MicrometresToProjectLength(
        projectLengthToSky130Micrometres("{WIDTH * 2}"),
      ),
    ).toBe("{WIDTH * 2}");
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
    expect(
      reviewedExternalBindingForMaster(
        "sky130_fd_pr__pfet_01v8_lvt",
      )?.parameters.map((parameter) => [
        parameter.name,
        parameter.defaultValue,
        parameter.targetDefaultValue,
      ]),
    ).toEqual([
      ["w", "3u", "3"],
      ["l", "350n", "0.35"],
      ["nf", "1", "1"],
      ["m", "1", "1"],
    ]);
  });
});
