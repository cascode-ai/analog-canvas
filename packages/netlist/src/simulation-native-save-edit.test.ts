import { describe, expect, it } from "vitest";
import { nativeAcquisitionEdit } from "./simulation-native-save-edit.js";

describe("shared native save authoring", () => {
  it("keeps exact-case selectors and deduplicates quoted/space variants, before the trailing comment", () => {
    const text = "save v(Out) p('X:M',id) // keep comment";
    const edit = nativeAcquisitionEdit(
      text,
      text.length,
      ["v('Out')", "v(out)", "p('X:M', id)", "i('V1')"],
      false,
    );
    expect(edit.ok).toBe(true);
    expect(edit.text).toBe(
      "save v(Out) p('X:M',id) v(out) i('V1') // keep comment",
    );
    expect(
      nativeAcquisitionEdit(edit.text, edit.anchor, ["v(out)", "i(V1)"], false)
        .changes,
    ).toEqual([]);
  });
  it("does not reinterpret quoted control/node names or embedded comments as structural blocks", () => {
    const text =
      "Title\n// control\nmodel 'control' vsource\nV ('endc' 0) 'control' dc=1\ncontrol // actual\nanalysis op op\nendc\n";
    const edit = nativeAcquisitionEdit(text, 0, ["v('endc')"], true);
    expect(edit.ok).toBe(true);
    expect(edit.text).toBe(
      text.replace(
        "control // actual\n",
        "control // actual\nsave v('endc')\n",
      ),
    );
  });
  it("extends multiline selectors without splitting parentheses or deleting comments", () => {
    const text =
      "control\nsave p('X:M',\n id) // trailing\nanalysis op op\nendc";
    const edit = nativeAcquisitionEdit(
      text,
      text.indexOf("id)"),
      ["p('X:M', id)", "v(Out)"],
      false,
    );
    expect(edit.text).toContain("id) v(Out) // trailing");
    expect(edit.changes).toHaveLength(1);
  });
  it("inserts in the selected block and after its clear, not into the previous analysis scope", () => {
    const text =
      "Title\ncontrol\nsave v(Out)\nanalysis first op\nendc\ncontrol\nsave v(Out)\nclear saves\nanalysis second op\nendc\n";
    const edit = nativeAcquisitionEdit(
      text,
      text.indexOf("analysis second"),
      ["v(Out)"],
      true,
    );
    expect(edit.text).toBe(
      text.replace("clear saves\n", "clear saves\nsave v(Out)\n"),
    );
  });
  it("appends a control block after an existing circuit without altering the title or CRLF", () => {
    const text = "My title\r\nmodel source vsource\r\nV1 (a 0) source dc=1";
    const edit = nativeAcquisitionEdit(text, 0, ["v(a)"], true);
    expect(edit.text).toBe(text + "\r\ncontrol\r\nsave v(a)\r\nendc\r\n");
    expect(nativeAcquisitionEdit("Only a title", 0, ["full"], true).text).toBe(
      "Only a title\ncontrol\nsave full\nendc\n",
    );
  });
  it.each([
    "v(Out)\nendc",
    "v(Out); endc",
    "v(Out) // hide following selector",
    "v(",
    "@m[id]",
    "Out",
  ])("rejects an invalid selector without mutating source: %s", (selector) => {
    const text = "Title\ncontrol\nanalysis op op\nendc\n";
    expect(nativeAcquisitionEdit(text, 0, [selector], true)).toMatchObject({
      ok: false,
      text,
      changes: [],
      error: { code: "SIMULATION_SAVE_EDIT_INVALID" },
    });
    expect(nativeAcquisitionEdit(text, 0, ["v(Out)"], true).ok).toBe(true);
  });
  it("keeps incomplete, legacy and context-free fragments editable instead of guessing an insertion", () => {
    for (const [text, entry] of [
      ["Title\ncontrol\nsave p('X:M',", true],
      ["Title\n.control\nop\n.endc", true],
      ["R (p n) resistor", false],
    ] as const) {
      expect(nativeAcquisitionEdit(text, 0, ["v(Out)"], entry)).toMatchObject({
        ok: false,
        text,
        changes: [],
      });
    }
    expect(
      nativeAcquisitionEdit("Title", 0, [], true, [".probe i(r1,2)"]).ok,
    ).toBe(false);
    expect(nativeAcquisitionEdit("Title", 0, [], true).changes).toEqual([]);
  });
});
