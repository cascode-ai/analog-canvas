/** Readable structural shorthand. Every transform has an exact inverse. */
import {
  equalJsonKeyOrder,
  InstanceNetlistDataSchema,
  SegmentModeSchema,
} from "@icm/model";
import {
  SHORT_FIELDS_FILE_VERSION,
  transformShortProjectFields,
} from "./project-file-short-fields.js";
type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function richText(value: any, decode: boolean): any {
  if (Array.isArray(value)) return value.map((v) => richText(v, decode));
  if (!record(value)) return value;
  const run = (r: any): any => {
    if (decode) {
      if (typeof r === "string") return { kind: "text", value: r };
      if (record(r) && Array.isArray(r.styles)) {
        if (
          r.styles.length === 0 ||
          Object.keys(r).some((k) => !["styles", "children"].includes(k)) ||
          !Array.isArray(r.children)
        )
          throw new Error(
            "A styled text run needs nonempty styles and children",
          );
        let children = r.children.map(run);
        for (const style of [...r.styles].reverse())
          children = [{ kind: "span", style, children }];
        return children[0];
      }
    } else {
      if (r.kind === "text") return r.value;
      if (r.kind === "span") {
        const styles = [r.style];
        let children = r.children;
        while (children.length === 1 && children[0].kind === "span") {
          styles.push(children[0].style);
          children = children[0].children;
        }
        return { styles, children: children.map(run) };
      }
    }
    return richText(r, decode);
  };
  if (Object.keys(value).length === 1 && Array.isArray(value.runs))
    return { runs: value.runs.map(run) };
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, richText(v, decode)]),
  );
}

function symbolPoints(project: RecordValue, decode: boolean): void {
  for (const definition of project.componentDefinitions ?? []) {
    const symbol = definition.symbol;
    if (!symbol) continue;
    for (const primitives of [
      symbol.primitives,
      ...(symbol.variants ?? []).map(
        (v: RecordValue) => v.additionalPrimitives,
      ),
    ]) {
      for (const primitive of primitives ?? []) {
        if (!primitive.points) continue;
        primitive.points = primitive.points.map((p: any) => {
          if (!decode) return [p.x, p.y];
          if (!Array.isArray(p) || p.length !== 2)
            throw new Error("A symbol point must be [x, y]");
          return { x: p[0], y: p[1] };
        });
      }
    }
  }
}

export function compactProjectFile(input: RecordValue): RecordValue {
  const project = richText(input, false);
  const byType = new Map<string, RecordValue[]>();
  for (const document of project.documents)
    for (const instance of document.instances) {
      const group = byType.get(instance.type) ?? [];
      group.push(instance);
      byType.set(instance.type, group);
    }
  const common: RecordValue = Object.create(null);
  for (const [type, instances] of byType) {
    if (instances.length < 2) continue;
    const values: RecordValue = {};
    for (const key of ["variant", "parameters", "target", "color"]) {
      if (
        Object.hasOwn(instances[0]!, key) &&
        instances.every(
          (i) =>
            Object.hasOwn(i, key) &&
            equalJsonKeyOrder(i[key], instances[0]![key]),
        )
      ) {
        values[key] = instances[0]![key];
      }
    }
    if (!Object.keys(values).length) continue;
    common[type] = values;
    for (const instance of instances)
      for (const key of Object.keys(values)) delete instance[key];
  }
  project.defaults.instancesByType = common;
  project.defaults.routeLeg = { mode: "manual" };
  for (const document of project.documents)
    for (const route of document.routes) {
      for (const leg of route.legs) if (leg.mode === "manual") delete leg.mode;
      if (route.legs.length === 1 && route.legs[0].bend === undefined) {
        const { id, mode, ...end } = route.legs[0];
        route.end = end;
        route.legId = id;
        if (mode !== undefined) route.mode = mode;
        delete route.legs;
      }
    }
  symbolPoints(project, false);
  transformShortProjectFields(project, false);
  return project;
}

export function expandProjectFile(input: RecordValue): RecordValue {
  const project = richText(input, true);
  if (project.schemaVersion >= SHORT_FIELDS_FILE_VERSION)
    transformShortProjectFields(project, true);
  const { instancesByType = {}, routeLeg, ...defaults } = project.defaults;
  if (
    !record(instancesByType) ||
    !record(routeLeg) ||
    Object.keys(routeLeg).some((k) => k !== "mode") ||
    !SegmentModeSchema.safeParse(routeLeg.mode).success
  )
    throw new Error("Invalid instance or route defaults");
  const usedTypes = new Set(
    project.documents.flatMap((d: RecordValue) =>
      d.instances.map((i: RecordValue) => i.type),
    ),
  );
  for (const [type, values] of Object.entries(instancesByType)) {
    if (
      !record(values) ||
      Object.keys(values).some(
        (k) => !["variant", "parameters", "target", "color"].includes(k),
      )
    )
      throw new Error("Unknown per-type instance default");
    if (!usedTypes.has(type))
      throw new Error(`Unused instance defaults: ${type}`);
    if (
      values.variant !== undefined &&
      (typeof values.variant !== "string" || !values.variant)
    )
      throw new Error("Invalid default variant");
    if (
      values.color !== undefined &&
      values.color !== "auto" &&
      (typeof values.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(values.color))
    )
      throw new Error("Invalid default color");
    if (values.parameters !== undefined || values.target !== undefined)
      InstanceNetlistDataSchema.parse({
        parameters: values.parameters ?? {},
        ...(values.target === undefined ? {} : { binding: values.target }),
      });
  }
  project.defaults = defaults;
  for (const document of project.documents) {
    document.instances = document.instances.map((i: RecordValue) => ({
      ...instancesByType[i.type],
      ...i,
    }));
    for (const route of document.routes) {
      if (route.end !== undefined) {
        if (route.legs !== undefined)
          throw new Error("A route uses end or legs, never both");
        const { end, legId, mode } = route;
        if (
          !record(end) ||
          Object.keys(end).some(
            (k) => !["terminal", "junction", "memberId"].includes(k),
          )
        )
          throw new Error("A route end specifies only a terminal or junction");
        route.legs = [
          {
            id: legId,
            ...routeLeg,
            ...(mode === undefined ? {} : { mode }),
            ...end,
          },
        ];
        delete route.end;
        delete route.legId;
        delete route.mode;
      } else {
        if (route.mode !== undefined || route.legId !== undefined)
          throw new Error("A route legId/mode requires end");
        route.legs = route.legs.map((leg: RecordValue) => ({
          ...routeLeg,
          ...leg,
        }));
      }
    }
  }
  symbolPoints(project, true);
  return project;
}
