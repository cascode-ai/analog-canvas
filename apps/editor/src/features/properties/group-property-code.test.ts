import { describe, expect, it } from "vitest";

import {
  formatGroupPropertyCode,
  groupPropertyCodeChanges,
  parseGroupPropertyCode,
  type GroupPropertyCodeContext,
} from "./group-property-code";

const context: GroupPropertyCodeContext = {
  reference: "mixed",
  value: false,
  foreground: "mixed",
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
    expect(JSON.parse(source)).toEqual({
      display: { reference: "mixed", value: false },
      appearance: { foreground: "mixed" },
    });
    expect(parseGroupPropertyCode(source, context).ok).toBe(true);
  });

  it("supports inline display and RGB edits without changing another field", () => {
    const source = formatGroupPropertyCode(context);
    const changed = apply(
      source,
      groupPropertyCodeChanges(source, context, {
        "display.reference": true,
        "appearance.foreground": [220, 38, 38],
      }),
    );
    expect(JSON.parse(changed)).toEqual({
      display: { reference: true, value: false },
      appearance: { foreground: [220, 38, 38] },
    });
    expect(parseGroupPropertyCode(changed, context)).toEqual({
      ok: true,
      value: {
        display: { reference: true, value: false },
        appearance: { foreground: "#dc2626" },
      },
    });
  });

  it("omits an unavailable value field and rejects unsupported properties", () => {
    const withoutValue = { ...context, value: null };
    const source = formatGroupPropertyCode(withoutValue);
    expect(JSON.parse(source).display).toEqual({ reference: "mixed" });
    expect(
      parseGroupPropertyCode(
        source.replace(
          '"reference": "mixed"',
          '"reference": "mixed", "value": true',
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
