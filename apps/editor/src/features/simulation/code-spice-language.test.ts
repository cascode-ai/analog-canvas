import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { spiceCodeLanguage, spiceCompletion } from "./code-spice-language";
import { parameterGuide } from "./code-parameter-guide";

describe("SPICE editor assistance", () => {
  it("suggests real source names and vectors without leaking local subcircuit nodes", () => {
    const text = "* test\n.control\ndc ";
    const state = EditorState.create({
      doc: text,
      selection: { anchor: text.length },
    });
    const sources = [
      "VBIAS in 0 1\n.subckt hidden a b\nVLOCAL secret 0 2\n.ends\nR1 out 0 1k",
    ];
    expect(
      spiceCompletion(
        new CompletionContext(state, text.length, true),
        sources,
      )?.options.map((o) => o.label),
    ).toEqual(["VBIAS"]);
  });
  it("guides AC parameters without inserting ghost text, including returning to earlier arguments", () => {
    const doc = "* test\n.control\nac dec 20 ";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
    });
    const guide = parameterGuide(state)!;
    expect(state.doc.toString()).toBe(doc);
    expect(guide.index).toBe(2);
    expect(guide.parameters[1]!.label).toBe("points / decade");
    expect(guide.parameters[guide.index]!.label).toBe("startHz");
    const earlier = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf("dec") + 1 },
    });
    expect(parameterGuide(earlier)?.index).toBe(0);
    expect(
      spiceCompletion(
        new CompletionContext(earlier, earlier.selection.main.head, true),
      )?.options.map((o) => o.label),
    ).toEqual(["dec", "oct", "lin"]);
  });
  it("guides source waveforms and preserves grouped arguments", () => {
    const doc = "* test\nV1 in 0 PULSE(0 1 )";
    const guide = parameterGuide(
      EditorState.create({ doc, selection: { anchor: doc.length - 1 } }),
    )!;
    expect(guide.help.name).toBe("PULSE");
    expect(guide.index).toBe(2);
    expect(guide.parameters[2]!.label).toBe("delay / s");
    const noise = "* test\n.control\nnoise v(out, ref) VIN ";
    expect(
      parameterGuide(
        EditorState.create({ doc: noise, selection: { anchor: noise.length } }),
      )?.index,
    ).toBe(2);
  });
  function complete(text: string) {
    const state = EditorState.create({
      doc: text,
      extensions: [spiceCodeLanguage],
    });
    return spiceCompletion(
      new CompletionContext(state, state.doc.length, true),
    );
  }
  it("uses shared ngspice help with deck/control context and leaves comments alone", () => {
    const deck = complete("* native\n.tr");
    expect(deck?.options.some((o) => o.label === ".tran")).toBe(true);
    expect(deck?.options.some((o) => o.label === "tran")).toBe(false);
    const control = complete("* native\n.control\ntr");
    expect(control?.options.find((o) => o.label === "tran")?.detail).toContain(
      "tstep tstop",
    );
    expect(control?.options.some((o) => o.label === ".tran")).toBe(false);
    expect(complete("* .control is a comment")).toBeNull();
    expect(
      complete("* native\n.control\nop\n.endc\n.tr")?.options.some(
        (o) => o.label === ".tran",
      ),
    ).toBe(true);
  });
});
