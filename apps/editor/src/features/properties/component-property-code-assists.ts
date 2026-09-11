import { jsonLanguage } from "@codemirror/lang-json";
import { reflectOrientation } from "@icm/model";
import { componentDetailFields } from "./component-property-details";
import {
  parseComponentPropertyCode,
  type ComponentPropertyCodeContext,
} from "./component-property-code";
import {
  CANVAS_PROPERTY_FIELDS,
  type CanvasPropertyField,
} from "./component-property-fields";

type JsonNode = ReturnType<typeof jsonLanguage.parser.parse>["topNode"];
export interface PropertyCodeSpan {
  field: CanvasPropertyField;
  from: number;
  to: number;
  value: unknown;
}

/** Use syntax paths, not matching text: duplicate names in unrelated objects are not controls. */
export function propertyCodeSpans(
  source: string,
  context?: ComponentPropertyCodeContext,
): PropertyCodeSpan[] {
  const spans: PropertyCodeSpan[] = [];
  const fields = [
    ...CANVAS_PROPERTY_FIELDS,
    ...(context
      ? componentDetailFields(context.instance, context.details)
      : []),
  ];
  function visit(object: JsonNode, prefix: string) {
    for (let node = object.firstChild; node; node = node.nextSibling) {
      if (node.name !== "Property") continue;
      const name = node.getChild("PropertyName");
      const value = node.lastChild;
      if (!name || !value || value === name) continue;
      try {
        const key = JSON.parse(source.slice(name.from, name.to)) as string;
        const path = prefix ? `${prefix}.${key}` : key;
        const field = fields.find((item) => item.path === path);
        if (field)
          spans.push({
            field,
            from: value.from,
            to: value.to,
            value: JSON.parse(source.slice(value.from, value.to)),
          });
        if (value.name === "Object") visit(value, path);
      } catch {
        /* Incomplete JSON stays editable; do not guess value boundaries. */
      }
    }
  }
  const root = jsonLanguage.parser.parse(source).topNode.getChild("Object");
  if (root) visit(root, "");
  return spans;
}

/** Controls edit the same draft, preserving whitespace and all unrelated authored bytes. */
export function propertyCodeChanges(
  source: string,
  context: ComponentPropertyCodeContext,
  values: Readonly<Record<string, unknown>>,
) {
  if (!parseComponentPropertyCode(source, context).ok) return [];
  const spans = propertyCodeSpans(source, context);
  const changes = Object.entries(values).map(([path, value]) => {
    const span = spans.find((item) => item.field.path === path);
    return span
      ? { from: span.from, to: span.to, insert: JSON.stringify(value) }
      : null;
  });
  if (changes.some((change) => !change)) return [];
  const sorted = changes
    .filter((change) => change !== null)
    .sort((a, b) => a.from - b.from);
  let candidate = source;
  for (const change of [...sorted].reverse())
    candidate =
      candidate.slice(0, change.from) +
      change.insert +
      candidate.slice(change.to);
  return parseComponentPropertyCode(candidate, context).ok ? sorted : [];
}

export function reflectedPropertyCode(
  source: string,
  context: ComponentPropertyCodeContext,
  direction: "left-right" | "top-bottom",
) {
  const parsed = parseComponentPropertyCode(source, context);
  if (!parsed.ok || !parsed.value.placement) return [];
  const next = reflectOrientation(parsed.value.placement, direction);
  return propertyCodeChanges(source, context, {
    "placement.rotation": next.rotation,
    "placement.mirror": next.mirror,
  });
}
