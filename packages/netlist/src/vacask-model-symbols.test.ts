import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { inspectNativeModelLibrarySymbols } from "./vacask-model-symbols.js";

describe("native dependency symbol inspection", () => {
  it("proves conditional output identity without evaluating a branch or accepting unknown alternatives", () => {
    const input = createSimulationFolder({
      id: "inspect",
      name: "Branches",
      profileId: "p",
    }).input;
    const inspect = (body: string) => {
      input.files = [
        {
          path: input.entry,
          text: `Library symbols
model fast sp_bsim4v8
model slow sp_bsim4v8
model different resistor
subckt Device (D G S B)
${body}
ends
`,
        },
      ];
      return inspectNativeModelLibrarySymbols(input, ["Device"]).masters[0]!
        .primitives;
    };
    const bins = `@if l<1u
Core (D G S B) fast
@elseif l<2u
Core (D G S B) slow
@else
Guard (D G S B) undefined_error_model
@end`;
    expect(inspect(bins)).toEqual([{ path: ["Core"], module: "sp_bsim4v8" }]);
    // The former guard reused Core: that truly is not a known output family.
    expect(inspect(bins.replace("Guard (", "Core ("))).toEqual([]);
    expect(inspect(bins.replace("slow\n", "different\n"))).toEqual([]);
    expect(inspect(bins.replace("slow\n", "unknown\n"))).toEqual([]);
    expect(inspect("Core (D G S B) fast\n" + bins)).toEqual([]);
    expect(inspect("Core (D G S B) fast\nCore (D G S B) slow")).toEqual([]);
  });
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
      {
        name: "Conditional",
        primitives: [{ path: ["Inner"], module: "sp_bsim4v8" }],
      },
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
