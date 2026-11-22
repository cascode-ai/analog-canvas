export interface ComponentInterfaceIssue {
  readonly path: (string | number)[];
  readonly message: string;
}

/** Shared electrical invariants, independent of artwork and host schemas. */
interface ComponentInterface {
  readonly symbol: {
    readonly id: string;
    readonly pins: readonly { readonly name: string }[];
  };
  readonly electrical?:
    | { readonly symbolId: string; readonly pinOrder: readonly string[] }
    | null
    | undefined;
  readonly subcircuit?:
    | {
        readonly symbolId: string;
        readonly ports: readonly {
          readonly name: string;
          readonly pinName?: string | undefined;
          readonly supply?: "VDD" | "VSS" | undefined;
        }[];
      }
    | undefined;
}

/** The variant that draws a symbol's optional supply pins (#1833). */
export const SUPPLY_PINS_VARIANT_ID = "supply-pins";

/**
 * The variants of a fully differential op-amp that draw its VOCM pin
 * (#2443): alone, and with the supply pins.
 */
export const VOCM_PIN_VARIANT_ID = "vocm-pin";
const SUPPLY_VOCM_PINS_VARIANT_ID = "supply-vocm-pins";

/** The variant drawing the supply pins and VOCM as asked, or the default. */
export function optionalPinsVariantId(
  supplyPins: boolean,
  vocmPin: boolean,
): string | null {
  return vocmPin
    ? supplyPins
      ? SUPPLY_VOCM_PINS_VARIANT_ID
      : VOCM_PIN_VARIANT_ID
    : supplyPins
      ? SUPPLY_PINS_VARIANT_ID
      : null;
}

/** Whether a variant draws the supply pins. */
export function variantDrawsSupplyPins(variantId: string | undefined): boolean {
  return (
    variantId === SUPPLY_PINS_VARIANT_ID ||
    variantId === SUPPLY_VOCM_PINS_VARIANT_ID
  );
}

/** Whether a variant draws VOCM. */
export function variantDrawsVocmPin(variantId: string | undefined): boolean {
  return (
    variantId === VOCM_PIN_VARIANT_ID ||
    variantId === SUPPLY_VOCM_PINS_VARIANT_ID
  );
}

/**
 * The roles of pins a drawing shows on request: supplies (#1833) and a fully
 * differential op-amp's VOCM (#2443).
 */
const OPTIONAL_SUPPLY_PIN_ROLES: ReadonlySet<string> = new Set([
  "positive-supply",
  "negative-supply",
  "common-mode-input",
]);

/**
 * A pin a symbol draws only on request: a supply or VOCM role its default
 * variant hides. A supply draws the supply port of its name; left unwired,
 * shown or hidden, that supply takes its Net in Properties or Auto. An
 * unwired VOCM leaves the call, and the op-amp's `vocm` sets the level.
 */
export function isOptionalSupplyPin(
  symbol: {
    readonly variants: readonly {
      readonly id: string;
      readonly hiddenPinNames: readonly string[];
    }[];
    readonly defaultVariantId?: string | undefined;
  },
  pin: { readonly name: string; readonly role: string },
): boolean {
  return (
    OPTIONAL_SUPPLY_PIN_ROLES.has(pin.role) &&
    (symbol.variants
      .find((variant) => variant.id === symbol.defaultVariantId)
      ?.hiddenPinNames.includes(pin.name) ??
      false)
  );
}

export function componentInterfaceIssues(
  definition: ComponentInterface,
): ComponentInterfaceIssue[] {
  const issues: ComponentInterfaceIssue[] = [];
  const pins = new Set(definition.symbol.pins.map((pin) => pin.name));
  if (pins.size !== definition.symbol.pins.length)
    issues.push({
      path: ["symbol", "pins"],
      message: "Duplicate Symbol pin names",
    });
  for (const key of ["electrical", "subcircuit"] as const) {
    const contract = definition[key];
    if (contract && contract.symbolId !== definition.symbol.id)
      issues.push({
        path: [key, "symbolId"],
        message: "Electrical and visual Symbol identities must agree",
      });
  }
  if (definition.electrical && definition.subcircuit)
    issues.push({
      path: ["subcircuit"],
      message: "A component cannot be both a primitive and a subcircuit",
    });
  const ordered = definition.electrical?.pinOrder;
  if (
    ordered &&
    (new Set(ordered).size !== ordered.length ||
      ordered.length !== pins.size ||
      ordered.some((pin) => !pins.has(pin)))
  )
    issues.push({
      path: ["electrical", "pinOrder"],
      message: "Electrical pinOrder must name each Symbol pin exactly once",
    });
  if (!definition.subcircuit) return issues;
  const names = new Set<string>();
  // A Symbol pin named after a supply, and mapped by no port, draws that
  // supply's ports (#1833); ports of one supply meet one Net, so they share
  // it. A pin a port maps stays that port's, beside a supply of its name.
  const named = new Set(
    definition.subcircuit.ports.flatMap((port) =>
      port.pinName === undefined ? [] : [port.pinName],
    ),
  );
  const mapped = new Set<string>(
    definition.subcircuit.ports.flatMap((port) =>
      port.pinName === undefined &&
      port.supply &&
      pins.has(port.supply) &&
      !named.has(port.supply)
        ? [port.supply]
        : [],
    ),
  );
  for (const [index, port] of definition.subcircuit.ports.entries()) {
    const name = port.name.toLowerCase();
    if (names.has(name))
      issues.push({
        path: ["subcircuit", "ports", index, "name"],
        message: `Duplicate subcircuit port name: ${port.name}`,
      });
    names.add(name);
    if ((port.pinName !== undefined) === (port.supply !== undefined))
      issues.push({
        path: ["subcircuit", "ports", index],
        message: `Port ${port.name} must map one Symbol pin or one supply`,
      });
    if (port.pinName === undefined) continue;
    if (!pins.has(port.pinName))
      issues.push({
        path: ["subcircuit", "ports", index, "pinName"],
        message: `Subcircuit port references an unknown Symbol pin: ${port.pinName}`,
      });
    if (mapped.has(port.pinName))
      issues.push({
        path: ["subcircuit", "ports", index, "pinName"],
        message: `Subcircuit ports map duplicate Symbol pin: ${port.pinName}`,
      });
    mapped.add(port.pinName);
  }
  const missing = [...pins].filter((pin) => !mapped.has(pin));
  if (missing.length)
    issues.push({
      path: ["subcircuit", "ports"],
      message: `Subcircuit ports must map every Symbol pin exactly once; missing ${missing.join(", ")}`,
    });
  return issues;
}
