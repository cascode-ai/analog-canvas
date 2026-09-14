import { describe, expect, it } from "vitest";
import { nativeParameterDeclarationEdit } from "./simulation-native-parameter-edit.js";
import { inspectVacaskSource } from "./vacask-source.js";

describe("native parameter declaration edit", () => {
  it.each([
    ["", true, "Simulation\nparameters \n"],
    ["Title", true, "Title\nparameters \n"],
    ["Title\r\ncontrol\nendc", true, "Title\r\nparameters \r\ncontrol\nendc"],
    ["", false, "parameters \n"],
    ["// library\n", false, "parameters \n// library\n"],
  ] as const)("preserves existing bytes and title: %j", (text, entry, next) => {
    const edit = nativeParameterDeclarationEdit(text, entry);
    expect(edit.text).toBe(next);
    const change = edit.changes[0]!;
    expect(
      text.slice(0, change.from) + change.insert + text.slice(change.to),
    ).toBe(next);
    expect(next.slice(edit.anchor - 11, edit.anchor)).toBe("parameters ");
    expect(
      next.slice(0, change.from) +
        next.slice(change.from + change.insert.length),
    ).toBe(text);
  });
  it("precedes includes, conditional/local scope and control without inspecting a broken draft", () => {
    const text =
      'Title\n/* control\nendc */\ninclude "local.sim"\n@if flag\nsubckt Cell (p n)\nparameters Width=1\n';
    const edit = nativeParameterDeclarationEdit(text, true);
    const next =
      edit.text.slice(0, edit.anchor) +
      "BIAS=1M" +
      edit.text.slice(edit.anchor);
    const parsed = inspectVacaskSource("run.sim", next, true);
    expect(parsed.statements[0]?.rawText).toBe("parameters BIAS=1M");
    expect(parsed.statements[1]?.rawText).toBe('include "local.sim"');
    expect(next.endsWith(text.slice(text.indexOf("\n") + 1))).toBe(true);
  });
});
