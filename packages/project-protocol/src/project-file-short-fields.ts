import { ProjectFormatError } from "./diagnostics.js";

export const SHORT_FIELDS_FILE_VERSION = 83;

type FileObject = Record<string, unknown>;
type Path = readonly (string | number)[];

function isObject(value: unknown): value is FileObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodePointTuple(
  value: unknown,
  path: Path,
  field: string,
): FileObject {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw new ProjectFormatError([
      {
        code: "INVALID_PROJECT",
        path: [...path, field],
        message: "Expected numeric [x, y]",
      },
    ]);
  }
  return { x: value[0], y: value[1] };
}

function decodeSpanEndTuple(
  value: unknown,
  path: Path,
  field: string,
): FileObject {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    !Number.isFinite(value[2])
  ) {
    throw new ProjectFormatError([
      {
        code: "INVALID_PROJECT",
        path: [...path, field],
        message: "Expected numeric [offset, line, column]",
      },
    ]);
  }
  return { offset: value[0], line: value[1], column: value[2] };
}

function encodePointTuple(value: unknown): unknown {
  return isObject(value) ? [value.x, value.y] : value;
}

function encodeSpanEndTuple(value: unknown): unknown {
  return isObject(value) ? [value.offset, value.line, value.column] : value;
}

function encodeSourceSpanCow(owner: unknown): unknown {
  if (!isObject(owner) || !isObject(owner.sourceRef)) return owner;
  const ref = owner.sourceRef;
  const nextStart = encodeSpanEndTuple(ref.start);
  const nextEnd = encodeSpanEndTuple(ref.end);
  if (nextStart === ref.start && nextEnd === ref.end) return owner;
  return {
    ...owner,
    sourceRef: { ...ref, start: nextStart, end: nextEnd },
  };
}

function decodeSourceSpanInPlace(owner: unknown, path: Path): void {
  if (!isObject(owner) || !isObject(owner.sourceRef)) return;
  const spanPath = [...path, "sourceRef"];
  owner.sourceRef.start = decodeSpanEndTuple(
    owner.sourceRef.start,
    spanPath,
    "start",
  );
  owner.sourceRef.end = decodeSpanEndTuple(
    owner.sourceRef.end,
    spanPath,
    "end",
  );
}

function encodePinCow(pin: unknown): unknown {
  if (!isObject(pin)) return pin;
  const nextAt = encodePointTuple(pin.at);
  let nextRouting = pin.routing;
  if (isObject(pin.routing) && Object.hasOwn(pin.routing, "preferredLanding")) {
    const nextLanding = encodePointTuple(pin.routing.preferredLanding);
    if (nextLanding !== pin.routing.preferredLanding) {
      nextRouting = { ...pin.routing, preferredLanding: nextLanding };
    }
  }
  if (nextAt === pin.at && nextRouting === pin.routing) return pin;
  return {
    ...pin,
    at: nextAt,
    ...(nextRouting !== pin.routing ? { routing: nextRouting } : {}),
  };
}

function decodePinInPlace(pin: unknown, path: Path): void {
  if (!isObject(pin)) return;
  pin.at = decodePointTuple(pin.at, path, "at");
  if (isObject(pin.routing) && Object.hasOwn(pin.routing, "preferredLanding")) {
    pin.routing.preferredLanding = decodePointTuple(
      pin.routing.preferredLanding,
      [...path, "routing"],
      "preferredLanding",
    );
  }
}

function encodePrimitiveCow(primitive: unknown): unknown {
  if (!isObject(primitive)) return primitive;
  if (primitive.kind === "line") {
    const nextFrom = encodePointTuple(primitive.from);
    const nextTo = encodePointTuple(primitive.to);
    if (nextFrom === primitive.from && nextTo === primitive.to)
      return primitive;
    return { ...primitive, from: nextFrom, to: nextTo };
  }
  if (primitive.kind === "circle") {
    const nextCenter = encodePointTuple(primitive.center);
    if (nextCenter === primitive.center) return primitive;
    return { ...primitive, center: nextCenter };
  }
  return primitive;
}

function decodePrimitiveInPlace(primitive: unknown, path: Path): void {
  if (!isObject(primitive)) return;
  if (primitive.kind === "line") {
    primitive.from = decodePointTuple(primitive.from, path, "from");
    primitive.to = decodePointTuple(primitive.to, path, "to");
  } else if (primitive.kind === "circle") {
    primitive.center = decodePointTuple(primitive.center, path, "center");
  }
}

function mapCow(
  items: unknown,
  transform: (item: unknown) => unknown,
): unknown {
  if (!Array.isArray(items)) return items;
  let copy: unknown[] | undefined;
  for (let i = 0; i < items.length; i += 1) {
    const next = transform(items[i]);
    if (next !== items[i]) {
      copy ??= items.slice();
      copy[i] = next;
    }
  }
  return copy ?? items;
}

/** Visit only the SourceSpan owners and captured Symbol fields of a Project. */
export function transformShortProjectFields(
  project: FileObject,
  decode: boolean,
): void {
  if (decode) {
    if (Array.isArray(project.documents)) {
      for (let i = 0; i < project.documents.length; i += 1) {
        const document = project.documents[i];
        if (!isObject(document)) continue;
        const path: Path = ["documents", i];
        for (const field of ["layoutGroups", "constraints", "noConnects"]) {
          if (!Object.hasOwn(document, field)) document[field] = [];
        }
        decodeSourceSpanInPlace(document.sourceBinding, [
          ...path,
          "sourceBinding",
        ]);
        if (Array.isArray(document.instances)) {
          for (let j = 0; j < document.instances.length; j += 1) {
            const instance = document.instances[j];
            if (isObject(instance) && isObject(instance.sourceRef)) {
              decodeSourceSpanInPlace(instance, [...path, "instances", j]);
            }
          }
        }
        if (Array.isArray(document.connectivityEvidence)) {
          for (let j = 0; j < document.connectivityEvidence.length; j += 1) {
            const evidence = document.connectivityEvidence[j];
            if (isObject(evidence) && evidence.kind === "spice-source") {
              decodeSourceSpanInPlace(evidence, [
                ...path,
                "connectivityEvidence",
                j,
              ]);
            }
          }
        }
      }
    }
    if (Array.isArray(project.componentDefinitions)) {
      for (let i = 0; i < project.componentDefinitions.length; i += 1) {
        const definition = project.componentDefinitions[i];
        if (!isObject(definition) || !isObject(definition.symbol)) continue;
        const symbol = definition.symbol;
        const symbolPath: Path = ["componentDefinitions", i, "symbol"];
        if (Array.isArray(symbol.pins)) {
          for (let j = 0; j < symbol.pins.length; j += 1) {
            decodePinInPlace(symbol.pins[j], [...symbolPath, "pins", j]);
          }
        }
        if (Array.isArray(symbol.primitives)) {
          for (let j = 0; j < symbol.primitives.length; j += 1) {
            decodePrimitiveInPlace(symbol.primitives[j], [
              ...symbolPath,
              "primitives",
              j,
            ]);
          }
        }
        if (Array.isArray(symbol.variants)) {
          for (let v = 0; v < symbol.variants.length; v += 1) {
            const variant = symbol.variants[v];
            if (!isObject(variant)) continue;
            const variantPath = [...symbolPath, "variants", v];
            if (Array.isArray(variant.auxiliaryPins)) {
              for (let j = 0; j < variant.auxiliaryPins.length; j += 1) {
                decodePinInPlace(variant.auxiliaryPins[j], [
                  ...variantPath,
                  "auxiliaryPins",
                  j,
                ]);
              }
            }
            if (Array.isArray(variant.additionalPrimitives)) {
              for (let j = 0; j < variant.additionalPrimitives.length; j += 1) {
                decodePrimitiveInPlace(variant.additionalPrimitives[j], [
                  ...variantPath,
                  "additionalPrimitives",
                  j,
                ]);
              }
            }
          }
        }
      }
    }
    return;
  }

  // Encode path: copy-on-write for any fields that may be shared with frozen input.
  if (Array.isArray(project.documents)) {
    for (const document of project.documents) {
      if (!isObject(document)) continue;
      for (const field of ["layoutGroups", "constraints", "noConnects"]) {
        const value = document[field];
        if (Array.isArray(value) && value.length === 0) delete document[field];
      }
      if (document.sourceBinding !== undefined) {
        document.sourceBinding = encodeSourceSpanCow(document.sourceBinding);
      }
      if (Array.isArray(document.instances)) {
        for (let i = 0; i < document.instances.length; i += 1) {
          const instance = document.instances[i];
          if (isObject(instance) && isObject(instance.sourceRef)) {
            document.instances[i] = encodeSourceSpanCow(instance);
          }
        }
      }
      if (Array.isArray(document.connectivityEvidence)) {
        document.connectivityEvidence = mapCow(
          document.connectivityEvidence,
          (evidence) =>
            isObject(evidence) && evidence.kind === "spice-source"
              ? encodeSourceSpanCow(evidence)
              : evidence,
        );
      }
    }
  }

  if (Array.isArray(project.componentDefinitions)) {
    project.componentDefinitions = mapCow(
      project.componentDefinitions,
      (definition) => {
        if (!isObject(definition) || !isObject(definition.symbol))
          return definition;
        const symbol = definition.symbol;
        const nextPins = mapCow(symbol.pins, encodePinCow);
        const nextPrimitives = mapCow(symbol.primitives, encodePrimitiveCow);
        const nextVariants = mapCow(symbol.variants, (variant) => {
          if (!isObject(variant)) return variant;
          const nextAux = mapCow(variant.auxiliaryPins, encodePinCow);
          const nextAdd = mapCow(
            variant.additionalPrimitives,
            encodePrimitiveCow,
          );
          if (
            nextAux === variant.auxiliaryPins &&
            nextAdd === variant.additionalPrimitives
          )
            return variant;
          return {
            ...variant,
            ...(nextAux !== variant.auxiliaryPins
              ? { auxiliaryPins: nextAux }
              : {}),
            ...(nextAdd !== variant.additionalPrimitives
              ? { additionalPrimitives: nextAdd }
              : {}),
          };
        });
        if (
          nextPins === symbol.pins &&
          nextPrimitives === symbol.primitives &&
          nextVariants === symbol.variants
        )
          return definition;
        return {
          ...definition,
          symbol: {
            ...symbol,
            ...(nextPins !== symbol.pins ? { pins: nextPins } : {}),
            ...(nextPrimitives !== symbol.primitives
              ? { primitives: nextPrimitives }
              : {}),
            ...(nextVariants !== symbol.variants
              ? { variants: nextVariants }
              : {}),
          },
        };
      },
    );
  }
}
