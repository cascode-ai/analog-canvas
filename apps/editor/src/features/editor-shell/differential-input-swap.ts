import type { SchematicEdit } from "@icm/edit-engine";

/**
 * Every polarity-marked amplifier ships beside an input-swapped sibling that
 * differs only in where its two marks sit and which input pin each one names.
 * Swapping inputs exchanges the two Symbols.
 *
 * Reflecting the Instance top to bottom would be shorter, and it is what this
 * used to do, but a reflection cannot tell the marks apart from the rest of
 * the drawing: it turns a comparator's transfer-characteristic glyph upside
 * down, exchanges a differential amplifier's outputs along with its inputs,
 * and flips the reference designator with the body. The exchange touches
 * exactly what the action names, and the pin names are identical on both
 * sides, so every attached Net survives it.
 */
const INPUT_SWAP_SUFFIX = "-inputs-swapped";
const INPUT_SWAP_SOURCES = [
  "opamp",
  "comparator",
  "opamp-differential",
  "opamp-differential-crossed",
] as const;

export function differentialInputSibling(symbolId: string): string | undefined {
  if (symbolId.endsWith(INPUT_SWAP_SUFFIX)) {
    const source = symbolId.slice(0, -INPUT_SWAP_SUFFIX.length);
    return INPUT_SWAP_SOURCES.some((candidate) => candidate === source)
      ? source
      : undefined;
  }
  return INPUT_SWAP_SOURCES.some((candidate) => candidate === symbolId)
    ? `${symbolId}${INPUT_SWAP_SUFFIX}`
    : undefined;
}

export function planDifferentialInputSwap(
  instanceId: string,
  symbolId: string,
): SchematicEdit[] {
  const sibling = differentialInputSibling(symbolId);
  return sibling
    ? [{ kind: "set_instance_symbol", instanceId, symbolId: sibling }]
    : [];
}
