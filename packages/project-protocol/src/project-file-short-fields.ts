import { ProjectFormatError } from "./diagnostics.js";

export const SHORT_FIELDS_FILE_VERSION = 83;

type FileObject = Record<string, unknown>;
type Path = readonly (string | number)[];

function isObject(value: unknown): value is FileObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visitObjects(
  value: unknown,
  path: Path,
  visit: (object: FileObject, path: Path) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (isObject(item)) visit(item, [...path, index]);
  });
}

function convertTuple(
  owner: FileObject,
  field: string,
  keys: readonly string[],
  path: Path,
  decode: boolean,
): void {
  const value = owner[field];
  if (!decode) {
    if (isObject(value)) owner[field] = keys.map((key) => value[key]);
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length !== keys.length ||
    !value.every(Number.isFinite)
  )
    throw new ProjectFormatError([
      {
        code: "INVALID_PROJECT",
        path: [...path, field],
        message: `Expected numeric [${keys.join(", ")}]`,
      },
    ]);
  owner[field] = Object.fromEntries(
    keys.map((key, index) => [key, value[index]]),
  );
}

/** Visit only the SourceSpan owners and captured Symbol fields of a Project. */
export function transformShortProjectFields(
  project: FileObject,
  decode: boolean,
): void {
  function sourceSpan(owner: unknown, path: Path): void {
    if (!isObject(owner) || !isObject(owner.sourceRef)) return;
    const spanPath = [...path, "sourceRef"];
    for (const end of ["start", "end"])
      convertTuple(
        owner.sourceRef,
        end,
        ["offset", "line", "column"],
        spanPath,
        decode,
      );
  }

  visitObjects(project.documents, ["documents"], (document, path) => {
    for (const field of ["layoutGroups", "constraints", "noConnects"]) {
      const value = document[field];
      if (decode && !Object.hasOwn(document, field)) document[field] = [];
      if (!decode && Array.isArray(value) && value.length === 0)
        delete document[field];
    }
    sourceSpan(document.sourceBinding, [...path, "sourceBinding"]);
    visitObjects(document.instances, [...path, "instances"], sourceSpan);
    visitObjects(
      document.connectivityEvidence,
      [...path, "connectivityEvidence"],
      (evidence, evidencePath) => {
        if (evidence.kind === "spice-source")
          sourceSpan(evidence, evidencePath);
      },
    );
  });

  function pin(pin: FileObject, path: Path): void {
    convertTuple(pin, "at", ["x", "y"], path, decode);
    if (isObject(pin.routing) && Object.hasOwn(pin.routing, "preferredLanding"))
      convertTuple(
        pin.routing,
        "preferredLanding",
        ["x", "y"],
        [...path, "routing"],
        decode,
      );
  }

  function primitive(primitive: FileObject, path: Path): void {
    if (primitive.kind === "line") {
      convertTuple(primitive, "from", ["x", "y"], path, decode);
      convertTuple(primitive, "to", ["x", "y"], path, decode);
    }
    if (primitive.kind === "circle")
      convertTuple(primitive, "center", ["x", "y"], path, decode);
  }

  visitObjects(
    project.componentDefinitions,
    ["componentDefinitions"],
    (definition, path) => {
      const symbol = definition.symbol;
      if (!isObject(symbol)) return;
      const symbolPath = [...path, "symbol"];
      visitObjects(symbol.pins, [...symbolPath, "pins"], pin);
      visitObjects(symbol.primitives, [...symbolPath, "primitives"], primitive);
      visitObjects(
        symbol.variants,
        [...symbolPath, "variants"],
        (variant, variantPath) => {
          visitObjects(
            variant.auxiliaryPins,
            [...variantPath, "auxiliaryPins"],
            pin,
          );
          visitObjects(
            variant.additionalPrimitives,
            [...variantPath, "additionalPrimitives"],
            primitive,
          );
        },
      );
    },
  );
}
