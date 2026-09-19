import { z } from "zod";
import {
  AnnotationSchema,
  DraftingObjectSchema,
  VisualAnchorSchema,
  RichTextDocumentSchema,
  RotationSchema,
  MirrorSchema,
  ArrowEndStyleSchema,
  type Annotation,
  type DraftingObject,
  type SchematicDocument,
} from "@icm/model";
import { arrowEndStyles, resolveDraftingObjectGeometry } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { normalizedBearing } from "../../canvas/canvas-geometry";
import { DEFAULT_OUTLINE_WIDTH } from "../drafting/arrow-presets";
import {
  translateDraftingObject,
  setDraftingBearing,
  setDraftingTangentAngle,
} from "../drafting/drafting-manipulation";
import { quadraticTangentAngle } from "../drafting/drafting-path";
import {
  colorToRgb,
  parseCanvasColor,
  ROTATION_OPTIONS,
  MIRROR_OPTIONS,
  type CanvasPropertyField,
} from "./component-property-fields";
import { propertyCodeSpans } from "./component-property-code-assists";
import type { PropertyJsonEditorAdapter } from "./component-property-json-editor";

const color = z.unknown().transform((value, ctx) => {
  try {
    return parseCanvasColor(value, "color");
  } catch (error) {
    ctx.addIssue({ code: "custom", message: String(error) });
    return z.NEVER;
  }
});
const schema = z.strictObject({
  placement: z.strictObject({
    at: z.tuple([z.number().int(), z.number().int()]).optional(),
    anchor: VisualAnchorSchema.optional(),
    rotation: z.number().finite().min(0).lt(360).optional(),
    mirror: MirrorSchema.optional(),
  }),
  appearance: z.strictObject({
    color,
    fillColor: color.optional(),
    lineStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    strokeScale: z.number().min(0.25).max(4).optional(),
    arrowShape: z.enum(["line", "outline"]).optional(),
    startStyle: ArrowEndStyleSchema.optional(),
    endStyle: ArrowEndStyleSchema.optional(),
    sizeScale: z.number().finite().positive().optional(),
    weight: z.enum(["normal", "bold"]).optional(),
    italic: z.boolean().optional(),
    alignment: z.enum(["start", "middle", "end"]).optional(),
  }),
  geometry: z
    .strictObject({
      width: z.number().finite().positive().optional(),
      height: z.number().int().positive().optional(),
      radius: z.number().int().positive().optional(),
      tangentAngles: z.array(z.number().finite().min(0).max(180)).optional(),
    })
    .optional(),
  stacking: z
    .strictObject({
      layer: z.enum(["back", "front"]),
    })
    .optional(),
  display: z.strictObject({ visible: z.boolean() }).optional(),
  content: RichTextDocumentSchema.optional(),
  locked: z.boolean(),
});
export type AnnotationPropertyValue = z.infer<typeof schema>;
export type PropertyResult<T> =
  { ok: true; value: T } | { ok: false; message: string };
export interface DraftingPropertyContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  object: DraftingObject;
  grid: number;
}
const roundAngle = (angle: number) => Math.round(angle * 10) / 10;

export function draftingPropertyValue(
  context: DraftingPropertyContext,
): AnnotationPropertyValue {
  const { object, document, resolver } = context;
  const geometry = resolveDraftingObjectGeometry(document, resolver, object);
  const text = object.kind === "text" || object.kind === "callout";
  const bare =
    object.kind === "text" &&
    (object.polarity === "positive" || object.polarity === "negative");
  const closed = object.kind === "rectangle" || object.kind === "circle";
  const line = object.kind === "arrow" || object.kind === "construction-line";
  const style = object.styleOverride;
  const value: AnnotationPropertyValue = {
    placement: {
      ...(closed
        ? { at: [object.center.x, object.center.y] as [number, number] }
        : object.anchor.kind === "free"
          ? {
              at: [object.anchor.position.x, object.anchor.position.y] as [
                number,
                number,
              ],
            }
          : { anchor: object.anchor }),
      ...(text ? { rotation: object.rotation } : {}),
      ...(object.kind === "floating-symbol" ? object.transform : {}),
      ...(object.kind === "rectangle" ? { rotation: object.rotation } : {}),
      ...(geometry.kind === "arrow" || geometry.kind === "construction-line"
        ? {
            rotation:
              roundAngle(
                normalizedBearing(geometry.points[0]!, geometry.points[1]!),
              ) % 360,
          }
        : {}),
    },
    appearance: {
      color: style?.color
        ? parseCanvasColor(colorToRgb(style.color), "color")
        : "auto",
      ...(closed
        ? {
            fillColor: style?.fillColor
              ? parseCanvasColor(colorToRgb(style.fillColor), "fillColor")
              : "auto",
          }
        : {}),
      ...(closed || line
        ? {
            lineStyle:
              style?.lineStyle ??
              (object.kind === "arrow" ? "solid" : object.lineStyle),
            strokeScale: style?.strokeScale ?? 1,
          }
        : {}),
      ...(object.kind === "arrow"
        ? {
            arrowShape: object.outline
              ? ("outline" as const)
              : ("line" as const),
            startStyle: arrowEndStyles(object).start.style,
            endStyle: arrowEndStyles(object).end.style,
          }
        : {}),
      ...(text
        ? {
            sizeScale: style?.sizeScale ?? 1,
            ...(!bare
              ? {
                  weight: style?.weight ?? "bold",
                  italic: style?.italic ?? false,
                  alignment: object.alignment,
                }
              : {}),
            ...(object.kind === "text" && object.polarity
              ? { strokeScale: style?.strokeScale ?? 1 }
              : {}),
          }
        : {}),
    },
    ...(object.kind === "rectangle"
      ? { geometry: { width: object.width, height: object.height } }
      : {}),
    ...(object.kind === "circle"
      ? { geometry: { radius: object.radius } }
      : {}),
    ...(object.kind === "arrow" && object.outline
      ? { geometry: { width: object.outline.width } }
      : {}),
    ...((geometry.kind === "arrow" || geometry.kind === "construction-line") &&
    !(object.kind === "arrow" && object.outline)
      ? {
          geometry: {
            tangentAngles: geometry.points
              .slice(0, -1)
              .map((point, index) =>
                roundAngle(
                  quadraticTangentAngle(
                    point,
                    geometry.curveControls[index] ?? null,
                    geometry.points[index + 1]!,
                  ),
                ),
              ),
          },
        }
      : {}),
    ...(closed
      ? {
          stacking: {
            layer:
              object.layer === "background"
                ? ("back" as const)
                : ("front" as const),
          },
        }
      : {}),
    ...(text && !bare ? { content: object.content } : {}),
    locked: object.locked,
  };
  return value;
}

export function annotationPropertyValue(
  annotation: Annotation,
): AnnotationPropertyValue {
  return {
    placement: {
      ...(annotation.anchor.kind === "free"
        ? {
            at: [
              annotation.anchor.position.x,
              annotation.anchor.position.y,
            ] as [number, number],
          }
        : { anchor: annotation.anchor }),
      rotation: annotation.rotation,
    },
    appearance: {
      color: annotation.textColor
        ? parseCanvasColor(annotation.textColor, "color")
        : "auto",
      sizeScale: annotation.sizeScale ?? 1,
      alignment: annotation.alignment,
    },
    display: { visible: annotation.visible ?? true },
    ...(annotation.content ? { content: annotation.content } : {}),
    locked: annotation.locked,
  };
}

export function serializeAnnotationPropertyCode(
  value: AnnotationPropertyValue,
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
        ...(value.appearance.fillColor !== undefined
          ? {
              fillColor:
                value.appearance.fillColor === "auto"
                  ? "auto"
                  : colorToRgb(value.appearance.fillColor),
            }
          : {}),
      },
    },
    null,
    2,
  ).replace(
    /("(?:at|color|fillColor)": )\[\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(-?\d+))?\s*\]/gu,
    (_match, key, first, second, third) =>
      `${key}[${[first, second, third].filter((value) => value !== undefined).join(", ")}]`,
  );
}

/** The projection is a visual edit surface, never a way to replace identity or electrical bindings. */
function parse(
  source: string,
  baseline: AnnotationPropertyValue,
): AnnotationPropertyValue {
  const value = schema.parse(JSON.parse(source));
  for (const section of [
    null,
    "placement",
    "appearance",
    "geometry",
    "stacking",
    "display",
  ] as const) {
    const before = section ? baseline[section] : baseline;
    const after = section ? value[section] : value;
    const keys = Object.keys(before ?? {});
    for (const key of Object.keys(after ?? {})) {
      if (!keys.includes(key))
        throw new Error(
          `${section ? `${section}.` : ""}${key} is not available for this annotation`,
        );
    }
    for (const key of keys) {
      if (!Object.hasOwn(after ?? {}, key))
        throw new Error(`${section ? `${section}.` : ""}${key} is required`);
    }
  }
  if (
    baseline.locked &&
    JSON.stringify({ ...value, locked: true }) !== JSON.stringify(baseline)
  )
    throw new Error("Unlock this annotation before editing its properties");
  return value;
}
function attempt<T>(run: () => T): PropertyResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof z.ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")
          : error instanceof Error
            ? error.message
            : "Invalid property code",
    };
  }
}

function propertyAnchor(value: AnnotationPropertyValue) {
  return value.placement.at
    ? {
        kind: "free" as const,
        position: { x: value.placement.at[0], y: value.placement.at[1] },
      }
    : value.placement.anchor!;
}

export function parseDraftingPropertyCode(
  source: string,
  context: DraftingPropertyContext,
): PropertyResult<DraftingObject> {
  return attempt(() => {
    const { object, document, resolver, grid } = context;
    const baseline = draftingPropertyValue(context);
    const value = parse(source, baseline);
    const anchor = propertyAnchor(value);
    let next = { ...object, anchor, locked: false } as DraftingObject;
    if (
      (object.kind === "arrow" || object.kind === "construction-line") &&
      JSON.stringify(anchor) !== JSON.stringify(object.anchor)
    ) {
      if (
        object.anchor.kind !== "free" ||
        anchor.kind !== "free" ||
        (object.kind === "arrow" &&
          (object.from.kind !== "free" || object.to.kind !== "free"))
      )
        throw new Error(
          "Move attached endpoints through their attachment, not the path anchor",
        );
      next = translateDraftingObject(
        object,
        {
          x: anchor.position.x - object.anchor.position.x,
          y: anchor.position.y - object.anchor.position.y,
        },
        1,
      );
    }
    const style = { ...object.styleOverride };
    for (const key of [
      "color",
      "fillColor",
      "lineStyle",
      "strokeScale",
      "sizeScale",
      "weight",
      "italic",
    ] as const) {
      if (value.appearance[key] === baseline.appearance[key]) continue;
      const changed = value.appearance[key];
      if (changed === "auto") delete style[key];
      else Object.assign(style, { [key]: changed });
    }
    next.styleOverride = Object.keys(style).length ? style : undefined;
    if (next.kind === "rectangle" || next.kind === "circle") {
      if (anchor.kind !== "free")
        throw new Error("Closed shapes require a free placement anchor");
      next.center = anchor.position;
      if (value.stacking!.layer !== baseline.stacking!.layer)
        next.layer =
          value.stacking!.layer === "back" ? "background" : "foreground";
      if (next.kind === "rectangle") {
        next.width = value.geometry!.width!;
        next.height = value.geometry!.height!;
      } else next.radius = value.geometry!.radius!;
    }
    if (
      next.kind === "arrow" &&
      value.appearance.arrowShape !== baseline.appearance.arrowShape
    ) {
      if (
        value.appearance.arrowShape === "outline" &&
        (next.waypoints?.length || next.curveControls?.some(Boolean))
      )
        throw new Error(
          "Outline arrows require a straight path; keep or straighten the existing bends first",
        );
      if (value.appearance.arrowShape === "outline")
        next.outline = { width: DEFAULT_OUTLINE_WIDTH };
      else delete next.outline;
      // A family change must not reinterpret a legacy headless/open arrow's
      // unchanged endpoint values through the new family's fallback rules.
      next.styleOverride = {
        ...next.styleOverride,
        arrowStart: value.appearance.startStyle,
        arrowEnd: value.appearance.endStyle,
      };
    }
    if (next.kind === "arrow") {
      for (const [field, key] of [
        ["startStyle", "arrowStart"],
        ["endStyle", "arrowEnd"],
      ] as const) {
        if (value.appearance[field] !== baseline.appearance[field])
          next.styleOverride = {
            ...next.styleOverride,
            [key]: value.appearance[field],
          };
      }
    }
    if (
      next.kind === "arrow" &&
      next.outline &&
      value.geometry?.width !== undefined
    )
      next.outline = { width: value.geometry.width };
    if (next.kind === "floating-symbol") {
      next.transform = {
        rotation: RotationSchema.parse(value.placement.rotation),
        mirror: MirrorSchema.parse(value.placement.mirror),
      };
    }
    if (next.kind === "text" || next.kind === "callout") {
      next.rotation = RotationSchema.parse(value.placement.rotation);
      if (value.appearance.alignment !== undefined)
        next.alignment = value.appearance.alignment;
      if (value.content) next.content = value.content;
    }
    if (
      next.kind !== "text" &&
      next.kind !== "callout" &&
      next.kind !== "floating-symbol" &&
      value.placement.rotation !== baseline.placement.rotation
    ) {
      const changed = setDraftingBearing(
        next,
        resolveDraftingObjectGeometry(document, resolver, next),
        value.placement.rotation!,
        grid,
      );
      if (changed.kind !== "updated")
        throw new Error(
          "An attached arrow cannot rotate without detaching its endpoints",
        );
      next = changed.object;
    }
    const angles = value.geometry?.tangentAngles;
    if (angles) {
      if (angles.length !== baseline.geometry!.tangentAngles!.length)
        throw new Error("Keep one tangent angle per existing segment");
      for (const [index, angle] of angles.entries()) {
        if (angle === baseline.geometry!.tangentAngles![index]) continue;
        const geometry = resolveDraftingObjectGeometry(
          document,
          resolver,
          next,
        );
        if (
          (next.kind !== "arrow" && next.kind !== "construction-line") ||
          (geometry.kind !== "arrow" && geometry.kind !== "construction-line")
        )
          throw new Error("Tangent angles require a line path");
        const changed = setDraftingTangentAngle(
          next,
          geometry,
          index,
          angle,
          grid,
        );
        if (!changed) throw new Error("This arrow style cannot curve");
        next = changed;
      }
    }
    next.locked = value.locked;
    return DraftingObjectSchema.parse(next);
  });
}

export function parseAnnotationPropertyCode(
  source: string,
  annotation: Annotation,
): PropertyResult<Annotation> {
  return attempt(() => {
    const baseline = annotationPropertyValue(annotation);
    const value = parse(source, baseline);
    const next = {
      ...annotation,
      anchor: propertyAnchor(value),
      rotation: RotationSchema.parse(value.placement.rotation),
      alignment: value.appearance.alignment!,
      locked: value.locked,
    };
    if (value.content) next.content = value.content;
    if (value.display!.visible !== baseline.display!.visible)
      next.visible = value.display!.visible;
    if (value.appearance.sizeScale !== baseline.appearance.sizeScale)
      next.sizeScale = value.appearance.sizeScale;
    if (value.appearance.color !== baseline.appearance.color) {
      if (value.appearance.color === "auto") delete next.textColor;
      else next.textColor = value.appearance.color;
    }
    return AnnotationSchema.parse(next);
  });
}

export function annotationPropertyAdapter<T>(
  parseCode: (source: string) => PropertyResult<T>,
  closed: boolean,
  colorLabel = closed ? "Border" : "Text",
): PropertyJsonEditorAdapter {
  const fields: CanvasPropertyField[] = [
    {
      path: "appearance.color",
      label: colorLabel,
      kind: "color",
      description: "",
    },
    {
      path: "appearance.fillColor",
      label: "Fill",
      kind: "color",
      description: "",
    },
    {
      path: "placement.rotation",
      label: "Rotation",
      kind: "choice",
      options: ROTATION_OPTIONS,
      description: "",
      help: "Clockwise angle: 0° right, 90° down. Choose a common angle or type a custom angle in the code. Text uses 45° steps.",
    },
    {
      path: "placement.mirror",
      label: "Mirror",
      kind: "choice",
      options: MIRROR_OPTIONS,
      description: "",
    },
    {
      path: "appearance.lineStyle",
      label: "Line style",
      kind: "choice",
      options: [
        { value: "solid", label: "Solid — continuous line" },
        { value: "dashed", label: "Dashed — short dashes" },
        { value: "dotted", label: "Dotted — dots" },
      ],
      description: "",
    },
    {
      path: "appearance.arrowShape",
      label: "Arrow shape",
      kind: "choice",
      options: [
        { value: "line", label: "Line" },
        { value: "outline", label: "Outline" },
      ],
      description: "",
      help: "Outline arrows require a straight path. Endpoint styles are controlled independently below.",
    },
    ...(["start", "end"] as const).map((end) => ({
      path: `appearance.${end}Style`,
      label: end === "start" ? "Start style" : "End style",
      kind: "choice" as const,
      options: [
        { value: "small-arrow", label: "Small arrow" },
        { value: "medium-arrow", label: "Medium arrow" },
        { value: "large-arrow", label: "Large arrow" },
        { value: "dot", label: "Dot" },
        { value: "none", label: "None" },
        { value: "open-arrow", label: "Open arrow" },
      ],
      description: "",
      help: `${end === "start" ? "First" : "Last"} endpoint of the drawn path; stays with that endpoint when rotated or mirrored.`,
    })),
    {
      path: "stacking.layer",
      label: "Layer",
      kind: "choice",
      options: [
        { value: "front", label: "Front — in front of the circuit" },
        { value: "back", label: "Back — behind the circuit" },
      ],
      description: "",
    },
    {
      path: "appearance.alignment",
      label: "Text alignment",
      kind: "choice",
      options: [
        { value: "start", label: "Start — left" },
        { value: "middle", label: "Middle — centered" },
        { value: "end", label: "End — right" },
      ],
      description: "",
    },
    {
      path: "appearance.weight",
      label: "Text weight",
      kind: "choice",
      options: [
        { value: "normal", label: "Normal" },
        { value: "bold", label: "Bold" },
      ],
      description: "",
    },
    ...[
      {
        path: "appearance.italic",
        label: "Italic",
        on: "Italic",
        off: "Upright",
      },
      {
        path: "display.visible",
        label: "Visibility",
        on: "Visible",
        off: "Hidden",
      },
      { path: "locked", label: "Lock", on: "Locked", off: "Unlocked" },
    ].map(({ path, label, on, off }): CanvasPropertyField => ({
      path,
      label,
      kind: "choice",
      description: "",
      options: [
        { value: false, label: off },
        { value: true, label: on },
      ],
    })),
  ];
  const spans = (source: string) =>
    propertyCodeSpans(source, undefined, fields);
  return {
    parse: parseCode,
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
      return parseCode(candidate).ok ? sorted : [];
    },
  };
}
