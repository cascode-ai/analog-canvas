import { describe, expect, it } from "vitest";
import { transformPoint } from "@icm/model";
import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
} from "./component-property-code";
import {
  propertyCodeSpans,
  propertyCodeChanges,
  reflectedPropertyCode,
} from "./component-property-code-assists";
import { ROTATION_OPTIONS, MIRROR_OPTIONS } from "./component-property-fields";

const context = {
  instance: {
    id: "M1",
    symbolId: "nmos",
    placement: {
      position: { x: 210, y: 140 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
  },
  referenceVisible: true,
  valueVisible: false,
};
function apply(
  source: string,
  changes: ReturnType<typeof propertyCodeChanges>,
) {
  return [...changes]
    .reverse()
    .reduce(
      (text, change) =>
        text.slice(0, change.from) + change.insert + text.slice(change.to),
      source,
    );
}

describe("Canvas property assistance", () => {
  it("addresses each swap switch independently and refuses nonboolean edits", () => {
    const amplifier = {
      ...context,
      instance: { ...context.instance, symbolId: "opamp-differential" },
    };
    const source = formatComponentPropertyCode(amplifier);
    for (const key of ["inputsSwapped", "outputsSwapped"]) {
      const path = `appearance.${key}`;
      expect(
        propertyCodeSpans(source, amplifier).find(
          (span) => span.field.path === path,
        )?.field.kind,
      ).toBe("boolean");
      expect(
        apply(source, propertyCodeChanges(source, amplifier, { [path]: true })),
      ).toBe(source.replace(`"${key}": false`, `"${key}": true`));
      expect(
        propertyCodeChanges(source, amplifier, { [path]: "true" }),
      ).toEqual([]);
    }
  });

  it("edits an independent field without repairing another invalid value", () => {
    const source = formatComponentPropertyCode(context).replace(
      '"rotation": 0',
      '"rotation": 30',
    );
    const changed = apply(
      source,
      propertyCodeChanges(source, context, { "display.value": true }),
    );
    expect(changed).toBe(source.replace('"value": false', '"value": true'));
    expect(parseComponentPropertyCode(changed, context).ok).toBe(false);
    const repaired = apply(
      changed,
      propertyCodeChanges(changed, context, { "placement.rotation": 45 }),
    );
    expect(parseComponentPropertyCode(repaired, context).ok).toBe(true);
  });
  it("rejects ambiguous duplicate field controls", () => {
    const source = formatComponentPropertyCode(context).replace(
      '"rotation": 0',
      '"rotation": 0, "rotation": 90',
    );
    expect(
      propertyCodeChanges(source, context, { "placement.rotation": 180 }),
    ).toEqual([]);
  });
  it("flips a valid orientation while preserving an invalid color", () => {
    const source = formatComponentPropertyCode(context).replace(
      '"color": "auto"',
      '"color": [256, 0, 0]',
    );
    const changed = apply(
      source,
      reflectedPropertyCode(source, context, "left-right"),
    );
    expect(JSON.parse(changed).appearance.color).toEqual([256, 0, 0]);
    expect(JSON.parse(changed).placement).not.toEqual(
      JSON.parse(source).placement,
    );
    expect(parseComponentPropertyCode(changed, context).ok).toBe(false);
  });
  it("addresses all available fields by syntax path and preserves unrelated draft bytes", () => {
    const source = formatComponentPropertyCode(context);
    expect(propertyCodeSpans(source).map((span) => span.field.path)).toEqual([
      "placement.coordinate",
      "placement.rotation",
      "placement.mirror",
      "appearance",
      "appearance.color",
      "display.visualAnnotation",
      "display.value",
    ]);
    const changed = apply(
      source,
      propertyCodeChanges(source, context, { "display.value": true }),
    );
    expect(changed).toBe(source.replace('"value": false', '"value": true'));
    const escaped = source.replace('"value"', '"val\\u0075e"');
    expect(
      apply(
        escaped,
        propertyCodeChanges(escaped, context, { "display.value": true }),
      ),
    ).toContain('"val\\u0075e": true');
  });
  it("uses the very same enum choices for controls and validation", () => {
    const source = formatComponentPropertyCode(context);
    for (const rotation of ROTATION_OPTIONS)
      for (const mirror of MIRROR_OPTIONS) {
        const changes = propertyCodeChanges(source, context, {
          "placement.rotation": rotation.value,
          "placement.mirror": mirror.value,
        });
        expect(changes).toHaveLength(2);
        expect(
          parseComponentPropertyCode(apply(source, changes), context).ok,
        ).toBe(true);
      }
    expect(
      propertyCodeChanges(source, context, { "placement.rotation": 30 }),
    ).toEqual([]);
    expect(
      propertyCodeChanges(source, context, { "placement.mirror": "y" }),
    ).toEqual([]);
  });
  it("edits the VDD connection choice inside the JSON surface", () => {
    const vddContext = {
      ...context,
      instance: { ...context.instance, symbolId: "vdd-port" },
      connection: "cell-pin" as const,
    };
    const source = formatComponentPropertyCode(vddContext);
    const connection = propertyCodeSpans(source, vddContext).find(
      (span) => span.field.path === "connection",
    );
    expect(connection?.field.kind).toBe("choice");
    expect(
      JSON.parse(
        apply(
          source,
          propertyCodeChanges(source, vddContext, { connection: "global" }),
        ),
      ).connection,
    ).toBe("global");
    expect(
      propertyCodeChanges(source, vddContext, { connection: "project" }),
    ).toEqual([]);
  });
  it("does not repair invalid JSON implicitly, overwrite invalid drafts, or invent unsupported controls", () => {
    const source = formatComponentPropertyCode(context);
    expect(
      propertyCodeChanges(source.slice(0, -1), context, {
        "display.value": true,
      }),
    ).toEqual([]);
    expect(
      propertyCodeChanges(source, context, { "placement.unsupported": 0 }),
    ).toEqual([]);
    const noDisplay = {
      ...context,
      referenceVisible: null,
      valueVisible: null,
    };
    const unavailable = formatComponentPropertyCode(noDisplay);
    expect(
      propertyCodeSpans(unavailable).some(
        (span) => span.field.kind === "boolean",
      ),
    ).toBe(false);
    expect(
      propertyCodeChanges(unavailable, noDisplay, { "display.value": true }),
    ).toEqual([]);
  });
  it("edits merged internal-mark and polarity controls by syntax path", () => {
    const opampContext = {
      ...context,
      instance: { ...context.instance, symbolId: "opamp" },
    };
    const opampSource = formatComponentPropertyCode(opampContext);
    expect(
      propertyCodeSpans(opampSource, opampContext).map(
        (span) => span.field.path,
      ),
    ).toContain("appearance.internalMark");
    expect(
      JSON.parse(
        apply(
          opampSource,
          propertyCodeChanges(opampSource, opampContext, {
            "appearance.internalMark": "A",
          }),
        ),
      ).appearance.internalMark,
    ).toBe("A");

    const comparatorContext = {
      ...context,
      instance: { ...context.instance, symbolId: "comparator" },
    };
    const comparatorSource = formatComponentPropertyCode(comparatorContext);
    const changed = apply(
      comparatorSource,
      propertyCodeChanges(comparatorSource, comparatorContext, {
        "appearance.inputPolarity": false,
      }),
    );
    expect(JSON.parse(changed).appearance.inputPolarity).toBe(false);
  });
  it("reflects in canvas directions at every rotation/mirror state without moving the origin", () => {
    for (const rotation of ROTATION_OPTIONS)
      for (const mirror of MIRROR_OPTIONS)
        for (const direction of ["left-right", "top-bottom"] as const) {
          const code = JSON.parse(formatComponentPropertyCode(context));
          code.placement.rotation = rotation.value;
          code.placement.mirror = mirror.value;
          const source = JSON.stringify(code);
          const changed = JSON.parse(
            apply(source, reflectedPropertyCode(source, context, direction)),
          );
          expect(changed.placement.coordinate).toEqual([210, 140]);
          expect(changed.placement.rotation).toBe(code.placement.rotation);
          const before = transformPoint(
            { x: 10, y: 20 },
            { x: 0, y: 0 },
            code.placement,
          );
          const after = transformPoint(
            { x: 10, y: 20 },
            { x: 0, y: 0 },
            changed.placement,
          );
          expect(after).toEqual(
            direction === "left-right"
              ? { x: -before.x, y: before.y }
              : { x: before.x, y: -before.y },
          );
          expect(
            JSON.parse(
              apply(
                JSON.stringify(changed),
                reflectedPropertyCode(
                  JSON.stringify(changed),
                  context,
                  direction,
                ),
              ),
            ),
          ).toEqual(code);
        }
  });
});
