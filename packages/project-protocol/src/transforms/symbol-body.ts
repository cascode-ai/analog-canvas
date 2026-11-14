import type {
  CircuitProject,
  SymbolDefinition,
  SymbolPrimitive,
} from "@icm/model";
import { builtInSymbols, createProjectHierarchicalSymbols } from "@icm/symbols";
import { symbolSignature } from "./symbol-signature.js";

// Exact shipped pre-fill definitions at 84a7e621. Supply and polarity repair
// runs first, so an older compatible form can reach one of these snapshots.
const LEGACY_REVIEWED_BODIES = new Set([
  "body-fill-v2-658e07ab5d2ec491",
  "body-fill-v2-f331f7a309cb0c04",
  "body-fill-v2-6f35786d9baab5c0",
  "body-fill-v2-7ddca074d601a173",
  "body-fill-v2-b39a99f62d16fc46",
  "body-fill-v2-95b3719db10f2572",
  "body-fill-v2-43727d20e564f67b",
  "body-fill-v2-b3bfc794b40c2ac4",
  "body-fill-v2-4d1b277c5b166eb4",
  "body-fill-v2-4e9290ffd50317c5",
  "body-fill-v2-05b2ae40fd98b875",
  "body-fill-v2-3e6714bc9622cef3",
  "body-fill-v2-403e3499368fa857",
  "body-fill-v2-032bedd965451f25",
  "body-fill-v2-20955b8f0ecd4ef0",
  "body-fill-v2-874ca9a00dbd8dbf",
  "body-fill-v2-df9b14f86df02973",
  "body-fill-v2-8b58c38b5679b9bb",
  "body-fill-v2-07b62fd6e654cf1b",
  "body-fill-v2-20e8521c1c05876e",
  "body-fill-v2-27127ced519ad6e7",
  "body-fill-v2-8ec472444ba762b2",
  "body-fill-v2-940ee16e436c0f81",
  "body-fill-v2-2346987aa4abbe14",
  "body-fill-v2-382ea24a590cb9f1",
  "body-fill-v2-9ca4227ee182c963",
  "body-fill-v2-e28a41ec82dabd9f",
  "body-fill-v2-7ef0105c62dfe8ad",
  "body-fill-v2-976a443f4fd87429",
  "body-fill-v2-2608f4af037e7f29",
  "body-fill-v2-279a9e77e8bba910",
  "body-fill-v2-3e9c08eb2cd1879a",
  "body-fill-v2-94ec11e3d7c54083",
  "body-fill-v2-2bca3a93349127be",
  "body-fill-v2-7d849efc6bcf6132",
  "body-fill-v2-10b43b739d2e5654",
  "body-fill-v2-dcf72cc419374f26",
  "body-fill-v2-f7e13ddbdcdd1e5e",
  "body-fill-v2-a15bbf65f2474e3d",
  "body-fill-v2-2a179dfa5d2f9533",
  "body-fill-v2-4bf0af9d8054b7f0",
  "body-fill-v2-738ff99a0951c5cc",
  "body-fill-v2-38858c9dab8c69ac",
  "body-fill-v2-a1cb3382789d0d1f",
  "body-fill-v2-fef10c83941fdc79",
  "body-fill-v2-9894462e571be7c8",
  "body-fill-v2-bc5854f3540a0b43",
  "body-fill-v2-8dd819d6338d4af2",
]);
function withoutBodyRole(primitive: SymbolPrimitive): SymbolPrimitive {
  if (!("fillableBody" in primitive)) return primitive;
  const { fillableBody: _role, ...unmarked } = primitive;
  return unmarked;
}

const reviewedBodies = new Map(
  builtInSymbols.flatMap((symbol) => {
    if (!symbol.primitives.some((p) => "fillableBody" in p && p.fillableBody))
      return [];
    const legacy = {
      ...symbol,
      primitives: symbol.primitives.map((primitive) => {
        const unmarked = withoutBodyRole(primitive);
        // Schema 81's quantizer frame had identical ink without measured bounds.
        if (
          symbol.id !== "quantizer" ||
          unmarked.kind !== "path" ||
          unmarked.part !== "body"
        )
          return unmarked;
        const { bounds: _measurement, ...original } = unmarked;
        return original;
      }),
      variants: symbol.variants.map((variant) =>
        variant.additionalPrimitives
          ? {
              ...variant,
              additionalPrimitives:
                variant.additionalPrimitives.map(withoutBodyRole),
            }
          : variant,
      ),
    };
    const signature = symbolSignature("body-fill-v2", legacy);
    return LEGACY_REVIEWED_BODIES.has(signature)
      ? [[symbol.id, { symbol, signature }] as const]
      : [];
  }),
);

function withBodyRole(
  old: SymbolPrimitive,
  current: SymbolPrimitive | undefined,
): SymbolPrimitive {
  if (!current || !("fillableBody" in current) || !current.fillableBody)
    return old;
  if (old.kind === "polygon" || old.kind === "circle" || old.kind === "path")
    return { ...old, fillableBody: true };
  return old;
}

/** The old generated rectangle must match the same Cell/source geometry. */
function withAutomaticBody(
  symbol: SymbolDefinition,
  current: SymbolDefinition,
): SymbolDefinition {
  const [frame, ...other] = current.primitives;
  if (frame?.kind !== "polygon" || !frame.fillableBody) return symbol;
  const { fillableBody: _role, ...unmarked } = frame;
  const legacy = { ...current, primitives: [unmarked, ...other] };
  if (
    symbolSignature("cell-frame", symbol) !==
    symbolSignature("cell-frame", legacy)
  )
    return symbol;
  return { ...symbol, primitives: [frame, ...symbol.primitives.slice(1)] };
}

function withReviewedBody(symbol: SymbolDefinition): SymbolDefinition {
  const reviewed = reviewedBodies.get(symbol.id);
  if (
    !reviewed ||
    symbolSignature("body-fill-v2", symbol) !== reviewed.signature
  )
    return symbol;
  const current = reviewed.symbol;
  return {
    ...symbol,
    primitives: symbol.primitives.map((primitive, index) =>
      withBodyRole(primitive, current.primitives[index]),
    ),
    variants: symbol.variants.map((variant, index) =>
      variant.additionalPrimitives
        ? {
            ...variant,
            additionalPrimitives: variant.additionalPrimitives.map(
              (primitive, item) =>
                withBodyRole(
                  primitive,
                  current.variants[index]?.additionalPrimitives?.[item],
                ),
            ),
          }
        : variant,
    ),
  };
}

export function repairSymbolBodySnapshots(
  project: CircuitProject,
): CircuitProject {
  const captures = project.componentDefinitions;
  if (!captures?.length) return project;
  let generated: ReadonlyMap<string, SymbolDefinition> | undefined;
  const repaired = captures.map((definition) => {
    const { symbol, generatedFrom } = definition;
    if (definition.circuitBinding || definition.libraryOrigin)
      return definition;
    let next = symbol;
    if (!generatedFrom) next = withReviewedBody(symbol);
    else if (
      symbol.hierarchicalBlock &&
      !generatedFrom.presentation?.artwork &&
      !symbol.primitives.some((p) => "fillableBody" in p && p.fillableBody)
    ) {
      generated ??= new Map(
        createProjectHierarchicalSymbols(project, builtInSymbols).map((s) => [
          s.id,
          s,
        ]),
      );
      const current = generated.get(symbol.id);
      if (current) next = withAutomaticBody(symbol, current);
    }
    return next === symbol ? definition : { ...definition, symbol: next };
  });
  return repaired.some((definition, index) => definition !== captures[index])
    ? { ...project, componentDefinitions: repaired }
    : project;
}
