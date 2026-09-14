import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { nativeSourceAcquisitions } from "./simulation-native-source-signals.js";

function input(text: string) {
  const folder = createSimulationFolder({
    id: "f",
    name: "Native",
    profileId: "candidate",
  });
  folder.input.files.find((f) => f.path === folder.input.entry)!.text = text;
  return folder.input;
}

describe("native source acquisition discovery", () => {
  it("uses exact-case native node names and declared modules, not SPICE instance prefixes", () => {
    const source = input(`Title
model supply vsource
model resistor resistor
model coil inductor
feed (Out 0) supply dc=1
Feed (out 0) supply dc=2
VnotVoltage (Out out) resistor r=1k
L (out 0) coil l=1m
`);
    const before = structuredClone(source);
    expect(nativeSourceAcquisitions(source)).toEqual([
      { quantity: "voltage", vector: "Out", save: "v(Out)" },
      { quantity: "voltage", vector: "0", save: "v(0)" },
      { quantity: "voltage", vector: "out", save: "v(out)" },
      { quantity: "current", vector: "feed:flow(br)", save: "i(feed)" },
      { quantity: "current", vector: "Feed:flow(br)", save: "i(Feed)" },
      { quantity: "current", vector: "L:flow(br)", save: "i(L)" },
    ]);
    expect(source).toEqual(before);
  });
  it("does not expose definition-local or conditional instances as top-level nodes", () => {
    const source = input(`Title
model supply vsource
subckt DUT (P)
Vlocal (hidden 0) supply dc=1
ends
@if flag
Vmaybe (conditional 0) supply dc=1
@end
X (public) DUT
control
// fake (wrong 0) supply
print "Vfake (wrong 0) supply"
endc
`);
    expect(nativeSourceAcquisitions(source)).toEqual([
      { quantity: "voltage", vector: "public", save: "v(public)" },
    ]);
  });
  it("follows native includes and quotes unusual identifiers without folding them", () => {
    const source = input('Title\ninclude "tb.inc"\n');
    source.files.push({
      path: "tb.inc",
      text: `model supply vsource
'drive:1' ('Out-1' 0) supply dc=1
`,
    });
    expect(nativeSourceAcquisitions(source)).toContainEqual({
      quantity: "current",
      vector: "drive:1:flow(br)",
      save: "i('drive:1')",
    });
    expect(nativeSourceAcquisitions(source)).toContainEqual({
      quantity: "voltage",
      vector: "Out-1",
      save: "v('Out-1')",
    });
  });
  it("does not invent branch currents for ambiguous or unknown masters or duplicate instances", () => {
    const source = input(`Title
model ambiguous vsource
model ambiguous isource
model supply vsource
V1 (a 0) ambiguous
V2 (b 0) unknown
V3 (c 0) supply
V3 (d 0) supply
`);
    expect(
      nativeSourceAcquisitions(source).filter((s) => s.quantity === "current"),
    ).toEqual([]);
  });
  it("keeps invalid authored identifiers repairable without throwing from Helper", () => {
    expect(
      nativeSourceAcquisitions(
        input(
          "Title\nmodel supply vsource\n'bad name' ('bad node' 0) supply\n",
        ),
      ),
    ).toEqual([]);
  });
});
