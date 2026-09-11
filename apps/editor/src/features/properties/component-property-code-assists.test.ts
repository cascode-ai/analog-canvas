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
import {
  CANVAS_PROPERTY_FIELDS,
  ROTATION_OPTIONS,
  MIRROR_OPTIONS,
} from "./component-property-fields";

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
  it("addresses all available fields by syntax path and preserves unrelated draft bytes", () => {
    const source = formatComponentPropertyCode(context);
    expect(propertyCodeSpans(source).map((span) => span.field.path)).toEqual(
      CANVAS_PROPERTY_FIELDS.map((field) => field.path),
    );
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
      propertyCodeChanges(source, context, { "placement.rotation": 45 }),
    ).toEqual([]);
    expect(
      propertyCodeChanges(source, context, { "placement.mirror": "y" }),
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
          expect(changed.placement.at).toEqual([210, 140]);
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
