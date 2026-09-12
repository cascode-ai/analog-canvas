import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { nativeSaveEdit, nativeAcquisitionEdit } from "./native-save-edit";
import { parameterGuide } from "./code-parameter-guide";
import { editorText } from "./code-text-coordinates";
import { exactSourceField } from "./code-source-state";

describe("native save authoring", () => {
  it("preserves untouched mixed newlines when composing probe and save insertions", () => {
    const text = "* title\r\nR1 a 0 1k\n.control\r\nop\n.endc\r\n.end\n";
    const state = EditorState.create({
      doc: editorText(text),
      extensions: [exactSourceField.init(() => text)],
    });
    const edit = nativeAcquisitionEdit(
      state.doc.toString(),
      0,
      ["v(a)"],
      true,
      [".probe i(r1,1)"],
    );
    const next = state.update(
      ...edit.changes.map((changes) => ({ changes, sequential: true })),
    ).state;
    expect(next.field(exactSourceField)).toBe(
      text
        .replace("R1 a", ".probe i(r1,1)\r\nR1 a")
        .replace(".control\r\n", ".control\r\nsave v(a)\r\n"),
    );
    expect(
      nativeAcquisitionEdit(edit.text, edit.anchor, ["v(a)"], true, [
        ".probe i(r1,1)",
      ]).changes,
    ).toEqual([]);
  });
  it("keeps a title-only entry before native probe cards", () => {
    expect(
      nativeAcquisitionEdit("My deck", 7, [], true, [".probe i(r1,1)"]).text,
    ).toBe("My deck\n.probe i(r1,1)\n");
  });
  it("places native terminal probes outside control and never creates an empty save", () => {
    const text = "* title\n.control\nop\nwrite out.raw\n.endc\n.end\n";
    const first = nativeAcquisitionEdit(text, text.length, [], true, [
      ".probe i(r1,2)",
    ]);
    expect(first.text).toBe(
      text.replace(".control", ".probe i(r1,2)\n.control"),
    );
    expect(
      nativeAcquisitionEdit(first.text, first.anchor, [], true, [
        ".probe i(r1,2)",
      ]).text,
    ).toBe(first.text);
    expect(first.text).not.toContain("save ");
  });
  it("inserts before control analyses rather than after their write", () => {
    const text = "* title\n.control\nop\nwrite out.raw\n.endc\n.end\n";
    const edit = nativeSaveEdit(text, text.length, ["v(out)"], true);
    expect(
      text.slice(0, edit.from) + edit.insert + text.slice(edit.from),
    ).toContain(".control\nsave v(out)\nop");
  });
  it("extends save under the cursor without duplicating a vector", () => {
    const text = "save v(out)";
    expect(
      nativeSaveEdit(text, text.length, ["v(out)", "i(vdd)"], false),
    ).toEqual({ from: text.length, insert: " i(vdd)" });
  });
  it("preserves the deck title and CRLF", () => {
    const text = "My deck\r\nR1 a 0 1k\r\n.end\r\n";
    expect(nativeSaveEdit(text, 0, ["v(a)"], true)).toEqual({
      from: 9,
      insert: ".save v(a)\r\n",
    });
  });
  it("continues vector help beyond the first argument", () => {
    const doc = ".control\nsave v(a) v(b) ";
    const guide = parameterGuide(
      EditorState.create({ doc, selection: { anchor: doc.length } }),
    );
    expect(guide?.parameters[guide.index]?.label).toBe("vector");
  });
});
