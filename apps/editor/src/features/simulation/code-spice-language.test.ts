import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { spiceCodeLanguage, spiceCompletion } from "./code-spice-language";

describe("SPICE editor assistance", () => {
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
