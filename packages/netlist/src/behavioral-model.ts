/** Small compiler-owned model recipe, not a parser or a user modeling language. */
export type BehavioralElement =
  | {
      kind: "voltage";
      name: string;
      nodes: readonly [string, string];
      expression: string;
    }
  | {
      kind: "current";
      name: string;
      nodes: readonly [string, string];
      expression: string;
    }
  | {
      kind: "resistor" | "capacitor";
      name: string;
      nodes: readonly [string, string];
      value: string;
      expression?: boolean;
    };

export interface BehavioralModel {
  name: string;
  ports: readonly string[];
  parameters: readonly { name: string; defaultValue: string }[];
  comment?: string;
  elements: readonly BehavioralElement[];
}

export function voltage(
  name: string,
  positive: string,
  negative: string,
  expression: string,
): BehavioralElement {
  return { kind: "voltage", name, nodes: [positive, negative], expression };
}
export function current(
  name: string,
  positive: string,
  negative: string,
  expression: string,
): BehavioralElement {
  return { kind: "current", name, nodes: [positive, negative], expression };
}
export function passive(
  kind: "resistor" | "capacitor",
  name: string,
  positive: string,
  negative: string,
  value: string,
  expression = false,
): BehavioralElement {
  return { kind, name, nodes: [positive, negative], value, expression };
}

export function printSpiceBehavioralModel(model: BehavioralModel): string[] {
  return [
    ...(model.comment ? [`* ${model.comment}`] : []),
    `.subckt ${model.name} ${model.ports.join(" ")} params: ${model.parameters.map((p) => `${p.name}=${p.defaultValue}`).join(" ")}`,
    ...model.elements.map((element) => {
      const prefix = `${element.name} ${element.nodes.join(" ")}`;
      return element.kind === "voltage" || element.kind === "current"
        ? `${prefix} ${element.kind === "voltage" ? "V" : "I"}={${element.expression}}`
        : `${prefix} ${element.expression ? `{${element.value}}` : element.value}`;
    }),
    `.ends ${model.name}`,
  ];
}

/** Native Spectre syntax, projected from the same nodes/equations/defaults. */
export function printSpectreBehavioralModel(model: BehavioralModel): string[] {
  return [
    ...(model.comment ? [`// ${model.comment}`] : []),
    `subckt ${model.name} (${model.ports.join(" ")})`,
    ...(model.parameters.length
      ? [
          `parameters ${model.parameters.map((p) => `${p.name}=${p.defaultValue}`).join(" ")}`,
        ]
      : []),
    ...model.elements.map((element) => {
      const prefix = `${element.name} (${element.nodes.join(" ")})`;
      return element.kind === "voltage" || element.kind === "current"
        ? `${prefix} bsource ${element.kind === "voltage" ? "v" : "i"}=${projectBehavioralExpression(element.expression, (value) => value)}`
        : `${prefix} ${element.kind} ${element.kind === "capacitor" ? "c" : "r"}=${element.value}`;
    }),
    `ends ${model.name}`,
  ];
}

/** Translate only the reviewed expression notation; never parse device cards. */
export function projectBehavioralExpression(
  raw: string,
  scalar: (raw: string) => string,
): string {
  const accesses: string[] = [];
  const protectedExpression = raw.replace(
    /V\(([^()]+)\)/gu,
    (_, nodes: string) => {
      const index = accesses.push(`v(${nodes})`) - 1;
      return `__access${index}`;
    },
  );
  return scalar(protectedExpression).replace(
    /__access(\d+)/gu,
    (_, index: string) => accesses[Number(index)]!,
  );
}
