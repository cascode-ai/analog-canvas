import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { nativeCodeLanguage, nativeCompletion } from "./code-native-language";
import { parameterGuide, nativeCompanions } from "./code-parameter-guide";

function state(doc: string, anchor = doc.length, related: string[] = []) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [nativeCodeLanguage, nativeCompanions.of(related)],
  });
}
function complete(
  doc: string,
  related: string[] = [],
  mapped: Record<string, string> = {},
) {
  const s = state(doc, doc.length, related);
  return nativeCompletion(
    new CompletionContext(s, doc.length, true),
    related,
    () => mapped,
  );
}
describe("native VACASK editor assistance", () => {
  it.each(['type="dc" dc=1.8', 'type="sine" sinedc=0 ampl=1 freq=1k'])(
    "guides source AC alongside %s",
    (body) => {
      const doc = "Title\nmodel vs vsource\nV1 (in 0) vs " + body + " mag=";
      const guide = parameterGuide(state(doc))!;
      expect(guide.parameters[guide.index]?.label).toBe("mag=AC magnitude");
      expect(
        guide.parameters.slice(guide.tokens.length).map((p) => p.key),
      ).toContain("phase");
    },
  );
  it("suggests source type/waveform fields without writing defaults or requiring SPICE name prefixes", () => {
    const doc = "Title\nmodel bias vsource\nstimulus (in 0) bias dc=1.8 ";
    const guide = parameterGuide(state(doc))!;
    expect(
      guide.parameters.slice(guide.tokens.length).map((p) => p.key),
    ).toContain("mag");
    expect(complete(doc + "type=")?.options.map((o) => o.label)).toEqual([
      '"dc"',
      '"pulse"',
      '"sine"',
      '"pwl"',
    ]);
    const pulse = doc + 'type="pulse" val0=0 val1=1 delay=';
    expect(
      parameterGuide(state(pulse))?.parameters.find((p) => p.key === "delay")
        ?.label,
    ).toBe("delay=seconds");
    expect(state(doc).doc.toString()).toBe(doc);
  });
  it("preserves exact-case mapped symbols and deduplicates equivalent quoted selectors", () => {
    const options = complete(
      "Title\ncontrol\nsave ",
      ["model vs vsource\nV1 (Out 0) vs dc=1\nR1 (out 0) resist r=1k"],
      { "v('Out')": "Upper output" },
    )!.options;
    expect(options.filter((o) => o.label === "v(Out)")).toHaveLength(0);
    expect(options.find((o) => o.label === "v('Out')")?.detail).toBe(
      "Upper output",
    );
    expect(options.some((o) => o.label === "v(out)")).toBe(true);
    expect(options.some((o) => o.label === "dv(out)")).toBe(true);
    expect(options.some((o) => o.label === "i(V1)")).toBe(true);
    expect(options.some((o) => o.label === "i(R1)")).toBe(false);
  });
  it("uses declared source models and hides uninstantiated subcircuit/conditional nodes", () => {
    const related = [
      "model bias vsource\nVBIAS (vdd 0) bias dc=1\nsubckt local (p n)\nVLOCAL (secret 0) bias dc=2\nends\n@if unknown\nVX (conditional 0) bias\n@end\nR1 (out 0) resistor r=1k",
    ];
    expect(
      complete("Title\ncontrol\nsweep bias instance=", related)?.options.map(
        (o) => o.label,
      ),
    ).toEqual(['"VBIAS"', '"R1"']);
    expect(
      complete("Title\ncontrol\nsweep bias instance= ", related)?.options.map(
        (o) => o.label,
      ),
    ).toEqual(['"VBIAS"', '"R1"']);
    const options = complete("Title\ncontrol\nsave ", related)!.options.map(
      (o) => o.label,
    );
    expect(options.join(" ")).not.toMatch(/secret|conditional|VLOCAL/);
  });
  it("guides named AC keyword arguments, their units and earlier values", () => {
    const doc = "Title\ncontrol\nanalysis response ac from=10 to=1M mode=";
    expect(complete(doc)?.options.map((o) => o.label)).toEqual([
      '"dec"',
      '"oct"',
      '"lin"',
    ]);
    const guide = parameterGuide(state(doc))!;
    expect(guide.parameters[guide.index]?.key).toBe("mode");
    expect(guide.parameters.find((p) => p.key === "points")?.label).toContain(
      "intervals",
    );
    const earlier = parameterGuide(state(doc, doc.indexOf("from=") + 6))!;
    expect(earlier.parameters[earlier.index]?.label).toBe("from=start Hz");
  });
  it("keeps balanced assignments, vectors and quoted names in one argument", () => {
    const doc = "Title\nparameters Width = (W * 2) nf=3 ";
    const guide = parameterGuide(state(doc))!;
    expect(guide.tokens.map((t) => t.value)).toEqual([
      "Width = (W * 2)",
      "nf=3",
    ]);
    expect(guide.parameters[guide.index]?.label).toBe("name=expression");
    const noise =
      'Title\ncontrol\nanalysis noise1 noise out=["Out", "ref"] in=';
    const ng = parameterGuide(state(noise))!;
    expect(ng.parameters[ng.index]?.key).toBe("in");
    expect(ng.tokens[2]?.value).toBe('out=["Out", "ref"]');
  });
  it("uses native context, ignores titles/comments and removes old executable syntax from menus", () => {
    expect(complete("control")).toBeNull();
    expect(
      complete("Title\n// control\npar")?.options.some(
        (o) => o.label === "parameters",
      ),
    ).toBe(true);
    expect(
      complete("Title\ncontrol\nan")?.options.some(
        (o) => o.label === "analysis ac",
      ),
    ).toBe(true);
    expect(
      complete("Title\ncontrol\n/* endc */\nan")?.options.some(
        (o) => o.label === "analysis tran",
      ),
    ).toBe(true);
    expect(complete("Title\n/* control\n still comment")).toBeNull();
    expect(complete("Title\ncontrol\n// save")).toBeNull();
    expect(
      complete("Title\ncontrol\nendc\npar")?.options.some(
        (o) => o.label === "parameters",
      ),
    ).toBe(true);
    const options = [
      ...complete("Title\npar")!.options,
      ...complete("Title\ncontrol\nan")!.options,
    ];
    expect(
      options.some((o) =>
        [".param", ".tran", "tran", "write", "alterparam", "reset"].includes(
          o.label,
        ),
      ),
    ).toBe(false);
  });
});
