import { describe, expect, it } from "vitest";
import {
  ActionCompileError,
  compileActions,
  describeCallSplit,
  directConnectIntent,
  splitIntoCalls,
  type CompiledTransaction,
} from "./authoring-helper.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";
import type { AgentSessionSnapshot } from "./schema.js";
import { AuthoringActionSchema } from "./authoring-actions.js";
import { z } from "zod";
import { defaultDraftTextDocument } from "@icm/model";

let idCounter = 0;
const allocateId = (prefix: string) => `${prefix}-alloc-${(idCounter += 1)}`;

it("requires exactly one move coordinate mode and restricts pin anchors to Instances", () => {
  const target = { kind: "instance", id: "M1" };
  const position = { x: 100, y: 100 };
  const pinAnchor = { pinName: "G", position };
  for (const action of [
    { kind: "move", target },
    { kind: "move", target, position, pinAnchor },
    { kind: "move", target: { kind: "annotation", id: "note" }, pinAnchor },
  ])
    expect(AuthoringActionSchema.safeParse(action).success).toBe(false);
  expect(
    AuthoringActionSchema.safeParse({ kind: "move", target, pinAnchor })
      .success,
  ).toBe(true);
  expect(
    AuthoringActionSchema.safeParse({ kind: "move", target, position }).success,
  ).toBe(true);
});

function compile(
  actions: unknown[],
  snapshot: AgentSessionSnapshot = testSnapshot(),
): CompiledTransaction[] {
  return compileActions(actions, {
    snapshot,
    allocateId,
  });
}

function expectCompileError(
  actions: unknown[],
  fragment: string,
  snapshot?: AgentSessionSnapshot,
): void {
  try {
    compile(actions, snapshot);
    expect.unreachable("expected ActionCompileError");
  } catch (error) {
    expect(error).toBeInstanceOf(ActionCompileError);
    expect((error as Error).message).toContain(fragment);
  }
}

it("says which actions go in which call when a list needs several (#1269)", () => {
  const place = (reference: string, x: number) => ({
    kind: "place-component",
    symbol: "resistor",
    reference,
    position: { x, y: 300 },
  });
  const calls = splitIntoCalls(
    compile([
      {
        kind: "add-power-rail",
        start: { x: 0, y: -200 },
        end: { x: 400, y: -200 },
        name: "VDD",
      },
      place("R7", 0),
      place("R8", 100),
      place("R9", 200),
      { kind: "set-model", instanceId: "instance-1", model: "nch" },
      { kind: "set-model", instanceId: "instance-2", model: "rpoly" },
      {
        kind: "connect",
        from: { kind: "pin", instance: "M1", pin: "G" },
        to: { kind: "net", net: "Vout" },
      },
      {
        kind: "move",
        target: { kind: "instance", id: "instance-1" },
        position: { x: 300, y: 100 },
      },
    ]),
  );
  expect(calls).toEqual([
    { actionIndices: [0], actionKinds: ["add-power-rail"], sends: "command" },
    {
      actionIndices: [1, 2, 3],
      actionKinds: ["place-component"],
      sends: "placement batch",
    },
    { actionIndices: [4, 5], actionKinds: ["set-model"], sends: "commands" },
    { actionIndices: [6], actionKinds: ["connect"], sends: "wires" },
    { actionIndices: [7], actionKinds: ["move"], sends: "commands" },
  ]);
  expect(describeCallSplit(calls)).toBe(
    "These actions need 5 calls; one call sends one transaction. Send them " +
      "in this order, each group in its own call: actions[0] (add-power-rail) " +
      "as a command of its own; actions[1..3] (place-component) as one " +
      "placement batch; actions[4..5] (set-model) as commands that share one " +
      "call; actions[6] (connect) as wires that share one call; actions[7] " +
      "(move) as commands that share one call. Nothing was changed.",
  );
});

describe("authoring helper compilation", () => {
  it.each(["vcvs", "vccs", "cccs", "ccvs"])(
    "places %s with canonical controls through native placement",
    (symbol) => {
      const control = symbol.startsWith("v")
        ? { kind: "voltage", positiveNetId: "net-1", negativeNetId: "net-2" }
        : {
            kind: "terminal-current",
            instanceId: "instance-2",
            pinName: "1",
            direction: "out",
          };
      const transaction = compile([
        {
          kind: "place-component",
          symbol,
          reference: "X9",
          position: { x: 100, y: 100 },
          parameters: {
            [symbol === "vccs" ? "gm" : symbol === "ccvs" ? "rm" : "gain"]: "2",
          },
          control,
        },
      ])[0]!;
      expect(transaction.command).toMatchObject({
        kind: "place-components",
        instances: [
          {
            symbolId: symbol,
            netlist: {
              parameters: {
                [symbol === "vccs" ? "gm" : symbol === "ccvs" ? "rm" : "gain"]:
                  "2",
              },
              control,
            },
          },
        ],
      });
    },
  );

  it("sends parameter and control changes for the editor to plan in order", () => {
    const snapshot = testSnapshot();
    const source = snapshot.document.instances[0]!;
    source.symbolId = "cccs";
    source.netlist = {
      binding: { kind: "primitive", deviceClass: "cccs" },
      parameters: { gain: "2", obsolete: "1" },
      control: { kind: "current", sensorInstanceId: "sensor" },
    };
    const before = structuredClone(snapshot);
    const control = {
      kind: "terminal-current",
      instanceId: "instance-2",
      pinName: "1",
      direction: "into",
    };
    const target = { kind: "instance", id: source.id };
    const transactions = compile(
      [
        {
          kind: "set-property",
          target,
          set: { gain: "3" },
          unset: ["obsolete"],
        },
        { kind: "set-source-control", target, control },
        { kind: "set-source-control", target, control: null },
      ],
      snapshot,
    );
    // The editor plans each on the result of the one before, in one batch.
    expect(transactions.map((transaction) => transaction.command)).toEqual([
      {
        kind: "set-properties",
        instanceId: source.id,
        parameters: { set: { gain: "3" }, unset: ["obsolete"] },
      },
      { kind: "set-properties", instanceId: source.id, control },
      { kind: "set-properties", instanceId: source.id, control: null },
    ]);
    expect(snapshot).toEqual(before);
    expect(
      AuthoringActionSchema.safeParse({
        kind: "set-source-control",
        target,
        control: { ...control, direction: "sideways" },
      }).success,
    ).toBe(false);
  });
  it("sends annotate with its text as written, for the Text tool's defaults", () => {
    for (const content of ["Design note", defaultDraftTextDocument("Vx")]) {
      const [transaction] = compile([
        { kind: "annotate", text: content, position: { x: 10, y: 20 } },
      ]);
      expect(transaction?.command).toEqual({
        kind: "add-text",
        id: expect.stringMatching(/^text-alloc-/u),
        position: { x: 10, y: 20 },
        text: content,
      });
    }
  });
  it("sends edit-text on a part's label for the editor's text commit", () => {
    const snapshot = testSnapshot();
    snapshot.document.annotations.push({
      id: "ref",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "instance-1" },
      resolvedText: "M1",
      formatOverride: defaultDraftTextDocument("M1"),
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    expect(
      compile(
        [
          {
            kind: "edit-text",
            target: { kind: "annotation", id: "ref" },
            text: "M1",
          },
        ],
        snapshot,
      )[0]?.command,
    ).toEqual({
      kind: "set-text",
      target: { kind: "annotation", id: "ref" },
      text: "M1",
    });
  });
  it("does not drop route-net when a caller uses the Snapshot-backed compiler", () => {
    const command = {
      kind: "route-net",
      target: { kind: "member", instanceId: "instance-1", pinName: "G" },
    };
    expect(compile([command])).toEqual([
      {
        form: "command",
        command,
        actionKinds: ["route-net"],
        actionIndices: [0],
      },
    ]);
  });
  it.each([
    "simple-switch",
    "spdt-switch",
    "voltage-controlled-switch",
    "differential-transconductance",
    "adc",
    "dac",
  ])(
    "places the reviewed palette part %s, as the GUI palette does (#1303)",
    (symbol) => {
      const command = compile([
        { kind: "place-component", symbol, position: { x: 0, y: 0 } },
      ])[0]!.command;
      expect(command?.kind).toBe("place-components");
      if (command?.kind !== "place-components") return;
      expect(command.instances[0]!.symbolId).toBe(symbol);
    },
  );
  it("names a placed Cell and turns it upright unless told otherwise, as place-component does (#1301)", () => {
    const [placed] = compile([
      {
        kind: "place-cell",
        childDocumentId: "child",
        placement: { position: { x: 100, y: 0 } },
      },
    ]);
    expect(placed!.command).toMatchObject({
      kind: "place-cell",
      childDocumentId: "child",
      instanceId: expect.stringMatching(/^instance-alloc-\d+$/),
      placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    });
    const turned = compile([
      {
        kind: "place-cell",
        childDocumentId: "child",
        instanceId: "cell-1",
        placement: { position: { x: 0, y: 0 }, rotation: 90 },
      },
    ])[0]!.command;
    expect(turned).toMatchObject({
      instanceId: "cell-1",
      placement: { rotation: 90, mirror: "none" },
    });
  });
  it.each(["set-model", "set-display-alias"] as const)(
    "%s takes a target as the other property actions do (#1301)",
    (kind) => {
      const value =
        kind === "set-model" ? { model: "nch" } : { text: "A_1" as string };
      for (const target of [
        { kind: "instance", reference: "M1" },
        { kind: "instance", id: "instance-1" },
      ])
        expect(compile([{ kind, target, ...value }])[0]!.command).toEqual({
          kind,
          instanceId: "instance-1",
          ...value,
        });
      expect(
        AuthoringActionSchema.safeParse({
          kind,
          instanceId: "instance-1",
          target: { kind: "instance", id: "instance-1" },
          ...value,
        }).success,
      ).toBe(false);
      expect(AuthoringActionSchema.safeParse({ kind, ...value }).success).toBe(
        false,
      );
    },
  );
  it("forwards pin anchors to the shared server planner and requires one position form", () => {
    const action = {
      kind: "place-component",
      symbol: "nmos",
      reference: "M2",
      pinAnchor: { pinName: "G", position: { x: 200, y: 100 } },
      mirror: "horizontal",
    };
    const command = compile([action])[0]!.command;
    expect(command?.kind).toBe("place-components");
    if (command?.kind !== "place-components") return;
    expect(command.pinAnchors?.[command.instances[0]!.id]).toEqual(
      action.pinAnchor,
    );
    expect(command.instances[0]!.placement?.mirror).toBe("horizontal");
    expect(
      AuthoringActionSchema.safeParse({ ...action, position: { x: 0, y: 0 } })
        .success,
    ).toBe(false);
    expect(
      AuthoringActionSchema.safeParse({
        kind: "place-component",
        symbol: "nmos",
        reference: "M2",
      }).success,
    ).toBe(false);
  });
  it.each([
    { kind: "net", net: "new-trunk" },
    {
      kind: "wire-at",
      point: { x: 200, y: 100 },
      member: { instanceId: "new-device", pinName: "D" },
    },
  ])(
    "can directly send a draft-resolved wire target without a Snapshot: $kind",
    (to) => {
      const action = AuthoringActionSchema.parse({
        kind: "connect",
        from: { kind: "point", x: 200, y: 0 },
        to,
      });
      expect(directConnectIntent(action, () => "new-wire")).toMatchObject({
        id: "new-wire",
        from: { kind: "free", point: { x: 200, y: 0 } },
        to,
      });
    },
  );
  it("uses the same wire request for explicit identities and resolved helper input", () => {
    const action = AuthoringActionSchema.parse({
      kind: "connect",
      from: {
        kind: "pin",
        instance: { kind: "instance", id: "instance-1" },
        pin: "G",
      },
      to: { kind: "point", x: 400, y: 200 },
      via: [{ x: 320, y: 200 }],
      routingMode: "orthogonal",
    });
    const fixedId = () => "wire-test";
    expect(directConnectIntent(action, fixedId)).toEqual(
      compileActions([action], {
        snapshot: testSnapshot(),
        allocateId: fixedId,
      })[0]!.wireIntent,
    );
    expect(
      directConnectIntent(
        AuthoringActionSchema.parse({
          kind: "connect",
          from: { kind: "pin", instance: "M1", pin: "G" },
          to: { kind: "point", x: 400, y: 200 },
        }),
        fixedId,
      ),
    ).toBeUndefined();
  });
  it("advertises exact reference kinds instead of unrepresentable discriminator refinements", () => {
    const schema = z.toJSONSchema(AuthoringActionSchema, {
      target: "draft-2020-12",
    }) as any;
    const kinds = (action: string) => {
      const target = schema.oneOf.find(
        (item: any) => item.properties.kind.const === action,
      ).properties.target;
      return (target.anyOf ?? [target]).map(
        (item: any) => item.properties.kind.const,
      );
    };
    expect(kinds("move")).toEqual(["instance", "junction", "annotation"]);
    expect(kinds("add-label")).toEqual(["net", "pin"]);
    expect(kinds("edit-text")).toEqual(["annotation", "drafting"]);
    expect(
      AuthoringActionSchema.safeParse({
        kind: "add-label",
        target: { kind: "route", id: "r" },
        text: "bad",
      }).success,
    ).toBe(false);
  });
  it("connects and disconnects stable IDs without guessing a Reference", () => {
    const snapshot = testSnapshot();
    snapshot.document.instances[0]!.reference = null;
    const pin = {
      kind: "pin",
      instance: { kind: "instance", id: "instance-1" },
      pin: "G",
    };
    const [wire] = compile(
      [{ kind: "connect", from: pin, to: { kind: "point", x: 20, y: 240 } }],
      snapshot,
    );
    expect(wire?.wireIntent?.from).toEqual({
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: "instance-1", pinName: "G" },
    });
    const [cut] = compile([{ kind: "disconnect", target: pin }], snapshot);
    expect(cut?.command).toEqual({
      kind: "disconnect-pin",
      instanceId: "instance-1",
      pinName: "G",
    });
  });
  it("leaves an unnamed device's Reference to the editor, as a GUI insert does (#1256)", () => {
    expect(
      compile([
        { kind: "place-component", symbol: "ground", position: { x: 0, y: 0 } },
      ])[0]?.command,
    ).toMatchObject({
      kind: "place-components",
      instances: [{ symbolId: "ground" }],
    });
    // A device without a Reference or parameters: the editor names it and
    // fills its catalog netlist.
    const [unnamed] = compile([
      {
        kind: "place-component",
        symbol: "d-flip-flop",
        position: { x: 0, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        position: { x: 100, y: 0 },
        parameters: { value: "2k" },
      },
    ]);
    const instances = (
      unnamed?.command as { instances: Record<string, unknown>[] }
    ).instances;
    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toHaveProperty("reference");
    expect(instances[0]).not.toHaveProperty("netlist");
    expect(instances[1]).not.toHaveProperty("reference");
    expect(instances[1]).toMatchObject({
      netlist: { parameters: { value: "2k" } },
    });
    expectCompileError(
      [{ kind: "place-component", symbol: "port", position: { x: 0, y: 0 } }],
      "Port needs its name",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "ground",
          reference: "GND1",
          position: { x: 0, y: 0 },
        },
      ],
      "omit reference",
    );
  });
  it("places a formula block with its formula, and sets it later (#1256)", () => {
    const [placed] = compile([
      {
        kind: "place-component",
        symbol: "integrator",
        position: { x: 0, y: 0 },
        signalFlow: { formula: "1/(1-z^-1)", coefficient: "a_1" },
      },
    ]);
    expect(
      (placed?.command as { instances: Record<string, unknown>[] })
        .instances[0],
    ).toMatchObject({
      signalFlowParameters: { formula: "1/(1-z^-1)", coefficient: "a_1" },
    });
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "integrator",
          position: { x: 0, y: 0 },
          signalFlow: { formular: "x" },
        },
      ],
      "signalFlow",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "resistor",
          position: { x: 0, y: 0 },
          signalFlow: { formula: "R" },
        },
      ],
      "draws no formula",
    );
    const snapshot = testSnapshot();
    const block = structuredClone(snapshot.document.instances[0]!);
    snapshot.document.instances.push({
      ...block,
      id: "block-1",
      reference: null,
      symbolId: "integrator",
      netlist: undefined,
      signalFlowParameters: {
        formula: "1/s",
        formulaFormat: { runs: [{ kind: "text", value: "1/s" }] },
      },
    } as never);
    const [change] = compile(
      [
        {
          kind: "set-signal-flow",
          target: { kind: "instance", id: "block-1" },
          formula: "1/(1-z^-1)",
          coefficient: "b",
        },
      ],
      snapshot,
    );
    // The editor drops the old formula's look, as the Properties formula does.
    expect(change?.command).toEqual({
      kind: "set-properties",
      instanceId: "block-1",
      signalFlow: { formula: "1/(1-z^-1)", coefficient: "b" },
    });
    expect(
      compile(
        [
          {
            kind: "set-signal-flow",
            target: { kind: "instance", id: "block-1" },
            formula: null,
          },
        ],
        snapshot,
      )[0]?.command,
    ).toEqual({
      kind: "set-properties",
      instanceId: "block-1",
      signalFlow: { formula: null },
    });
  });
  it("compiles place-component into catalog-validated native placement", () => {
    const [transaction] = compile([
      {
        kind: "place-component",
        symbol: "capacitor",
        reference: "C1",
        position: { x: 600, y: 300 },
        parameters: { value: "1p" },
      },
    ]);
    expect(transaction?.form).toBe("command");
    expect(transaction?.command?.kind).toBe("place-components");
    if (transaction?.command?.kind === "place-components") {
      const edit = { instance: transaction.command.instances[0]! };
      expect(edit.instance.symbolId).toBe("capacitor");
      expect(edit.instance.reference).toBe("C1");
      expect(edit.instance.netlist?.parameters).toEqual({ value: "1p" });
      expect(edit.instance.placement).toEqual({
        position: { x: 600, y: 300 },
        rotation: 0,
        mirror: "none",
      });
      expect(edit.instance.id).toMatch(/^instance-alloc-/);
    }
  });

  it("rejects unknown, select and decimal parameters before placement", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "capacitor",
          reference: "C2",
          position: { x: 600, y: 300 },
          parameters: { c: "1p" },
        },
      ],
      "Unknown parameter",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "voltage-source",
          reference: "V2",
          position: { x: 600, y: 300 },
          parameters: { waveform: "triangle" },
        },
      ],
      "must be one of: dc, pulse, sin, pwl",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M2",
          position: { x: 600, y: 300 },
          parameters: { nf: "two" },
        },
      ],
      "finite decimal number",
    );
  });

  it("refuses a quantity that is not a number and names a misspelled key (#1268)", () => {
    // Exported as SIN(0 12 banana 0 0 0), it failed only inside ngspice.
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "voltage-source",
          reference: "V2",
          position: { x: 600, y: 300 },
          parameters: { waveform: "sin", frequency: "banana" },
        },
      ],
      'Parameter "frequency" must be a SPICE number such as 1k or 2.5n, or an expression in braces such as {vdd/2}; received "banana"',
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "capacitor",
          reference: "C2",
          position: { x: 600, y: 300 },
          parameters: { value: "1µ" },
        },
      ],
      "(SPICE writes micro as u)",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "voltage-source",
          reference: "V2",
          position: { x: 600, y: 300 },
          parameters: { freq: "2k" },
        },
      ],
      'Unknown parameter "freq" for voltage-source; did you mean "frequency"?',
    );
    expect(
      compile([
        {
          kind: "place-component",
          symbol: "voltage-source",
          reference: "V2",
          position: { x: 600, y: 300 },
          parameters: { waveform: "sin", frequency: "{f0*2}", amplitude: "12" },
        },
      ]),
    ).toHaveLength(1);
  });

  it("refuses an upper-case M before a unit and names both readings (#1409)", () => {
    // Exported as `R2 vin net0 1MΩ`, ngspice ran it as 1 mΩ.
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R2",
          position: { x: 600, y: 300 },
          parameters: { value: "1MΩ" },
        },
      ],
      'Parameter "value" is "1MΩ", which reads as 1 mΩ in SPICE (M is milli): write 1MegΩ for mega or 1mΩ for milli',
    );
    expect(
      compile([
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R2",
          position: { x: 600, y: 300 },
          parameters: { value: "1MegΩ" },
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects vdd and unknown symbols at the human-fact boundary", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "vdd",
          reference: "V1",
          position: { x: 0, y: 0 },
        },
      ],
      "add-power-rail",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "some-pdk-nmos",
          reference: "M9",
          position: { x: 0, y: 0 },
        },
      ],
      "reviewed built-in catalog",
    );
  });

  it("rejects duplicate Instance References", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "M1",
          position: { x: 0, y: 0 },
        },
      ],
      "already exists",
    );
  });

  it("delegates Power Rail semantics to the shared browser planner", () => {
    const [transaction] = compile([
      {
        kind: "add-power-rail",
        start: { x: 100, y: 80 },
        end: { x: 500, y: 80 },
      },
    ]);
    expect(transaction?.command).toMatchObject({
      kind: "add-power-rail",
      start: { x: 100, y: 80 },
      end: { x: 500, y: 80 },
    });
    expect(transaction?.command).not.toHaveProperty("scope");
  });

  it("compiles pin-to-pin connect into one visible wire intent with waypoints", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "M1", pin: "S" },
        via: [
          { x: 460, y: 220 },
          { x: 300, y: 220 },
        ],
      },
    ]);
    expect(transaction?.form).toBe("wire-intent");
    expect(transaction?.wireIntent).toMatchObject({
      from: {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: "instance-2",
          pinName: "2",
        },
      },
      to: {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: "instance-1",
          pinName: "S",
        },
      },
      waypoints: [
        { x: 460, y: 220 },
        { x: 300, y: 220 },
      ],
    });
  });

  it("passes the free point and Net identity to the shared wire planner", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "point", x: 480, y: 160 },
        to: { kind: "net", net: "Vout" },
      },
    ]);
    expect(transaction?.wireIntent).toMatchObject({
      from: { kind: "free", point: { x: 480, y: 160 } },
      to: { kind: "net", net: "Vout" },
    });
  });

  it("delegates Net geometry to the current server draft, including newly created Nets", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "net", net: "Vout" },
      },
    ]);
    expect(transaction?.wireIntent?.to).toEqual({ kind: "net", net: "Vout" });
    expect(transaction?.wireIntent?.from).toMatchObject({
      kind: "endpoint",
      endpoint: { instanceId: "instance-2", pinName: "2" },
    });
  });
  it("refuses pin targets the snapshot does not report", () => {
    expectCompileError(
      [
        {
          kind: "connect",
          from: { kind: "pin", instance: "M1", pin: "X" },
          to: { kind: "pin", instance: "R1", pin: "1" },
        },
      ],
      'no pin "X"',
    );
  });

  it("sends disconnect as Disconnect endpoint, and a wire's as its deletion", () => {
    const transactions = compile([
      { kind: "disconnect", target: { kind: "pin", instance: "R1", pin: "2" } },
      { kind: "disconnect", target: { kind: "route", route: "vout-route" } },
    ]);
    expect(transactions.map((transaction) => transaction.command)).toEqual([
      { kind: "disconnect-pin", instanceId: "instance-2", pinName: "2" },
      {
        kind: "delete-selection",
        selection: {
          instanceIds: [],
          routeIds: ["vout-route"],
          junctionIds: [],
          annotationIds: [],
          draftingIds: [],
          noConnectIds: [],
        },
      },
    ]);
  });

  it("sends move, rotate, and mirror for the editor to plan", () => {
    const transactions = compile([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 10, y: 20 },
      },
      {
        kind: "rotate",
        target: { kind: "instance", id: "instance-2" },
        rotation: 90,
      },
      {
        kind: "mirror",
        target: { kind: "instance", reference: "M1" },
        mirror: "horizontal",
      },
    ]);
    // The editor plans each as its Properties placement fields do.
    expect(transactions.map((transaction) => transaction.command)).toEqual([
      {
        kind: "set-properties",
        instanceId: "instance-1",
        placement: { position: { x: 10, y: 20 } },
      },
      {
        kind: "set-properties",
        instanceId: "instance-2",
        placement: { rotation: 90 },
      },
      {
        kind: "set-properties",
        instanceId: "instance-1",
        placement: { mirror: "horizontal" },
      },
    ]);
  });

  it("plans a Junction move in the live editor instead of emitting an incomplete raw edit", () => {
    const transactions = compile([
      {
        kind: "move",
        target: { kind: "junction", id: "junction-1" },
        position: { x: 20, y: 40 },
      },
    ]);
    expect(transactions).toEqual([
      {
        form: "command",
        actionKinds: ["move"],
        actionIndices: [0],
        command: {
          kind: "move-junction",
          junctionId: "junction-1",
          position: { x: 20, y: 40 },
        },
      },
    ]);
  });

  it("sends set-reference as a Properties rename", () => {
    const [transaction] = compile([
      {
        kind: "set-reference",
        target: { kind: "instance", reference: "M1" },
        reference: "MN0",
      },
    ]);
    expect(transaction?.command).toEqual({
      kind: "set-properties",
      instanceId: "instance-1",
      reference: "MN0",
    });
  });

  it("names the pin to use when connect gives a block's exported port name", () => {
    // Issue #1264: netlists call an op-amp's IN+ VIP, so an Agent writes VIP.
    const snapshot = testSnapshot();
    snapshot.document.instances.push({
      ...structuredClone(snapshot.document.instances[1]!),
      id: "instance-opamp",
      reference: "X1",
      symbolId: "opamp",
      pins: ["IN-", "IN+", "OUT"].map((name) => ({
        ...structuredClone(snapshot.document.instances[1]!.pins[0]!),
        name,
        netId: null,
      })),
    });
    expectCompileError(
      [
        {
          kind: "connect",
          from: { kind: "pin", instance: "X1", pin: "VIP" },
          to: { kind: "point", x: 400, y: 200 },
        },
      ],
      'snapshot pins: IN-, IN+, OUT (VIP is the exported port name; use pin "IN+")',
      snapshot,
    );
  });

  it("sends set-block-supply as the Properties supply choice", () => {
    // Issue #1253: MISSING_BLOCK_SUPPLY needs one focused action, not an
    // advanced typed edit.
    const snapshot = testSnapshot();
    snapshot.document.instances.push({
      ...structuredClone(snapshot.document.instances[1]!),
      id: "instance-inverter",
      reference: "X1",
      symbolId: "inverter",
    });
    const target = { kind: "instance", reference: "X1" };
    const [chosen] = compile(
      [
        {
          kind: "set-block-supply",
          target,
          supply: "VDD",
          net: { kind: "net", name: "VDD" },
        },
      ],
      snapshot,
    );
    expect(chosen?.command).toEqual({
      kind: "set-properties",
      instanceId: "instance-inverter",
      supplies: { VDD: "net-vdd" },
    });
    const [auto] = compile(
      [{ kind: "set-block-supply", target, supply: "VSS", net: null }],
      snapshot,
    );
    expect(auto?.command).toEqual({
      kind: "set-properties",
      instanceId: "instance-inverter",
      supplies: { VSS: null },
    });
    expect(
      AuthoringActionSchema.safeParse({
        kind: "set-block-supply",
        target,
        supply: "VCC",
        net: null,
      }).success,
    ).toBe(false);
  });

  it("compiles add-label with a derived position from net geometry", () => {
    const [transaction] = compile([
      {
        kind: "add-label",
        target: { kind: "net", name: "Vout" },
        text: "Vout",
      },
    ]);
    // 20 above vout-route's middle point, the corner at (310, 100).
    expect(transaction?.command).toMatchObject({
      kind: "set-net-label",
      netId: "vout-net",
      position: { x: 310, y: 80 },
      text: { runs: [{ kind: "text", value: "Vout" }] },
    });
  });

  it("marks and clears a pin's No Connect with disconnect, as the GUI does (#1305)", () => {
    const r1 = { kind: "pin", instance: "R1", pin: "2" };
    const [marked] = compile([
      { kind: "disconnect", target: r1, noConnect: true },
    ]);
    expect(marked?.edits).toEqual([
      {
        kind: "add_no_connect",
        noConnect: {
          id: expect.stringMatching(/^no-connect-/),
          endpoint: {
            kind: "terminal",
            instanceId: "instance-2",
            pinName: "2",
          },
        },
      },
    ]);
    // A wired pin is disconnected first, in the same transaction.
    const [unused] = compile([
      {
        kind: "disconnect",
        target: { kind: "pin", instance: "M1", pin: "D" },
        noConnect: true,
      },
    ]);
    expect(unused?.edits?.map((edit) => edit.kind)).toEqual([
      "disconnect_endpoint",
      "add_no_connect",
    ]);
    expectCompileError(
      [{ kind: "disconnect", target: r1, noConnect: false }],
      "pin R1.2 has no No Connect mark",
    );
    expectCompileError(
      [
        {
          kind: "disconnect",
          target: { kind: "route", route: "vout-route" },
          noConnect: true,
        },
      ],
      "noConnect applies to a pin target",
    );

    const snapshot = testSnapshot();
    snapshot.document.noConnects.push({
      id: "nc-r1",
      endpoint: { kind: "terminal", instanceId: "instance-2", pinName: "2" },
    });
    const [cleared] = compile(
      [{ kind: "disconnect", target: r1, noConnect: false }],
      snapshot,
    );
    expect(cleared?.edits).toEqual([
      { kind: "remove_no_connect", noConnectId: "nc-r1" },
    ]);
    expectCompileError(
      [{ kind: "disconnect", target: r1, noConnect: true }],
      "pin R1.2 is already marked No Connect",
      snapshot,
    );
  });

  it("names a pin's Net on the wire leaving that pin", () => {
    // A bias gate's stub, just drawn, is named in the same call list
    // without a Snapshot read to learn the stub's new Net.
    const [transaction] = compile([
      {
        kind: "add-label",
        target: { kind: "pin", instance: "M1", pin: "D" },
        text: "Vout",
      },
    ]);
    expect(transaction?.command).toMatchObject({
      kind: "set-net-label",
      netId: "vout-net",
      // Halfway along vout-route's first segment, from M1.D (310, 220) up to
      // its bend (310, 100).
      position: { x: 310, y: 160 },
    });
    expectCompileError(
      [
        {
          kind: "add-label",
          target: { kind: "pin", instance: "R1", pin: "2" },
          text: "x",
        },
      ],
      "pin R1.2 is on no Net yet",
    );
  });

  it("leaves supply naming policy to the shared server planner", () => {
    const [transaction] = compile([
      {
        kind: "add-label",
        target: { kind: "net", name: "VDD" },
        text: "VDD",
        position: { x: 5, y: 5 },
      },
    ]);
    expect(transaction?.command).toMatchObject({
      kind: "set-net-label",
      netId: "net-vdd",
    });
  });

  it("sends annotate as add-text and a Net label's edit-text as set-net-label", () => {
    const [annotated] = compile([
      { kind: "annotate", text: "Bias branch", position: { x: 50, y: 400 } },
    ]);
    expect(annotated?.command).toMatchObject({
      kind: "add-text",
      position: { x: 50, y: 400 },
      text: "Bias branch",
    });
    const [edited] = compile([
      {
        kind: "edit-text",
        target: { kind: "annotation", id: "label-1" },
        text: "Vout node",
      },
    ]);
    expect(edited?.command).toMatchObject({
      kind: "set-net-label",
      annotationId: "label-1",
      text: { runs: [{ kind: "text", value: "Vout node" }] },
    });
  });

  it("sends arrange with resolved ids", () => {
    const [transaction] = compile([
      {
        kind: "arrange",
        instances: [
          { kind: "instance", reference: "M1" },
          { kind: "instance", reference: "R1" },
        ],
        axis: "x",
        coordinate: 240,
      },
    ]);
    expect(transaction?.command).toEqual({
      kind: "arrange-instances",
      instanceIds: ["instance-1", "instance-2"],
      axis: "x",
      coordinate: 240,
    });
  });

  it("sends a label preset with its parts by Reference resolved to IDs (#1350)", () => {
    const [named] = compile([
      {
        kind: "apply-label-preset",
        preset: "textbook",
        targets: [
          { kind: "instance", reference: "M1" },
          { kind: "instance", reference: "R1" },
        ],
      },
    ]);
    expect(named?.command).toEqual({
      kind: "apply-label-preset",
      preset: "textbook",
      instanceIds: ["instance-1", "instance-2"],
    });
    // Left out, the editor takes every placed part of the Cell.
    const [whole] = compile([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(whole?.command).toEqual({
      kind: "apply-label-preset",
      preset: "textbook",
    });
    expectCompileError(
      [
        {
          kind: "apply-label-preset",
          preset: "textbook",
          targets: [{ kind: "instance", reference: "M9" }],
        },
      ],
      'no instance matches Reference "M9"',
    );
    for (const action of [
      {
        kind: "apply-label-preset",
        preset: "textbook",
        instanceIds: ["instance-1"],
        targets: [{ kind: "instance", reference: "M1" }],
      },
      { kind: "apply-label-preset", preset: "razavi" },
      { kind: "apply-label-preset", preset: "textbook", instanceIds: [] },
    ])
      expect(AuthoringActionSchema.safeParse(action).success).toBe(false);
  });

  it("compiles delete for supported kinds and refuses nets", () => {
    const [transaction] = compile([
      { kind: "delete", target: { kind: "instance", reference: "R1" } },
      { kind: "delete", target: { kind: "route", id: "vout-route" } },
      { kind: "delete", target: { kind: "annotation", id: "label-1" } },
    ]);
    expect(transaction?.command).toMatchObject({
      kind: "delete-selection",
      selection: {
        instanceIds: ["instance-2"],
        routeIds: ["vout-route"],
        annotationIds: ["label-1"],
      },
    });
    expectCompileError(
      [{ kind: "delete", target: { kind: "net", name: "Vout" } }],
      "disconnect",
    );
  });

  it("sends each change as a command and keeps wire intents as separate transactions", () => {
    const transactions = compile([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 0, y: 0 },
      },
      {
        kind: "rotate",
        target: { kind: "instance", reference: "M1" },
        rotation: 90,
      },
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "net", net: "VDD" },
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 1, y: 1 },
      },
    ]);
    expect(transactions.map((t) => t.form)).toEqual([
      "command",
      "command",
      "wire-intent",
      "command",
    ]);
    // Consecutive commands share one call and one undo, as a batch.
    expect(
      splitIntoCalls(transactions).map((call) => call.actionIndices),
    ).toEqual([[0, 1], [2], [3]]);
  });

  it("rejects malformed action batches with the failing index", () => {
    expectCompileError(
      [
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          position: { x: 0, y: 0 },
        },
        {
          kind: "rotate",
          target: { kind: "instance", reference: "M1" },
        },
      ],
      "rotation",
    );
  });
});

describe("every action compiles in a mixed call", () => {
  it("keeps Cell and Junction commands that sit beside other actions", () => {
    // These seven passed alone but vanished from a mixed list, which then
    // reported success for what was left.
    const commands = [
      { kind: "move-junction", junctionId: "J1", position: { x: 40, y: 40 } },
      { kind: "remove-cell-terminal", terminalId: "T1" },
      { kind: "rename-cell-terminal", terminalId: "T1", name: "VIN" },
      {
        kind: "bind-cell-parameter",
        instanceId: "instance-1",
        field: "w",
        name: "W",
      },
      { kind: "rename-cell-parameter", oldName: "W", newName: "WN" },
      { kind: "set-cell-parameter-default", name: "W", defaultValue: "1u" },
      { kind: "remove-cell-parameter", name: "W" },
      {
        kind: "set-cell-symbol-pins",
        pins: [{ name: "bl", side: "east" }],
      },
      { kind: "apply-label-preset", preset: "textbook" },
    ];
    for (const command of commands) {
      expect(
        AuthoringActionSchema.safeParse(command).success,
        command.kind,
      ).toBe(true);
      const compiled = compile([
        {
          kind: "rotate",
          target: { kind: "instance", reference: "M1" },
          rotation: 90,
        },
        command,
      ]);
      expect(
        compiled.some(
          (transaction) =>
            transaction.form === "command" &&
            transaction.command?.kind === command.kind,
        ),
        command.kind,
      ).toBe(true);
    }
  });
});

describe("placing by pins and by symmetry (#1112)", () => {
  it("places the mirror image of a part about a vertical or horizontal line", () => {
    // M1 sits at (300, 240), upright and unmirrored, on a 10 grid.
    const [placed] = compile([
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M2",
        mirrorOf: { instance: "M1", x: 400 },
      },
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M3",
        mirrorOf: { instance: "instance-1", y: 300 },
      },
    ]);
    const [m2, m3] = (
      placed?.command as { instances: { placement: unknown }[] }
    ).instances;
    expect(m2?.placement).toEqual({
      position: { x: 500, y: 240 },
      rotation: 0,
      mirror: "horizontal",
    });
    expect(m3?.placement).toEqual({
      position: { x: 300, y: 360 },
      rotation: 0,
      mirror: "vertical",
    });
  });

  it("refuses an axis whose image is off the grid, a missing part, or two axes", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M2",
          mirrorOf: { instance: "M1", x: 403 },
        },
      ],
      "off placement grid 10",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M2",
          mirrorOf: { instance: "M9", x: 400 },
        },
      ],
      "no part M9",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M2",
          mirrorOf: { instance: "M1", x: 400, y: 300 },
        },
      ],
      "exactly one axis",
    );
  });
});

describe("parts named in the list that places them (#1515)", () => {
  const place = (
    symbol: string,
    id: string | undefined,
    x: number,
    extra: Record<string, unknown> = {},
  ) => ({
    kind: "place-component",
    symbol,
    ...(id ? { id } : {}),
    position: { x, y: 600 },
    ...extra,
  });
  const pin = (instance: unknown, name: string) => ({
    kind: "pin",
    instance,
    pin: name,
  });
  const byId = (id: string) => ({ kind: "instance", id });

  it("wires a ground and each of two VDD markers by the IDs the list gave them", () => {
    const transactions = compile([
      place("nmos", "m-tail", 0, { reference: "M9" }),
      place("ground", "gnd-tail", 0, { position: { x: 0, y: 800 } }),
      place("vdd-port", "vdd-left", 200),
      place("vdd-port", "vdd-right", 400),
      { kind: "connect", from: pin("M9", "S"), to: pin(byId("gnd-tail"), "0") },
      { kind: "connect", from: pin(byId("vdd-left"), "P"), to: pin("M9", "D") },
      {
        kind: "connect",
        from: pin(byId("vdd-right"), "P"),
        to: { kind: "point", x: 400, y: 700 },
      },
    ]);
    expect(
      (transactions[0]?.command as { instances: { id: string }[] }).instances,
    ).toMatchObject([
      { id: "m-tail", reference: "M9" },
      { id: "gnd-tail", symbolId: "ground" },
      { id: "vdd-left", reference: "VDD" },
      { id: "vdd-right", reference: "VDD" },
    ]);
    const terminal = (instanceId: string, pinName: string) => ({
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId, pinName },
    });
    expect(transactions.slice(1).map((item) => item.wireIntent)).toMatchObject([
      { from: terminal("m-tail", "S"), to: terminal("gnd-tail", "0") },
      { from: terminal("vdd-left", "P"), to: terminal("m-tail", "D") },
      { from: terminal("vdd-right", "P") },
    ]);
    // Placing and wiring are two calls; neither needs the Document read
    // again to learn an ID.
    expect(splitIntoCalls(transactions)).toEqual([
      {
        actionIndices: [0, 1, 2, 3],
        actionKinds: ["place-component"],
        sends: "placement batch",
      },
      { actionIndices: [4, 5, 6], actionKinds: ["connect"], sends: "wires" },
    ]);
  });

  it("refuses a name several parts share, naming their IDs, never taking the first", () => {
    expectCompileError(
      [
        place("vdd-port", "vdd-left", 200),
        place("vdd-port", undefined, 400),
        { kind: "connect", from: pin("VDD", "P"), to: pin("M1", "D") },
      ],
      '"VDD" names 2 parts (vdd-left, instance-alloc-',
    );
    // One VDD marker is its name's only part.
    expect(
      compile([
        place("vdd-port", "vdd-only", 200),
        { kind: "connect", from: pin("VDD", "P"), to: pin("M1", "D") },
      ])[1]?.wireIntent?.from,
    ).toMatchObject({ endpoint: { instanceId: "vdd-only" } });
  });

  it("names a Cell Pin of the Document by its Pin name, and refuses one a new marker shares", () => {
    const snapshot = testSnapshot();
    const resistor = snapshot.document.instances.find(
      (instance) => instance.reference === "R1",
    )!;
    // As the Snapshot reports a VDD marker: no Reference, its Pin's name.
    snapshot.document.instances.push({
      ...structuredClone(resistor),
      id: "vdd-drawn",
      reference: null,
      symbolId: "vdd-port",
      cellTerminal: { id: "terminal-vdd", name: "VDD", direction: "inout" },
      pins: [{ ...resistor.pins[0]!, name: "P" }],
    });
    expect(
      compile([{ kind: "disconnect", target: pin("VDD", "P") }], snapshot)[0]
        ?.command,
    ).toMatchObject({ instanceId: "vdd-drawn" });
    expectCompileError(
      [
        place("vdd-port", "vdd-new", 200),
        { kind: "connect", from: pin("VDD", "P"), to: pin("M1", "D") },
      ],
      '"VDD" names 2 parts (vdd-drawn, vdd-new)',
      snapshot,
    );
  });

  it("refuses an ID an object already holds, in the Document or the list", () => {
    expectCompileError(
      [place("resistor", "instance-1", 0)],
      'ID "instance-1" is already taken',
    );
    expectCompileError(
      [place("resistor", "r-a", 0), place("resistor", "r-a", 200)],
      'actions[1] (place-component): ID "r-a" is already taken',
    );
  });

  it("mirrors a part placed earlier in the list, unless a pin anchor places it", () => {
    const [placed] = compile([
      place("nmos", "m-left", 300, { reference: "M5" }),
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M6",
        mirrorOf: { instance: "m-left", x: 400 },
      },
    ]);
    expect(
      (placed?.command as { instances: { placement: unknown }[] }).instances[1]
        ?.placement,
    ).toEqual({
      position: { x: 500, y: 600 },
      rotation: 0,
      mirror: "horizontal",
    });
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M5",
          pinAnchor: { pinName: "G", position: { x: 300, y: 600 } },
        },
        {
          kind: "place-component",
          symbol: "nmos",
          reference: "M6",
          mirrorOf: { instance: "M5", x: 400 },
        },
      ],
      "M5 lands by its pin anchor in this list; mirror it in a later call",
    );
  });
});

describe("one mirror vocabulary (#1231)", () => {
  const m1 = { kind: "instance", reference: "M1" };
  it("sends a reflection, a mirror state or an orientation for the editor to plan", () => {
    const sends = (action: Record<string, unknown>) =>
      compile([{ target: m1, ...action }])[0]?.command;
    expect(sends({ kind: "mirror", axis: "y" })).toEqual({
      kind: "set-properties",
      instanceId: "instance-1",
      placement: { reflect: "y" },
    });
    // A state is still accepted, and set-orientation is the place for one.
    expect(sends({ kind: "mirror", mirror: "vertical" })).toEqual({
      kind: "set-properties",
      instanceId: "instance-1",
      placement: { mirror: "vertical" },
    });
    expect(
      sends({ kind: "set-orientation", rotation: 90, mirror: "none" }),
    ).toEqual({
      kind: "set-properties",
      instanceId: "instance-1",
      placement: { rotation: 90, mirror: "none" },
    });
    expectCompileError(
      [{ kind: "mirror", target: m1, axis: "y", mirror: "none" }],
      "not both",
    );
  });
});
