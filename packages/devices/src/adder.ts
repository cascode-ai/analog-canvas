import type { DeviceParameterDefinition } from "./contract.js";

/**
 * The signal-flow adder, Y = ±A ± B: the one table every package that treats
 * it apart reads. Its parameters carry each input's sign, its call names the
 * body the signs choose, and its Instance draws the signs beside its inputs
 * once one subtracts.
 */

/** The adder's Symbol: an Instance of it marks its inputs' signs. */
export const ADDER_SYMBOL_ID = "adder";

/** The built-in target an adder calls; also its body that adds both inputs. */
export const ADDER_TARGET = "adder";

/** A summing input's sign: `+` adds the input, `-` subtracts it. */
export type InputSign = "+" | "-";

/**
 * The minus sign, U+2212, as typeset text and #1324 spell it. A sign typed
 * so means `-`, and is stored as `-`.
 */
export const UNICODE_MINUS = "\u2212";

/**
 * The adder's inputs, each with the parameter that signs it. The signs are
 * choices, not SPICE parameters: export reads them to pick the adder's body
 * and writes none of them on the call, and the drawing marks each input with
 * its sign once one subtracts.
 */
export const ADDER_SIGNED_INPUTS = [
  { pinName: "A", parameter: "signA" },
  { pinName: "B", parameter: "signB" },
] as const;

/** The sign choices Properties shows and an Agent sets, both + at first. */
export const ADDER_SIGN_PARAMETERS: readonly DeviceParameterDefinition[] =
  ADDER_SIGNED_INPUTS.map(({ pinName, parameter: name }) => ({
    name,
    label: `Input ${pinName} sign`,
    defaultValue: "+",
    help: `+ adds input ${pinName} and - subtracts it: Y = ±A ± B.`,
    placeholder: "+",
    required: false,
    editor: "select",
    options: [
      { value: "+", label: "+" },
      { value: "-", label: "−", spellings: [UNICODE_MINUS] },
    ],
    displayRole: "none",
  }));

/**
 * The adder's bodies, one per pattern of input signs in pin order, each
 * named after the inputs it subtracts: V(Y) = ±V(A) ± V(B). Both inputs
 * adding is the plain adder, so a drawing whose adders all add exports as
 * it always has.
 */
export const ADDER_BODIES = [
  { name: ADDER_TARGET, signs: ["+", "+"] },
  { name: "adder_minus_a", signs: ["-", "+"] },
  { name: "adder_minus_b", signs: ["+", "-"] },
  { name: "adder_minus_ab", signs: ["-", "-"] },
] as const satisfies readonly {
  readonly name: string;
  readonly signs: readonly [InputSign, InputSign];
}[];

/** A sign as typed: `+`, or `-` in ASCII or as the Unicode minus. */
export function readInputSign(value: string): InputSign | null {
  const text = value.trim();
  if (text === "+") return "+";
  return text === "-" || text === UNICODE_MINUS ? "-" : null;
}

/**
 * The sign each adder input carries, in pin order, read as export reads it.
 * A missing parameter adds, as on every adder drawn before signs existed;
 * a value that is no sign reads as null, for the caller to refuse.
 */
export function adderInputSigns(
  parameters: Readonly<Record<string, string>> | undefined,
): readonly {
  readonly pinName: (typeof ADDER_SIGNED_INPUTS)[number]["pinName"];
  readonly parameter: string;
  readonly sign: InputSign | null;
}[] {
  return ADDER_SIGNED_INPUTS.map(({ pinName, parameter }) => {
    const authored = Object.entries(parameters ?? {}).find(
      ([name]) => name.toLowerCase() === parameter.toLowerCase(),
    );
    return {
      pinName,
      parameter: authored?.[0] ?? parameter,
      sign: authored ? readInputSign(authored[1]) : "+",
    };
  });
}

/** The body an adder whose inputs carry these signs, in pin order, calls. */
export function adderBodyFor(
  signs: readonly InputSign[],
): (typeof ADDER_BODIES)[number]["name"] {
  const body = ADDER_BODIES.find(
    (candidate) =>
      candidate.signs.length === signs.length &&
      candidate.signs.every((sign, index) => sign === signs[index]),
  );
  if (!body) throw new Error(`No adder body adds ${signs.join(" ")}`);
  return body.name;
}

/**
 * The signs the generated adder body of this name applies, in pin order;
 * undefined for any other name. The name matches as a call spells it.
 */
export function adderBodySigns(
  name: string,
): readonly [InputSign, InputSign] | undefined {
  return ADDER_BODIES.find((body) => body.name === name)?.signs;
}
