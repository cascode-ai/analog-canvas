import { resolveAnnotationName } from "@icm/derived";
import { z } from "zod";

import { type Annotation, type SchematicDocument } from "@icm/model";

import {
  colorToRgb,
  parseCanvasColor,
  type CanvasPropertyField,
} from "./component-property-fields";
import { propertyCodeSpans } from "./component-property-code-assists";
import type { PropertyJsonEditorAdapter } from "./component-property-json-editor";

type Route = SchematicDocument["routes"][number];

const color = z.unknown().transform((value, context) => {
  try {
    return parseCanvasColor(value, "appearance.color");
  } catch (error) {
    context.addIssue({ code: "custom", message: String(error) });
    return z.NEVER;
  }
});

const schema = z.strictObject({
  net: z.strictObject({
    name: z.string().max(128),
    scope: z.enum(["local", "global"]),
  }),
  appearance: z.strictObject({
    color,
    lineStyle: z.enum(["solid", "dashed", "dotted"]),
    directionArrow: z.enum(["none", "middle", "end"]),
  }),
});

export type RoutePropertyCodeValue = z.infer<typeof schema>;
export type RoutePropertyCodeResult =
  { ok: true; value: RoutePropertyCodeValue } | { ok: false; message: string };

const fields: readonly CanvasPropertyField[] = [
  {
    path: "appearance.color",
    label: "Wire color",
    kind: "color",
    description: "",
  },
  {
    path: "net.scope",
    label: "Net scope",
    kind: "choice",
    options: [
      { value: "local", label: "Local to Cell" },
      { value: "global", label: "Global across Cells" },
    ],
    description: "",
  },
  {
    path: "appearance.lineStyle",
    label: "Line style",
    kind: "choice",
    options: [
      { value: "solid", label: "Solid" },
      { value: "dashed", label: "Dashed" },
      { value: "dotted", label: "Dotted" },
    ],
    description: "",
  },
  {
    path: "appearance.directionArrow",
    label: "Direction arrow",
    kind: "choice",
    options: [
      { value: "none", label: "No arrow" },
      { value: "middle", label: "Arrow at middle" },
      { value: "end", label: "Arrow at end" },
    ],
    description: "",
  },
];

function netLabelScope(
  document: SchematicDocument,
  annotation: Annotation | null,
): "local" | "global" {
  if (!annotation) return "local";
  const claim = document.connectivityEvidence.find(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "net-label" &&
      evidence.owner.annotationId === annotation.id,
  );
  return claim?.kind === "name-claim" ? claim.scope : "local";
}

export function routePropertyCodeValue(
  document: SchematicDocument,
  route: Route,
  netLabel: Annotation | null,
): RoutePropertyCodeValue {
  return {
    net: {
      name: netLabel ? resolveAnnotationName(document, netLabel).trim() : "",
      scope: netLabelScope(document, netLabel),
    },
    appearance: {
      color: route.styleOverride?.color
        ? parseCanvasColor(colorToRgb(route.styleOverride.color), "color")
        : "auto",
      lineStyle: route.styleOverride?.lineStyle ?? "solid",
      directionArrow: route.styleOverride?.arrow ?? "none",
    },
  };
}

export function serializeRoutePropertyCode(
  value: RoutePropertyCodeValue,
): string {
  return JSON.stringify(
    {
      ...value,
      appearance: {
        ...value.appearance,
        color:
          value.appearance.color === "auto"
            ? "auto"
            : colorToRgb(value.appearance.color),
      },
    },
    null,
    2,
  );
}

export function parseRoutePropertyCode(
  source: string,
): RoutePropertyCodeResult {
  try {
    return { ok: true, value: schema.parse(JSON.parse(source)) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid Route JSON",
    };
  }
}

export function routePropertyCodeAdapter(): PropertyJsonEditorAdapter {
  const spans = (source: string) =>
    propertyCodeSpans(source, undefined, fields);
  return {
    parse: parseRoutePropertyCode,
    spans,
    changes(source, values) {
      const ranges = spans(source);
      const changes = Object.entries(values).map(([path, value]) => {
        const matches = ranges.filter((span) => span.field.path === path);
        return matches.length === 1
          ? {
              from: matches[0]!.from,
              to: matches[0]!.to,
              insert: JSON.stringify(value),
            }
          : null;
      });
      if (changes.some((change) => change === null)) return [];
      const sorted = changes
        .filter((change) => change !== null)
        .sort((left, right) => left.from - right.from);
      let candidate = source;
      for (const change of [...sorted].reverse())
        candidate =
          candidate.slice(0, change.from) +
          change.insert +
          candidate.slice(change.to);
      return parseRoutePropertyCode(candidate).ok ? sorted : [];
    },
  };
}
