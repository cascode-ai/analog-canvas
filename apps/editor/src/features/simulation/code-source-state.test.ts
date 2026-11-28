import { EditorState, Transaction } from "@codemirror/state";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { editorText, editorOffset } from "./code-text-coordinates";
import {
  exactSourceField,
  exactSourceHistory,
  restoreExactSource,
} from "./code-source-state";

describe("exact-source code history", () => {
  it("restores the declaration caret and exact bytes when redoing a helper insertion", () => {
    const text = "Title\r\n.control\n.endc\r\n.end\n";
    let state = EditorState.create({
      doc: editorText(text),
      extensions: [
        history(),
        exactSourceField.init(() => text),
        exactSourceHistory,
      ],
    });
    const from = text.indexOf("\n") + 1;
    const insert = ".param variable=1\n";
    const nextText = text.slice(0, from) + insert + text.slice(from);
    const anchor = from + insert.length - 1;
    state = state.update({
      changes: { from: editorOffset(text, from), insert },
      selection: { anchor: editorOffset(nextText, anchor) },
      effects: restoreExactSource.of(nextText),
      userEvent: "input.complete",
    }).state;
    expect(state.selection.main.head).toBe(editorOffset(nextText, anchor));
    state = state.update({
      selection: state.selection,
      userEvent: "select",
    }).state;
    expect(undoDepth(state)).toBe(1);
    expect(
      undo({
        state,
        dispatch: (t) => {
          state = t.state;
        },
      }),
    ).toBe(true);
    expect(state.field(exactSourceField)).toBe(text);
    expect(
      redo({
        state,
        dispatch: (t) => {
          state = t.state;
        },
      }),
    ).toBe(true);
    expect(state.field(exactSourceField)).toBe(nextText);
    expect(state.selection.main.head).toBe(editorOffset(nextText, anchor));
  });
  it("undoes and redoes grouped edits without converting original mixed newlines", () => {
    const text = "* 🧪\r\nR1 a b 1k\nR2 b 0 2k\r\n.end\n";
    let state = EditorState.create({
      doc: editorText(text),
      extensions: [
        history(),
        exactSourceField.init(() => text),
        exactSourceHistory,
      ],
    });
    const start = state.doc.toString().indexOf("R1");
    state = state.update({
      changes: {
        from: start,
        to: state.doc.toString().indexOf(".end"),
        insert: "R3 a 0 3k\n",
      },
      annotations: [
        Transaction.userEvent.of("input.type"),
        Transaction.time.of(1),
      ],
    }).state;
    state = state.update({
      changes: { from: start + 2, insert: "a" },
      annotations: [
        Transaction.userEvent.of("input.type"),
        Transaction.time.of(2),
      ],
    }).state;
    const edited = state.field(exactSourceField);
    const count = undoDepth(state);
    for (let i = 0; i < count; i++)
      expect(
        undo({
          state,
          dispatch: (t) => {
            state = t.state;
          },
        }),
      ).toBe(true);
    expect(state.field(exactSourceField)).toBe(text);
    expect(state.doc.toString()).toBe(editorText(text));
    for (let i = 0; i < count; i++)
      expect(
        redo({
          state,
          dispatch: (t) => {
            state = t.state;
          },
        }),
      ).toBe(true);
    expect(state.field(exactSourceField)).toBe(edited);
  });
});
