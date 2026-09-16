import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { nativeAcquisitionEdit } from "@icm/netlist";
import { editorText } from "./code-text-coordinates";
import { exactSourceField } from "./code-source-state";

describe("native save editor integration", () => {
  it("uses the shared edit API and preserves mixed newlines through undo/redo", () => {
    const text =
      "Title\r\nmodel source vsource\nV1 (a 0) source dc=1\r\ncontrol\r\nanalysis op op\nendc\r\n";
    let state = EditorState.create({
      doc: editorText(text),
      extensions: [history(), exactSourceField.init(() => text)],
    });
    const edit = nativeAcquisitionEdit(
      state.doc.toString(),
      0,
      ["v(a)", "i(V1)"],
      true,
    );
    expect(edit.ok).toBe(true);
    state = state.update(
      ...edit.changes.map((changes) => ({ changes, sequential: true })),
    ).state;
    const changed = text.replace(
      "control\r\n",
      "control\r\nsave v(a) i(V1)\r\n",
    );
    expect(state.field(exactSourceField)).toBe(changed);
    expect(
      nativeAcquisitionEdit(edit.text, edit.anchor, ["v(a)", "i(V1)"], true)
        .changes,
    ).toEqual([]);
    expect(
      undo({
        state,
        dispatch: (transaction) => {
          state = transaction.state;
        },
      }),
    ).toBe(true);
    expect(state.field(exactSourceField)).toBe(text);
    expect(
      redo({
        state,
        dispatch: (transaction) => {
          state = transaction.state;
        },
      }),
    ).toBe(true);
    expect(state.field(exactSourceField)).toBe(changed);
  });
});
