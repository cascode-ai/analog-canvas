import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";

import {
  formatGroupPropertyCode,
  groupPropertyCodeChanges,
  groupPropertyCodeSpans,
  groupPropertyItemNames,
  parseGroupPropertyCode,
  type GroupPropertyCodeContext,
} from "./group-property-code";
import {
  groupVisibilityTargets,
  planGroupPropertyCodeEdits,
} from "./group-property-code-edits";

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
      appearance: { color: "" },
    });
    expect(parseGroupPropertyCode(source, context).ok).toBe(true);
  });

  it("supports inline display and RGB edits without changing another field", () => {
    const source = formatGroupPropertyCode(context);
    const changed = apply(
      source,
      groupPropertyCodeChanges(source, context, {
        "display.visualAnnotation": true,
        "appearance.color": [220, 38, 38],
      }),
    );
    expect(JSON.parse(changed)).toEqual({
      symbol: "resistor",
      parameters: { value: "" },
      display: { visualAnnotation: true, value: false },
      appearance: { color: [220, 38, 38] },
    });
    expect(parseGroupPropertyCode(changed, context)).toEqual({
      ok: true,
      value: {
        symbol: "resistor",
        parameters: { value: "" },
        display: { visualAnnotation: true, value: false },
        appearance: { color: "#dc2626" },
      },
    });
  });

  it("lists each component's own value where they differ, keyed by Reference", () => {
    const items = [
      {
        key: "R1",
        instanceId: "r-1",
        name: "R1",
        parameters: { value: "1k" },
        reference: true,
        value: false,
        foreground: "auto" as const,
      },
      {
        key: "R2",
        instanceId: "r-2",
        name: "R2",
        parameters: { value: "2k" },
        reference: false,
        value: false,
        foreground: "#dc2626" as const,
      },
    ];
    const listed = {
      ...context,
      parameterFields: [
        { key: "value", label: "Value", placeholder: "", help: "" },
      ],
      items,
    };
    const source = formatGroupPropertyCode(listed);
    expect(JSON.parse(source)).toEqual({
      symbol: "resistor",
      // They show different names; one name written here names them all.
      names: "as is",
      parameters: { value: { R1: "1k", R2: "2k" } },
      // The same for both: one value, as before.
      display: { visualAnnotation: { R1: true, R2: false }, value: false },
      appearance: { color: { R1: "auto", R2: [220, 38, 38] } },
    });
    expect(groupPropertyItemNames(listed)).toBe("as is");
    // One entry per component, with its own control.
    expect(
      groupPropertyCodeSpans(source, listed).map((span) => span.field.path),
    ).toEqual(
      expect.arrayContaining([
        "display.visualAnnotation.R1",
        "display.visualAnnotation.R2",
        "appearance.color.R2",
        "parameters.value.R1",
      ]),
    );
    const edited = source.replace('"R2": "2k"', '"R2": "4.7k"');
    const parsed = parseGroupPropertyCode(edited, listed);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        parameters: { value: { R1: "1k", R2: "4.7k" } },
        appearance: { color: { R1: "auto", R2: "#dc2626" } },
      },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const instances = items.map(
      (item) =>
        ({
          id: item.instanceId,
          reference: item.key,
          symbolId: "resistor",
          placement: null,
          netlist: {
            binding: { kind: "primitive", deviceClass: "resistor" },
            parameters: { ...item.parameters },
          },
          ...(item.foreground === "auto"
            ? {}
            : { styleOverride: { foreground: item.foreground } }),
        }) as unknown as Instance,
    );
    // Only the entry that changed is written.
    expect(planGroupPropertyCodeEdits(instances, parsed.value, listed)).toEqual(
      [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "r-2",
          set: { value: "4.7k" },
        },
      ],
    );
    expect(
      groupVisibilityTargets(
        { R1: false, R2: true },
        "",
        ["r-1", "r-2"],
        items,
        (item) => item.reference,
      ),
    ).toEqual({ show: ["r-2"], hide: ["r-1"] });
    expect(
      parseGroupPropertyCode(
        source.replace('"R2": "2k"', '"R9": "2k"'),
        listed,
      ),
    ).toMatchObject({
      ok: false,
      message: "parameters.value.R9 is not one of the selected components",
    });
  });

  it("lists a shared parameter by each component even where they agree", () => {
    const items = ["R1", "R2"].map((key) => ({
      key,
      instanceId: key.toLowerCase(),
      name: key,
      parameters: { value: "1k" },
      reference: true,
      value: false,
      foreground: "auto" as const,
    }));
    const listed = { ...context, parameters: { value: "1k" }, items };
    const source = formatGroupPropertyCode(listed);
    expect(JSON.parse(source).parameters).toEqual({
      value: { R1: "1k", R2: "1k" },
    });
    // One value in place of the list still sets them all.
    expect(
      parseGroupPropertyCode(
        source.replace(/"value": \{[^}]*\}/u, '"value": "2k"'),
        listed,
      ),
    ).toMatchObject({ ok: true, value: { parameters: { value: "2k" } } });
  });

  it("shows the name they all show, or as is, and takes one name for all", () => {
    const item = (key: string, shown?: string | null) => ({
      key,
      instanceId: key.toLowerCase(),
      name: key,
      ...(shown === undefined ? {} : { shown }),
      parameters: { value: "1k" },
      reference: true,
      value: false,
      foreground: "auto" as const,
    });
    // R2 and R3 show R1's name as a display alias; a ground shows no name.
    const alike = {
      ...context,
      items: [item("R1"), item("R2", "R1"), item("R3", "R1"), item("G", null)],
    };
    expect(groupPropertyItemNames(alike)).toBe("R1");
    expect(JSON.parse(formatGroupPropertyCode(alike)).names).toBe("R1");
    const differ = { ...context, items: [item("R1"), item("R2")] };
    const source = formatGroupPropertyCode(differ);
    expect(JSON.parse(source).names).toBe("as is");
    expect(parseGroupPropertyCode(source, differ)).toMatchObject({
      ok: true,
      value: { names: "as is" },
    });
    expect(
      parseGroupPropertyCode(
        source.replace('"names": "as is"', '"names": " R5 "'),
        differ,
      ),
    ).toMatchObject({ ok: true, value: { names: "R5" } });
    // Emptied, it leaves each its own name.
    const emptied = parseGroupPropertyCode(
      source.replace('"names": "as is"', '"names": ""'),
      differ,
    );
    expect(emptied.ok && emptied.value.names).toBeUndefined();
    // Nothing to name, no name field.
    expect(
      groupPropertyItemNames({ items: [item("G", null), item("H", null)] }),
    ).toBe("");
    expect(groupPropertyItemNames({ items: [item("R1")] })).toBe("");
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
    for (const retired of ["foreground", "background", "fillColor"]) {
      expect(
        parseGroupPropertyCode(
          source.replace('"color": ""', `"color": "", "${retired}": "auto"`),
          withoutValue,
        ),
      ).toMatchObject({
        ok: false,
        message: `appearance.${retired} is not a supported property`,
      });
    }
  });
});
