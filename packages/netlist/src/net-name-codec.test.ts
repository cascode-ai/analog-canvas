import { describe, expect, it } from "vitest";

import { encodeNetName } from "./net-name-codec.js";

describe("Net name codecs", () => {
  it("uses ngspice case-insensitive identity and native global declarations", () => {
    expect(encodeNetName("VDD!", "global", "spice")).toEqual({
      ok: true,
      token: "VDD!",
      collisionKey: "vdd!",
    });
    expect(encodeNetName("bias.p", "local", "spice")).toEqual({
      ok: true,
      token: "bias.p",
      collisionKey: "bias.p",
    });
    expect(encodeNetName("DATA<3>", "local", "spice")).toMatchObject({
      ok: false,
      code: "UNREPRESENTABLE_NGSPICE_NET_NAME",
    });
  });

  it("escapes supported Spectre punctuation without changing semantic identity", () => {
    expect(encodeNetName("DATA<3>", "local", "spectre")).toEqual({
      ok: true,
      token: "DATA\\<3\\>",
      collisionKey: "DATA\\<3\\>",
    });
    expect(encodeNetName("net/1", "local", "spectre")).toEqual({
      ok: true,
      token: "net\\/1",
      collisionKey: "net\\/1",
    });
    expect(encodeNetName("VDD!", "global", "spectre")).toEqual({
      ok: true,
      token: "VDD!",
      collisionKey: "VDD!",
    });
  });

  it("adds Cadence bang spelling only for typed non-ground globals", () => {
    expect(
      encodeNetName("VDD", "global", "spectre", "cadence-bang"),
    ).toMatchObject({ ok: true, token: "VDD!" });
    expect(
      encodeNetName("VDD", "local", "spectre", "cadence-bang"),
    ).toMatchObject({ ok: true, token: "VDD" });
    expect(
      encodeNetName("0", "global", "spectre", "cadence-bang"),
    ).toMatchObject({ ok: true, token: "0" });
  });
});
