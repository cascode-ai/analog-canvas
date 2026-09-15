import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { inspectNativeModelLibrarySymbols } from "./vacask-model-symbols.js";

describe("native dependency symbol inspection", () => {
  it("uses selected sections and local model shadows without evaluating geometry", () => {
    const input = createSimulationFolder({
      id: "inspect",
      name: "Library",
      profileId: "p",
    }).input;
    input.files = [
      {
        path: input.entry,
        text: 'Library inspection\ninclude "library.inc" section=tt\n',
      },
      {
        path: "library.inc",
        text: `section ff
model core resistor
endsection
section tt
model core sp_bsim4v8
subckt Wrapper (D G S B)
model core resistor
Inner (D G S B) core
ends
subckt Conditional (D G S B)
@if enabled
Inner (D G S B) core
@end
ends
endsection
`,
      },
    ];
    const result = inspectNativeModelLibrarySymbols(input, [
      "core",
      "Wrapper",
      "Conditional",
      "Missing",
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.masters).toEqual([
      { name: "core", primitives: [{ path: [], module: "sp_bsim4v8" }] },
      {
        name: "Wrapper",
        primitives: [{ path: ["Inner"], module: "resistor" }],
      },
      { name: "Conditional", primitives: [] },
    ]);
    input.files[0]!.text = input.files[0]!.text.replace(
      "section=tt",
      "section=ff",
    );
    expect(inspectNativeModelLibrarySymbols(input, ["core"]).masters).toEqual([
      { name: "core", primitives: [{ path: [], module: "resistor" }] },
    ]);
    input.files[0]!.text = input.files[0]!.text.replace(
      "section=ff",
      "section=missing",
    );
    expect(inspectNativeModelLibrarySymbols(input, ["core"]).masters).toEqual(
      [],
    );
  });
});
