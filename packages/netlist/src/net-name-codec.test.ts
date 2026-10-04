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
    expect(encodeNetName("bias p", "local", "spice")).toMatchObject({
      ok: false,
      code: "UNREPRESENTABLE_NGSPICE_NET_NAME",
    });
  });

  it("writes an ngspice bus bit with underscores, which its control language reads", () => {
    expect(encodeNetName("DATA<3>", "local", "spice")).toEqual({
      ok: true,
      token: "DATA_3_",
      collisionKey: "data_3_",
    });
    expect(encodeNetName("BFT_h<7>", "local", "spice")).toMatchObject({
      token: "BFT_h_7_",
    });
    expect(encodeNetName("D[0]", "local", "spice")).toMatchObject({
      token: "D_0_",
    });
  });

  it("reads full-width characters as the ASCII they stand for", () => {
    expect(encodeNetName("BFT<3：0>", "local", "spice")).toMatchObject({
      ok: true,
      token: "BFT_3:0_",
    });
    expect(encodeNetName("ＶＩＮ（１）", "local", "spectre")).toMatchObject({
      ok: false,
      code: "UNREPRESENTABLE_SPECTRE_NET_NAME",
      message: expect.stringContaining("VIN(1)"),
    });
    expect(encodeNetName("ＢＩＴ＜３＞", "local", "spectre")).toMatchObject({
      ok: true,
      token: "BIT\\<3\\>",
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

  it("writes a Greek letter as its standard name in either dialect", () => {
    expect(encodeNetName("φ1", "local", "spice")).toEqual({
      ok: true,
      token: "phi1",
      collisionKey: "phi1",
    });
    expect(encodeNetName("VΦ", "global", "spectre")).toEqual({
      ok: true,
      token: "VPHI",
      collisionKey: "VPHI",
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
