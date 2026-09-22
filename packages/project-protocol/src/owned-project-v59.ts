/**
 * The portable authoring format. The editor's normalized runtime indexes are
 * deliberately an implementation detail, not a second editable file format.
 * All transforms are structural: no coordinates, identities or electrical
 * facts are inferred, and no instance is removed.
 */
import type {
  Annotation,
  CircuitProject,
  Instance,
  RouteEndpoint,
} from "@icm/model";
import { ProjectFormatError } from "./diagnostics.js";

export const OWNED_PROJECT_FILE_VERSION = 59;
// This codec reconstructs the schema it was designed against. Future runtime
// upgrades run after decoding, rather than reinterpreting an old file in place.
const OWNED_FILE_MODEL_VERSION = 58;
type ObjectValue = Record<string, unknown>;
type Path = (string | number)[];
const DEFAULTS = {
  instance: { rotation: 0, mirror: "none" },
  label: { alignment: "middle", rotation: 0, locked: false },
};

function fail(path: Path, message: string): never {
  throw new ProjectFormatError([{ code: "INVALID_PROJECT", path, message }]);
}
function object(value: unknown, path: Path): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "Expected an object");
  return value as ObjectValue;
}
function array(value: unknown, path: Path): unknown[] {
  if (!Array.isArray(value)) fail(path, "Expected an array");
  return value;
}
function forbid(value: ObjectValue, keys: string[], path: Path): void {
  for (const key of keys)
    if (Object.hasOwn(value, key))
      fail([...path, key], `Use the schema-59 field instead of ${key}`);
}
function exactKeys(value: ObjectValue, keys: string[], path: Path): void {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail([...path, key], `Unknown field: ${key}`);
}
function point(value: unknown, path: Path): { x: unknown; y: unknown } {
  const values = array(value, path);
  if (values.length !== 2) fail(path, "A coordinate must be [x, y]");
  return { x: values[0], y: values[1] };
}
function coordinates(value: { x: number; y: number }): number[] {
  return [value.x, value.y];
}
function encodeEndpoint(endpoint: RouteEndpoint): ObjectValue {
  return endpoint.kind === "terminal"
    ? { terminal: [endpoint.instanceId, endpoint.pinName] }
    : { junction: endpoint.junctionId };
}
function decodeTerminal(value: unknown, path: Path): ObjectValue {
  const pair = array(value, path);
  if (pair.length !== 2) fail(path, "A terminal must be [instanceId, pinName]");
  return { instanceId: pair[0], pinName: pair[1] };
}
function decodeEndpoint(value: ObjectValue, path: Path): ObjectValue {
  const terminal = Object.hasOwn(value, "terminal");
  const junction = Object.hasOwn(value, "junction");
  if (terminal === junction)
    fail(path, "Specify exactly one terminal or junction");
  if (junction) return { kind: "junction", junctionId: value.junction };
  return {
    kind: "terminal",
    ...decodeTerminal(value.terminal, [...path, "terminal"]),
  };
}
function encodeText(text: Annotation["content"]): unknown {
  if (text?.runs.length === 1 && text.runs[0]?.kind === "text")
    return text.runs[0].value;
  return text;
}
function decodeText(text: unknown): unknown {
  return typeof text === "string"
    ? { runs: [{ kind: "text", value: text }] }
    : text;
}
function encodeLabel(
  annotation: Annotation,
  order: number,
  owner?: string,
): ObjectValue {
  const {
    binding,
    content,
    formatOverride,
    anchor,
    alignment,
    rotation,
    locked,
    ...rest
  } = annotation;
  let bind: unknown = binding;
  if (binding && "instanceId" in binding && binding.instanceId === owner) {
    bind =
      binding.kind === "instance-reference"
        ? "name"
        : binding.parameter === undefined
          ? "value"
          : {
              parameter: binding.parameter,
              ...(binding.showValue === false ? { showValue: false } : {}),
            };
  }
  return {
    ...rest,
    order,
    ...(content ? { text: encodeText(content) } : {}),
    ...(binding ? { bind } : {}),
    ...(formatOverride ? { format: encodeText(formatOverride) } : {}),
    anchor:
      anchor.kind === "object" && anchor.objectId === owner
        ? {
            offset: coordinates(anchor.localOffset),
            fallback: coordinates(anchor.fallbackPosition),
          }
        : anchor,
    ...(alignment !== DEFAULTS.label.alignment ? { alignment } : {}),
    ...(rotation !== DEFAULTS.label.rotation ? { rotation } : {}),
    ...(locked !== DEFAULTS.label.locked ? { locked } : {}),
  };
}
function decodeLabel(
  value: unknown,
  defaults: ObjectValue,
  path: Path,
  owner?: unknown,
  allowParameterShowValue = false,
): ObjectValue {
  const source = object(value, path);
  forbid(source, ["binding", "content", "formatOverride"], path);
  const { text, bind, format, anchor: rawAnchor, order, ...rest } = source;
  if (!Number.isSafeInteger(order) || Number(order) < 0)
    fail([...path, "order"], "Label order must be a nonnegative integer");
  let binding: unknown = bind;
  if (bind === "name" || bind === "value") {
    if (typeof owner !== "string")
      fail(
        [...path, "bind"],
        "An own-name/value label must belong to an instance",
      );
    binding = {
      kind: bind === "name" ? "instance-reference" : "instance-value",
      instanceId: owner,
    };
  } else if (
    bind &&
    typeof bind === "object" &&
    Object.hasOwn(bind, "parameter")
  ) {
    const parameter = object(bind, [...path, "bind"]);
    exactKeys(
      parameter,
      allowParameterShowValue ? ["parameter", "showValue"] : ["parameter"],
      [...path, "bind"],
    );
    if (typeof owner !== "string")
      fail([...path, "bind"], "A parameter label must belong to an instance");
    if (parameter.showValue !== undefined && parameter.showValue !== false)
      fail([...path, "bind", "showValue"], "showValue may only be false");
    binding = {
      kind: "instance-value",
      instanceId: owner,
      parameter: parameter.parameter,
      ...(parameter.showValue === false ? { showValue: false } : {}),
    };
  }
  let anchor = object(rawAnchor, [...path, "anchor"]);
  if (Object.hasOwn(anchor, "offset")) {
    exactKeys(anchor, ["offset", "fallback"], [...path, "anchor"]);
    if (typeof owner !== "string")
      fail([...path, "anchor"], "A local offset requires an owning instance");
    anchor = {
      kind: "object",
      objectId: owner,
      localOffset: point(anchor.offset, [...path, "anchor", "offset"]),
      fallbackPosition: point(anchor.fallback, [...path, "anchor", "fallback"]),
    };
  }
  return {
    ...defaults,
    ...rest,
    anchor,
    ...(text !== undefined ? { content: decodeText(text) } : {}),
    ...(bind !== undefined ? { binding } : {}),
    ...(format !== undefined ? { formatOverride: decodeText(format) } : {}),
  };
}
function encodeInstance(
  instance: Instance,
  labels: ObjectValue[],
): ObjectValue {
  const {
    symbolId,
    reference,
    symbolVariantId,
    placement,
    netlist,
    styleOverride,
    ...rest
  } = instance;
  return {
    type: symbolId,
    ...(reference !== undefined ? { name: reference } : {}),
    ...rest,
    ...(symbolVariantId !== undefined ? { variant: symbolVariantId } : {}),
    coordinate: placement ? coordinates(placement.position) : null,
    ...(placement && placement.rotation !== DEFAULTS.instance.rotation
      ? { rotation: placement.rotation }
      : {}),
    ...(placement && placement.mirror !== DEFAULTS.instance.mirror
      ? { mirror: placement.mirror }
      : {}),
    ...(styleOverride !== undefined
      ? {
          color: styleOverride.foreground ?? "auto",
          ...(styleOverride.background !== undefined
            ? { backgroundColor: styleOverride.background }
            : {}),
        }
      : {}),
    ...(netlist !== undefined
      ? {
          parameters: netlist.parameters,
          ...(netlist.binding ? { target: netlist.binding } : {}),
        }
      : {}),
    ...(labels.length ? { labels } : {}),
  };
}

/** Capture full source; only repeated owner references and wrapper structures disappear. */
export function encodeProjectFile(project: CircuitProject): ObjectValue {
  return {
    ...project,
    schemaVersion: OWNED_PROJECT_FILE_VERSION,
    defaults: structuredClone(DEFAULTS),
    documents: project.documents.map((document) => {
      const ids = new Set(document.instances.map((instance) => instance.id));
      const owned = new Map<string, ObjectValue[]>();
      const annotations: ObjectValue[] = [];
      document.annotations.forEach((annotation, order) => {
        const binding = annotation.binding;
        const boundOwner =
          binding && "instanceId" in binding ? binding.instanceId : undefined;
        const anchoredOwner =
          annotation.anchor.kind === "object"
            ? annotation.anchor.objectId
            : undefined;
        const owner =
          boundOwner && ids.has(boundOwner)
            ? boundOwner
            : anchoredOwner && ids.has(anchoredOwner)
              ? anchoredOwner
              : undefined;
        const label = encodeLabel(annotation, order, owner);
        if (owner) {
          const labels = owned.get(owner) ?? [];
          labels.push(label);
          owned.set(owner, labels);
        } else annotations.push(label);
      });
      return {
        ...document,
        instances: document.instances.map((instance) =>
          encodeInstance(instance, owned.get(instance.id) ?? []),
        ),
        annotations,
        nets: document.nets.map(({ terminals, ...rest }) => ({
          ...rest,
          terminals: terminals.map(({ instanceId, pinName }) => [
            instanceId,
            pinName,
          ]),
        })),
        junctions: document.junctions.map(({ position, ...rest }) => ({
          ...rest,
          coordinate: coordinates(position),
        })),
        routes: document.routes.map(({ start, legs, ...rest }) => ({
          ...rest,
          start: encodeEndpoint(start),
          legs: legs.map(({ to, ...leg }) =>
            to.kind === "bend"
              ? {
                  ...leg,
                  bend: to.bendId,
                  coordinate: coordinates(to.position),
                }
              : { ...leg, ...encodeEndpoint(to.endpoint) },
          ),
        })),
      };
    }),
  };
}

/** Decode once into the existing validated runtime model. Unknown fields stay errors. */
export function decodeProjectFile(
  raw: ObjectValue,
  options: { allowParameterShowValue?: boolean } = {},
): ObjectValue {
  if (raw.componentDefinitions !== undefined)
    array(raw.componentDefinitions, ["componentDefinitions"]);
  else if (
    array(raw.documents, ["documents"]).some((value, index) => {
      const document = object(value, ["documents", index]);
      return (
        array(document.instances, ["documents", index, "instances"]).length >
          0 ||
        (document.drafting &&
          object(document.drafting, ["documents", index, "drafting"])
            .objects instanceof Array &&
          (
            object(document.drafting, ["documents", index, "drafting"])
              .objects as unknown[]
          ).some((item) => object(item, []).kind === "floating-symbol"))
      );
    })
  )
    fail(
      ["componentDefinitions"],
      "A portable drawing must include its component definitions",
    );
  const { defaults: rawDefaults, ...project } = raw;
  const defaults = object(rawDefaults, ["defaults"]);
  exactKeys(defaults, ["instance", "label"], ["defaults"]);
  const instanceDefaults = object(defaults.instance, ["defaults", "instance"]);
  const labelDefaults = object(defaults.label, ["defaults", "label"]);
  exactKeys(instanceDefaults, ["rotation", "mirror"], ["defaults", "instance"]);
  exactKeys(
    labelDefaults,
    ["alignment", "rotation", "locked"],
    ["defaults", "label"],
  );
  // Validate defaults even for empty files where no object would consume them.
  if (
    ![0, 45, 90, 135, 180, 225, 270, 315].includes(
      Number(instanceDefaults.rotation),
    ) ||
    typeof instanceDefaults.rotation !== "number"
  )
    fail(["defaults", "instance", "rotation"], "Invalid rotation");
  if (
    !["none", "horizontal", "vertical", "both"].includes(
      instanceDefaults.mirror as string,
    )
  )
    fail(["defaults", "instance", "mirror"], "Invalid mirror");
  if (!["start", "middle", "end"].includes(labelDefaults.alignment as string))
    fail(["defaults", "label", "alignment"], "Invalid alignment");
  if (
    ![0, 45, 90, 135, 180, 225, 270, 315].includes(
      Number(labelDefaults.rotation),
    ) ||
    typeof labelDefaults.rotation !== "number"
  )
    fail(["defaults", "label", "rotation"], "Invalid rotation");
  if (typeof labelDefaults.locked !== "boolean")
    fail(["defaults", "label", "locked"], "Expected boolean");
  return {
    ...project,
    schemaVersion: OWNED_FILE_MODEL_VERSION,
    documents: array(raw.documents, ["documents"]).map(
      (value, documentIndex) => {
        const path: Path = ["documents", documentIndex];
        const document = object(value, path);
        const labels: { order: number; label: ObjectValue }[] = [];
        const orders = new Set<number>();
        const addLabel = (value: unknown, labelPath: Path, owner?: unknown) => {
          const label = decodeLabel(
            value,
            labelDefaults,
            labelPath,
            owner,
            options.allowParameterShowValue === true,
          );
          const order = object(value, labelPath).order as number;
          if (orders.has(order))
            fail(
              [...labelPath, "order"],
              "Label order must be unique within the document",
            );
          orders.add(order);
          labels.push({ order, label });
        };
        array(document.annotations, [...path, "annotations"]).forEach(
          (value, index) => addLabel(value, [...path, "annotations", index]),
        );
        const instances = array(document.instances, [...path, "instances"]).map(
          (value, index) => {
            const instancePath = [...path, "instances", index];
            const instance = object(value, instancePath);
            forbid(
              instance,
              [
                "symbolId",
                "reference",
                "symbolVariantId",
                "placement",
                "styleOverride",
                "netlist",
              ],
              instancePath,
            );
            const {
              type,
              name,
              variant,
              coordinate,
              rotation,
              mirror,
              color,
              backgroundColor,
              parameters,
              target,
              labels: ownedLabels,
              ...rest
            } = instance;
            if (target !== undefined && parameters === undefined)
              fail(
                [...instancePath, "parameters"],
                "A netlist target requires parameters (an empty object is allowed)",
              );
            if (
              coordinate === null &&
              (rotation !== undefined || mirror !== undefined)
            )
              fail(
                instancePath,
                "An unplaced instance cannot have rotation or mirror overrides",
              );
            if (ownedLabels !== undefined)
              array(ownedLabels, [...instancePath, "labels"]).forEach(
                (value, labelIndex) =>
                  addLabel(
                    value,
                    [...instancePath, "labels", labelIndex],
                    instance.id,
                  ),
              );
            let style: ObjectValue | undefined;
            if (color !== undefined || backgroundColor !== undefined) {
              style = {
                ...(color !== undefined && color !== "auto"
                  ? { foreground: color }
                  : {}),
                ...(backgroundColor !== undefined
                  ? { background: backgroundColor }
                  : {}),
              };
            }
            return {
              ...rest,
              symbolId: type,
              ...(name !== undefined ? { reference: name } : {}),
              ...(variant !== undefined ? { symbolVariantId: variant } : {}),
              placement:
                coordinate === null
                  ? null
                  : {
                      position: point(coordinate, [
                        ...instancePath,
                        "coordinate",
                      ]),
                      rotation:
                        rotation === undefined
                          ? instanceDefaults.rotation
                          : rotation,
                      mirror:
                        mirror === undefined ? instanceDefaults.mirror : mirror,
                    },
              ...(style !== undefined ? { styleOverride: style } : {}),
              ...(parameters !== undefined
                ? {
                    netlist: {
                      parameters,
                      ...(target !== undefined ? { binding: target } : {}),
                    },
                  }
                : {}),
            };
          },
        );
        return {
          ...document,
          instances,
          nets: array(document.nets, [...path, "nets"]).map((value, index) => {
            const p = [...path, "nets", index];
            const net = object(value, p);
            return {
              ...net,
              terminals: array(net.terminals, [...p, "terminals"]).map(
                (terminal, index) =>
                  decodeTerminal(terminal, [...p, "terminals", index]),
              ),
            };
          }),
          annotations: labels
            .sort((a, b) => a.order - b.order)
            .map(({ label }) => label),
          junctions: array(document.junctions, [...path, "junctions"]).map(
            (value, index) => {
              const p = [...path, "junctions", index];
              const junction = object(value, p);
              forbid(junction, ["position"], p);
              const { coordinate, ...rest } = junction;
              return {
                ...rest,
                position: point(coordinate, [...p, "coordinate"]),
              };
            },
          ),
          routes: array(document.routes, [...path, "routes"]).map(
            (value, index) => {
              const p = [...path, "routes", index];
              const route = object(value, p);
              const start = object(route.start, [...p, "start"]);
              exactKeys(start, ["terminal", "junction"], [...p, "start"]);
              return {
                ...route,
                start: decodeEndpoint(start, [...p, "start"]),
                legs: array(route.legs, [...p, "legs"]).map((value, index) => {
                  const lp = [...p, "legs", index];
                  const leg = object(value, lp);
                  forbid(leg, ["to"], lp);
                  const { bend, coordinate, terminal, junction, ...rest } = leg;
                  if (bend !== undefined) {
                    if (terminal !== undefined || junction !== undefined)
                      fail(lp, "A bend cannot also be an endpoint");
                    return {
                      ...rest,
                      to: {
                        kind: "bend",
                        bendId: bend,
                        position: point(coordinate, [...lp, "coordinate"]),
                      },
                    };
                  }
                  if (coordinate !== undefined)
                    fail(lp, "A coordinate requires a bend identity");
                  return {
                    ...rest,
                    to: {
                      kind: "endpoint",
                      endpoint: decodeEndpoint(
                        {
                          ...(terminal !== undefined ? { terminal } : {}),
                          ...(junction !== undefined ? { junction } : {}),
                        },
                        lp,
                      ),
                    },
                  };
                }),
              };
            },
          ),
        };
      },
    ),
  };
}
