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

function isRichTextDoc(value: RecordValue): boolean {
  if (!Array.isArray(value.runs)) return false;
  let count = 0;
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      count += 1;
      if (count > 1) return false;
    }
  }
  return count === 1;
}

function encodeRichTextRun(r: any): any {
  if (r && typeof r === "object" && !Array.isArray(r)) {
    if (r.kind === "text") return r.value;
    if (r.kind === "span") {
      const styles = [r.style];
      let children = r.children;
      while (children.length === 1 && children[0].kind === "span") {
        styles.push(children[0].style);
        children = children[0].children;
      }
      return { styles, children: children.map(encodeRichTextRun) };
    }
  }
  return compactRichTextCow(r);
}

function decodeRichTextRun(r: any): any {
  if (typeof r === "string") return { kind: "text", value: r };
  if (record(r) && Array.isArray(r.styles)) {
    if (
      r.styles.length === 0 ||
      Object.keys(r).some((k) => k !== "styles" && k !== "children") ||
      !Array.isArray(r.children)
    )
      throw new Error("A styled text run needs nonempty styles and children");
    let children = r.children.map(decodeRichTextRun);
    for (let i = r.styles.length - 1; i >= 0; i -= 1) {
      children = [{ kind: "span", style: r.styles[i], children }];
    }
    return children[0];
  }
  return expandRichTextInPlace(r);
}

/**
 * Copy-on-write RichText compaction: returns `value` untouched (zero
 * allocations) whenever no `{ runs: [...] }` descendant exists beneath it.
 */
function compactRichTextCow(value: any): any {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let copy: any[] | undefined;
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      const next = compactRichTextCow(item);
      if (next !== item) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  if (isRichTextDoc(value)) {
    return { runs: value.runs.map(encodeRichTextRun) };
  }
  let copy: RecordValue | undefined;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === null || typeof item !== "object") continue;
    const next = compactRichTextCow(item);
    if (next !== item) {
      if (!copy) copy = { ...(value as RecordValue) };
      copy[key] = next;
    }
  }
  return copy ?? value;
}

/**
 * In-place RichText expansion for freshly JSON-parsed objects: avoids cloning
 * any untouched arrays or records during load.
 */
function expandRichTextInPlace(value: any): any {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (item !== null && typeof item === "object") {
        value[i] = expandRichTextInPlace(item);
      }
    }
    return value;
  }
  if (isRichTextDoc(value)) {
    value.runs = value.runs.map(decodeRichTextRun);
    return value;
  }
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item !== null && typeof item === "object") {
      value[key] = expandRichTextInPlace(item);
    }
  }
  return value;
}

function compactDocumentRichText(document: RecordValue): void {
  if (Array.isArray(document.annotations)) {
    for (const label of document.annotations) {
      if (!record(label)) continue;
      if (label.text !== undefined && typeof label.text === "object") {
        label.text = compactRichTextCow(label.text);
      }
      if (label.format !== undefined && typeof label.format === "object") {
        label.format = compactRichTextCow(label.format);
      }
    }
  }
  if (Array.isArray(document.instances)) {
    for (const instance of document.instances) {
      if (!record(instance)) continue;
      if (Array.isArray(instance.labels)) {
        for (const label of instance.labels) {
          if (!record(label)) continue;
          if (label.text !== undefined && typeof label.text === "object") {
            label.text = compactRichTextCow(label.text);
          }
          if (label.format !== undefined && typeof label.format === "object") {
            label.format = compactRichTextCow(label.format);
          }
        }
      }
      if (instance.signalFlowParameters !== undefined) {
        instance.signalFlowParameters = compactRichTextCow(
          instance.signalFlowParameters,
        );
      }
    }
  }
  if (document.drafting !== undefined) {
    document.drafting = compactRichTextCow(document.drafting);
  }
  if (document.presentation?.cellSymbol !== undefined) {
    document.presentation = compactRichTextCow(document.presentation);
  }
}

function expandDocumentRichText(document: RecordValue): void {
  if (Array.isArray(document.annotations)) {
    expandRichTextInPlace(document.annotations);
  }
  if (Array.isArray(document.instances)) {
    for (const instance of document.instances) {
      if (!record(instance)) continue;
      if (instance.labels !== undefined) expandRichTextInPlace(instance.labels);
      if (instance.signalFlowParameters !== undefined) {
        expandRichTextInPlace(instance.signalFlowParameters);
      }
    }
  }
  if (document.drafting !== undefined) expandRichTextInPlace(document.drafting);
  if (document.presentation !== undefined) {
    expandRichTextInPlace(document.presentation);
  }
}

function transformPrimitivePoints(
  primitives: unknown,
  decode: boolean,
): unknown {
  if (!Array.isArray(primitives)) return primitives;
  if (decode) {
    for (const primitive of primitives) {
      if (!record(primitive) || !Array.isArray(primitive.points)) continue;
      primitive.points = primitive.points.map((p: any) => {
        if (!Array.isArray(p) || p.length !== 2)
          throw new Error("A symbol point must be [x, y]");
        return { x: p[0], y: p[1] };
      });
    }
    return primitives;
  }
  let copy: unknown[] | undefined;
  for (let i = 0; i < primitives.length; i += 1) {
    const primitive = primitives[i];
    if (!record(primitive) || !Array.isArray(primitive.points)) continue;
    copy ??= primitives.slice();
    copy[i] = {
      ...primitive,
      points: primitive.points.map((p: any) => [p.x, p.y]),
    };
  }
  return copy ?? primitives;
}

function symbolPoints(project: RecordValue, decode: boolean): void {
  if (!Array.isArray(project.componentDefinitions)) return;
  if (decode) {
    for (const definition of project.componentDefinitions) {
      const symbol = definition?.symbol;
      if (!record(symbol)) continue;
      transformPrimitivePoints(symbol.primitives, true);
      if (Array.isArray(symbol.variants)) {
        for (const variant of symbol.variants) {
          if (record(variant))
            transformPrimitivePoints(variant.additionalPrimitives, true);
        }
      }
    }
    return;
  }
  let defsCopy: unknown[] | undefined;
  for (let i = 0; i < project.componentDefinitions.length; i += 1) {
    const definition = project.componentDefinitions[i];
    const symbol = definition?.symbol;
    if (!record(symbol)) continue;
    const nextPrimitives = transformPrimitivePoints(symbol.primitives, false);
    let nextVariants = symbol.variants;
    if (Array.isArray(symbol.variants)) {
      let variantsCopy: unknown[] | undefined;
      for (let v = 0; v < symbol.variants.length; v += 1) {
        const variant = symbol.variants[v];
        if (!record(variant)) continue;
        const nextAdditional = transformPrimitivePoints(
          variant.additionalPrimitives,
          false,
        );
        if (nextAdditional !== variant.additionalPrimitives) {
          variantsCopy ??= symbol.variants.slice();
          variantsCopy[v] = {
            ...variant,
            additionalPrimitives: nextAdditional,
          };
        }
      }
      if (variantsCopy) nextVariants = variantsCopy;
    }
    if (
      nextPrimitives !== symbol.primitives ||
      nextVariants !== symbol.variants
    ) {
      defsCopy ??= project.componentDefinitions.slice();
      defsCopy[i] = {
        ...definition,
        symbol: {
          ...symbol,
          primitives: nextPrimitives,
          ...(nextVariants !== symbol.variants
            ? { variants: nextVariants }
            : {}),
        },
      };
    }
  }
  if (defsCopy) project.componentDefinitions = defsCopy;
}

export function compactProjectFile(input: RecordValue): RecordValue {
  // `input` is a fresh top-level container from encodeProjectFile whose
  // documents, instances, labels, annotations, routes, legs, junctions, and
  // defaults are already owned/mutable. Subtrees borrowed from a frozen
  // CircuitProject (componentDefinitions, drafting, sourceRef, modelSources,
  // etc.) are updated copy-on-write so frozen inputs are never mutated.
  const project = input;
  for (const document of project.documents) compactDocumentRichText(document);
  if (project.componentDefinitions !== undefined) {
    project.componentDefinitions = compactRichTextCow(
      project.componentDefinitions,
    );
  }
  if (project.modelSources !== undefined) {
    project.modelSources = compactRichTextCow(project.modelSources);
  }
  if (project.externalSubcircuitDefinitions !== undefined) {
    project.externalSubcircuitDefinitions = compactRichTextCow(
      project.externalSubcircuitDefinitions,
    );
  }

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
    const commonKeys = Object.keys(values);
    if (!commonKeys.length) continue;
    common[type] = values;
    for (const instance of instances)
      for (const key of commonKeys) delete instance[key];
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
  // `input` arrives freshly parsed from JSON.parse; expand RichText and short
  // fields in place without cloning untouched routes, nets, or junctions.
  const project = input;
  if (Array.isArray(project.documents)) {
    for (const document of project.documents) {
      if (record(document)) expandDocumentRichText(document);
    }
  }
  if (project.componentDefinitions !== undefined) {
    expandRichTextInPlace(project.componentDefinitions);
  }
  if (project.modelSources !== undefined) {
    expandRichTextInPlace(project.modelSources);
  }
  if (project.externalSubcircuitDefinitions !== undefined) {
    expandRichTextInPlace(project.externalSubcircuitDefinitions);
  }
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
  const usedTypes = new Set<string>();
  for (const document of project.documents)
    for (const instance of document.instances) usedTypes.add(instance.type);
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
    const instances = document.instances;
    for (let i = 0; i < instances.length; i += 1) {
      const instance = instances[i]!;
      const shared = instancesByType[instance.type];
      if (shared) instances[i] = { ...shared, ...instance };
    }
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
        const legs = route.legs;
        for (let i = 0; i < legs.length; i += 1) {
          legs[i] = { ...routeLeg, ...legs[i] };
        }
      }
    }
  }
  symbolPoints(project, true);
  return project;
}
