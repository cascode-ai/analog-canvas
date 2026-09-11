import { describe, expect, it } from "vitest";
import {
  applyCodeTextChanges,
  editorOffset,
  editorText,
  sourceOffset,
} from "./code-text-coordinates";

describe("code editor/source UTF-16 boundary", () => {
  it("round-trips token offsets across mixed line endings and surrogate pairs", () => {
    const text = "* 🧪\r\n.param R=1k\n* 笔记\r.control\r\nop\r\n.endc";
    const normalized = editorText(text);
    for (let offset = 0; offset <= normalized.length; offset++)
      expect(editorOffset(text, sourceOffset(text, offset))).toBe(offset);
    for (const token of [".param", "R=", ".control", "op", ".endc"])
      expect(sourceOffset(text, normalized.indexOf(token))).toBe(
        text.indexOf(token),
      );
  });
  it("applies multi-cursor edits to exact original bytes without normalizing existing line endings", () => {
    const text = "* 🧪\r\nR1 a b 1k\nR2 b 0 2k\r\n.end\n",
      normalized = editorText(text);
    const result = applyCodeTextChanges(text, [
      {
        from: normalized.indexOf("1k"),
        to: normalized.indexOf("1k") + 2,
        text: "3k",
      },
      {
        from: normalized.indexOf("2k"),
        to: normalized.indexOf("2k") + 2,
        text: "4k",
      },
      {
        from: normalized.indexOf(".end"),
        to: normalized.indexOf(".end"),
        text: ".control\nop\n.endc\n",
      },
    ]);
    expect(result).toBe(
      "* 🧪\r\nR1 a b 3k\nR2 b 0 4k\r\n.control\r\nop\r\n.endc\r\n.end\n",
    );
  });
});
