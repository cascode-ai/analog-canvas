import { describe, expect, it } from "vitest";

import { transformPoint, type Mirror, type Orientation } from "@icm/model";

import {
  acOrientation,
  composeOrient,
  orientPoint,
  rnlOrient,
  type RnlOrient,
} from "./orientation.js";
import { acPosition, rnlPlace, toRnlPoint } from "./place.js";

const QUARTERS = [0, 90, 180, 270] as const;
const MIRRORS: readonly Mirror[] = ["none", "horizontal", "vertical", "both"];
const CODES: readonly RnlOrient[] = [
  "R0",
  "R90",
  "R180",
  "R270",
  "MY",
  "MX",
  "MYR90",
  "MXR90",
];

const turned = (rotation: number): Orientation["rotation"] =>
  ((rotation + 180) % 360) as Orientation["rotation"];

describe("orientations", () => {
  it("agrees with the table the RNL round-trip experiment verified", () => {
    // rnl-dev tools/rnl-lang/scripts/icproj2rnl.py, ORIENTS: 13 drawings and
    // 184 wires came back identical through it.
    const table: [Orientation["rotation"], Mirror, RnlOrient][] = [
      [0, "none", "R0"],
      [90, "none", "R270"],
      [180, "none", "R180"],
      [270, "none", "R90"],
      [0, "horizontal", "MY"],
      [90, "horizontal", "MYR90"],
      [180, "horizontal", "MX"],
      [270, "horizontal", "MXR90"],
    ];
    for (const [rotation, mirror, orient] of table)
      expect(rnlOrient({ rotation, mirror }), `${rotation} ${mirror}`).toEqual({
        ok: true,
        orient,
      });
  });

  it("draws a vertical mirror as a horizontal one turned half round, both as a half turn", () => {
    for (const rotation of QUARTERS) {
      expect(rnlOrient({ rotation, mirror: "vertical" })).toEqual(
        rnlOrient({ rotation: turned(rotation), mirror: "horizontal" }),
      );
      expect(rnlOrient({ rotation, mirror: "both" })).toEqual(
        rnlOrient({ rotation: turned(rotation), mirror: "none" }),
      );
    }
  });

  it("refuses the 45° turns RNL cannot write", () => {
    for (const rotation of [45, 135, 225, 315] as const)
      for (const mirror of MIRRORS)
        expect(rnlOrient({ rotation, mirror })).toEqual({
          ok: false,
          reason: "not-quarter-turn",
        });
  });

  it("reads every code back as an Analog Canvas orientation drawing the same", () => {
    for (const orient of CODES)
      expect(rnlOrient(acOrientation(orient))).toEqual({ ok: true, orient });
  });

  it("turns by the inner orientation first when composing two", () => {
    for (const outer of CODES)
      for (const inner of CODES)
        expect(
          orientPoint(composeOrient(outer, inner), [2, 1]),
          `${outer} ${inner}`,
        ).toEqual(orientPoint(outer, orientPoint(inner, [2, 1])));
  });
});

describe("placement", () => {
  // An Analog Canvas NMOS: its RNL symbol is registered on the D–S line, one
  // grid step right of Analog Canvas's origin.
  const pins = [
    { x: 10, y: -20 },
    { x: -20, y: 0 },
    { x: 10, y: 20 },
    { x: 20, y: 0 },
  ];
  const offset = [1, 0] as const;
  const position = { x: 130, y: -40 };

  it("puts every pin where Analog Canvas draws it, in all sixteen orientations", () => {
    for (const rotation of QUARTERS)
      for (const mirror of MIRRORS) {
        const orientation = { rotation, mirror };
        const result = rnlOrient(orientation);
        if (!result.ok) throw new Error(`no code for ${rotation} ${mirror}`);
        const place = rnlPlace(position, result.orient, offset);
        for (const pin of pins) {
          const local = toRnlPoint(pin);
          const [dx, dy] = orientPoint(result.orient, [
            local[0] - offset[0],
            local[1] - offset[1],
          ]);
          expect([place[0] + dx, place[1] + dy]).toEqual(
            toRnlPoint(transformPoint(pin, position, orientation)),
          );
        }
      }
  });

  it("finds Analog Canvas's origin again from where RNL places the part", () => {
    for (const orient of CODES)
      expect(
        acPosition(rnlPlace(position, orient, offset), orient, offset),
      ).toEqual(position);
  });

  it("scales ten editor units to one RNL unit and turns y up", () => {
    expect(toRnlPoint({ x: 130, y: -40 })).toEqual([13, 4]);
    expect(toRnlPoint({ x: 12, y: 4 })).toEqual([1.2, -0.4]);
  });
});
