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
  const mapped = new Set<string>();
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
