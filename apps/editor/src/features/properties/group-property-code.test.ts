import { describe, expect, it } from "vitest";

import {
  formatGroupPropertyCode,
  groupPropertyCodeChanges,
  parseGroupPropertyCode,
  type GroupPropertyCodeContext,
} from "./group-property-code";

const context: GroupPropertyCodeContext = {
  symbol: "resistor",
  parameters: { value: "" },
  reference: "",
  value: false,
  foreground: "",
};

function apply(
  source: string,
  changes: ReturnType<typeof groupPropertyCodeChanges>,
) {
  return [...changes]
    .reverse()
    .reduce(
      (text, change) =>
        text.slice(0, change.from) + change.insert + text.slice(change.to),
      source,
    );
}

describe("batch component property code", () => {
  it("represents differing selection values explicitly", () => {
    const source = formatGroupPropertyCode(context);
    expect(Object.keys(JSON.parse(source))).toEqual([
      "appearance",
      "display",
      "parameters",
      "symbol",
    ]);
    expect(JSON.parse(source)).toEqual({
      symbol: "resistor",
      parameters: { value: "" },
      display: { visualAnnotation: "", value: false },
      appearance: { foreground: "" },
    });
    expect(parseGroupPropertyCode(source, context).ok).toBe(true);
  });

  it("supports inline display and RGB edits without changing another field", () => {
    const source = formatGroupPropertyCode(context);
    const changed = apply(
      source,
      groupPropertyCodeChanges(source, context, {
        "display.visualAnnotation": true,
        "appearance.foreground": [220, 38, 38],
      }),
    );
    expect(JSON.parse(changed)).toEqual({
      symbol: "resistor",
      parameters: { value: "" },
      display: { visualAnnotation: true, value: false },
      appearance: { foreground: [220, 38, 38] },
    });
    expect(parseGroupPropertyCode(changed, context)).toEqual({
      ok: true,
      value: {
        symbol: "resistor",
        parameters: { value: "" },
        display: { visualAnnotation: true, value: false },
        appearance: { foreground: "#dc2626" },
      },
    });
  });

  it("omits an unavailable value field and rejects unsupported properties", () => {
    const withoutValue = { ...context, value: null };
    const source = formatGroupPropertyCode(withoutValue);
    expect(JSON.parse(source).display).toEqual({
      visualAnnotation: "",
    });
    expect(
      parseGroupPropertyCode(
        source.replace(
          '"visualAnnotation": ""',
          '"visualAnnotation": "", "value": true',
        ),
        withoutValue,
      ),
    ).toMatchObject({ ok: false });
    expect(
      groupPropertyCodeChanges(source, withoutValue, {
        "display.value": true,
      }),
    ).toEqual([]);
  });
});
