import type { CanvasPropertyField } from "./component-property-fields";
import { propertyCodeSpans } from "./component-property-code-assists";
import type { PropertyJsonEditorAdapter } from "./component-property-json-editor";

type RecordValue = Record<string, unknown>;
export interface ItemPropertyIdentity {
  type: string;
  typePath?: string;
  name: string;
  /** Existing authoring field, when this object's name is editable. */
  namePath?: string;
  coordinate?: readonly [number, number] | null;
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function get(value: RecordValue, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (parent, key) => (record(parent) ? parent[key] : undefined),
      value,
    );
}
function take(value: RecordValue, path: string): unknown {
  const [key, ...rest] = path.split(".");
  if (!rest.length) {
    const result = value[key!];
    delete value[key!];
    return result;
  }
  const child = value[key!];
  if (!record(child)) return undefined;
  const result = take(child, rest.join("."));
  if (!Object.keys(child).length) delete value[key!];
  return result;
}
function put(value: RecordValue, path: string, entry: unknown): void {
  const [key, ...rest] = path.split(".");
  if (!rest.length) {
    value[key!] = entry;
    return;
  }
  if (!record(value[key!])) value[key!] = {};
  put(value[key!] as RecordValue, rest.join("."), entry);
}

/** A UI projection over the existing typed edits; never a second saved model. */
export function itemPropertyCode(
  baseline: string,
  identity: ItemPropertyIdentity,
) {
  const original = JSON.parse(baseline) as RecordValue;
  const candidates: Record<string, string[]> = {
    type: identity.typePath ? [identity.typePath] : [],
    name: identity.namePath ? [identity.namePath] : [],
    coordinate: ["placement.coordinate", "placement.at"],
    rotation: ["placement.rotation"],
    mirror: ["placement.mirror"],
    color: ["appearance.color"],
  };
  const paths = Object.fromEntries(
    Object.entries(candidates).map(([key, list]) => [
      key,
      list.find((path) => get(original, path) !== undefined),
    ]),
  );
  const fixed: RecordValue = {
    type: identity.type,
    name: identity.name,
    coordinate: identity.coordinate ?? null,
    rotation: null,
    mirror: null,
    color: "auto",
  };
  const publicPath = (path: string) =>
    Object.entries(paths).find(([, native]) => native === path)?.[0] ?? path;
  function format(source: string): string {
    const remaining = JSON.parse(source) as RecordValue;
    const common = { ...fixed };
    for (const [key, path] of Object.entries(paths)) {
      if (path) common[key] = take(remaining, path);
    }
    return JSON.stringify({ ...common, ...remaining }, null, 2).replace(
      /("(?:coordinate|color|fillColor)": )\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\]/gu,
      (_match, key, x, y, z) =>
        `${key}[${[x, y, z].filter((v) => v !== undefined).join(", ")}]`,
    );
  }
  function restore(source: string): string {
    const value: unknown = JSON.parse(source);
    if (!record(value)) throw new Error("Properties must be a JSON object");
    const common = Object.fromEntries(
      Object.keys(fixed).map((key) => {
        if (!(key in value)) throw new Error(`${key} is required`);
        return [key, take(value, key)];
      }),
    );
    for (const key of Object.keys(fixed)) {
      const path = paths[key];
      if (!path) {
        const changed =
          JSON.stringify(common[key]) !== JSON.stringify(fixed[key]);
        const anchor = get(value, "placement.anchor");
        const originalAnchor = get(original, "placement.anchor");
        if (
          key === "coordinate" &&
          changed &&
          identity.coordinate &&
          record(anchor) &&
          anchor.kind === "object" &&
          record(originalAnchor) &&
          anchor.objectId === originalAnchor.objectId
        ) {
          const position = common[key];
          if (
            !Array.isArray(position) ||
            position.length !== 2 ||
            !position.every(
              (part) => typeof part === "number" && Number.isInteger(part),
            )
          )
            throw new Error("coordinate must be an integer [x, y] pair");
          if (
            JSON.stringify(anchor.localOffset) !==
            JSON.stringify(originalAnchor.localOffset)
          )
            throw new Error(
              "Edit coordinate or the attachment offset in one operation, not both",
            );
          const offset = anchor.localOffset as { x: number; y: number };
          anchor.localOffset = {
            x: offset.x + position[0] - identity.coordinate[0],
            y: offset.y + position[1] - identity.coordinate[1],
          };
          anchor.fallbackPosition = { x: position[0], y: position[1] };
        } else if (changed)
          throw new Error(
            `${key} is read-only for this object${fixed[key] === null ? " (not applicable)" : ""}`,
          );
      } else {
        if (get(value, path) !== undefined)
          throw new Error(
            `Use ${key} only; ${path} duplicates the same property`,
          );
        put(value, path, common[key]);
      }
    }
    // Empty native groups can be required by their own typed contracts.
    for (const key of ["placement", "appearance", "net"])
      if (!(key in value) && record(original[key])) value[key] = {};
    return JSON.stringify(value);
  }
  function message(error: unknown): string {
    let result = error instanceof Error ? error.message : String(error);
    for (const [key, path] of Object.entries(paths))
      if (path) result = result.replaceAll(path, key);
    return result;
  }
  function parse<T>(
    source: string,
    native: (
      source: string,
    ) => { ok: true; value: T } | { ok: false; message: string },
  ) {
    try {
      const result = native(restore(source));
      return result.ok
        ? result
        : { ok: false as const, message: message(result.message) };
    } catch (error) {
      return { ok: false as const, message: message(error) };
    }
  }
  function adapter(
    native: PropertyJsonEditorAdapter,
  ): PropertyJsonEditorAdapter {
    const fields: CanvasPropertyField[] = native
      .spans(baseline)
      .map(({ field }) => ({ ...field, path: publicPath(field.path) }));
    const spans = (source: string) =>
      propertyCodeSpans(source, undefined, fields);
    const validate = (source: string) => {
      try {
        const result = native.parse(restore(source));
        return result.ok
          ? result
          : { ok: false as const, message: message(result.message) };
      } catch (error) {
        return { ok: false as const, message: message(error) };
      }
    };
    function changes(
      source: string,
      values: Readonly<Record<string, unknown>>,
    ) {
      const ranges = spans(source);
      const result = Object.entries(values).map(([path, value]) => {
        const matches = ranges.filter((range) => range.field.path === path);
        return matches.length === 1
          ? {
              from: matches[0]!.from,
              to: matches[0]!.to,
              insert: JSON.stringify(value),
            }
          : null;
      });
      if (result.some((entry) => !entry)) return [];
      const sorted = result
        .filter((entry) => entry !== null)
        .sort((a, b) => a.from - b.from);
      let next = source;
      for (const change of [...sorted].reverse())
        next =
          next.slice(0, change.from) + change.insert + next.slice(change.to);
      return validate(next).ok ? sorted : [];
    }
    return {
      ...(native.mixedValues === undefined
        ? {}
        : { mixedValues: native.mixedValues }),
      parse: validate,
      spans,
      changes,
      ...(native.reflected
        ? {
            reflected(source: string, direction: "left-right" | "top-bottom") {
              try {
                let next = restore(source);
                for (const change of [
                  ...native.reflected!(next, direction),
                ].reverse())
                  next =
                    next.slice(0, change.from) +
                    change.insert +
                    next.slice(change.to);
                const projected = JSON.parse(format(next));
                return changes(source, {
                  mirror: projected.mirror,
                });
              } catch {
                return [];
              }
            },
          }
        : {}),
    };
  }
  return { format, restore, parse, adapter };
}
