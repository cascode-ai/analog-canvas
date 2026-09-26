import { expect, it } from "vitest";
import { createEmptyDocument } from "./factories.js";
import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";
import {
  flattenRichText,
  hasItalicScripts,
  uprightScripts,
} from "./rich-text.js";
import {
  identifierTextDocument,
  richTextIdentifier,
  rewriteRichTextIdentifier,
  formatLabelSubscripts,
} from "./identifier-text.js";
import {
  formatLabelFirstLetter,
  formatLabelIdentifier,
  formatPresentingName,
  isRoleLabelFormat,
  isSupplyLabelFormat,
  labelRole,
  labelTypography,
  labelTextDocument,
  renamedLabelFormat,
  roleLabelFormat,
  labelLookChanges,
  supplyLabelFormat,
} from "./label-typography.js";

it("gives new drawings italic initials and upright preserved-case subscripts", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  // A typed name is shown as written; the first-letter look is opt-in.
  expect(labelTypography(presentation)).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: false,
    subscriptCase: "preserve",
    subscriptItalic: false,
    firstLetterItalic: true,
  });
  expect(formatLabelIdentifier("Start", labelTypography(presentation))).toBe(
    "Start",
  );
  expect(
    formatLabelIdentifier("VinP", {
      ...labelTypography(presentation),
      subscriptAfterFirst: true,
    }),
  ).toBe("V_inP");
  const content = labelTextDocument("V_inP", presentation);
  expect(richTextIdentifier(content)).toBe("V_inP");
  expect(JSON.stringify(content.runs[0])).toContain('"italic"');
  expect(JSON.stringify(content.runs[1])).not.toContain('"italic"');
});

it("keeps the legacy typography fallback for saved drawings without explicit fields", () => {
  expect(
    labelTypography({
      styleProfileId: "razavi-textbook-v1",
      grid: 10,
      compactness: "normal",
    }),
  ).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: false,
    subscriptCase: "preserve",
    subscriptItalic: true,
    firstLetterItalic: true,
  });
});

it("switches underscores between literal text and subscripts without changing the name", () => {
  const presentation = {
    ...createEmptyDocument("a", "A").presentation,
    labelSubscriptAfterFirst: false,
    labelSubscriptItalic: true,
  };
  for (const name of ["A_1", "V_in_cm", "Q_out_bar"]) {
    const scripted = labelTextDocument(name, presentation);
    const literal = labelTextDocument(name, {
      ...presentation,
      labelUnderscoreSubscript: false,
    });
    expect(richTextIdentifier(scripted)).toBe(name);
    expect(richTextIdentifier(literal)).toBe(name);
    expect(JSON.stringify(scripted)).toContain('"subscript"');
    expect(JSON.stringify(literal)).not.toContain('"subscript"');
    expect(flattenRichText(literal)).toBe(name.replace(/_bar$/, ""));
    expect(
      rewriteRichTextIdentifier(scripted, name, { underscoreSubscript: false }),
    ).toEqual(literal);
  }
});

it("uses an explicit naming action for first-letter subscripts and keeps bar markers", () => {
  const options = {
    subscriptAfterFirst: true,
    subscriptCase: "uppercase" as const,
  };
  expect(formatLabelIdentifier("Vin", options)).toBe("V_IN");
  expect(formatLabelIdentifier("V_in_bar", options)).toBe("V_IN_bar");
  expect(formatLabelIdentifier("A", options)).toBe("A");
  expect(formatLabelIdentifier("a long note", options)).toBe("a long note");
  expect(formatLabelIdentifier("1/s", options)).toBe("1/s");
});

it("changes initial slant without splitting one subscript into separate glyph groups", () => {
  const content = identifierTextDocument("A_load");
  const upright = formatLabelFirstLetter(content, false);
  expect(richTextIdentifier(upright)).toBe("A_load");
  expect(upright.runs[0]).toEqual({
    kind: "span",
    style: "bold",
    children: [{ kind: "text", value: "A" }],
  });
  expect(upright.runs[1]).toEqual(content.runs[1]);
  expect(formatLabelFirstLetter(upright, true).runs[1]).toEqual(
    content.runs[1],
  );
  expect(content).toEqual(identifierTextDocument("A_load"));
});

it("retains one continuous overbar across separately styled initial and subscript", () => {
  const text = formatLabelFirstLetter(
    identifierTextDocument("F_out_bar"),
    false,
  );
  expect(text.runs).toHaveLength(1);
  expect(text.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
  expect(JSON.stringify(text).match(/"overbar"/g)).toHaveLength(1);
  expect(richTextIdentifier(text)).toBe("F_out_bar");
});

it("applies subscript case even beneath an older whole-label case style", () => {
  const text = formatLabelSubscripts(
    {
      runs: [
        {
          kind: "span",
          style: "uppercase",
          children: identifierTextDocument("v_LOAD").runs,
        },
      ],
    },
    { case: "lowercase" },
  );
  expect(flattenRichText(text)).toBe("Vload");
  expect(richTextIdentifier(text)).toBe("V_load");
  expect(JSON.stringify(text)).not.toContain('"uppercase"');
  expect(JSON.stringify(text)).toContain('"bold"');
});

it("stores the supply look as italic V over an upright subscript", () => {
  const format = supplyLabelFormat("VDD")!;
  expect(format).toEqual({
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "V" }],
          },
        ],
      },
      {
        kind: "span",
        style: "subscript",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "DD" }],
          },
        ],
      },
    ],
  });
  // The visible characters are the electrical name, exactly.
  expect(flattenRichText(format)).toBe("VDD");
  expect(flattenRichText(supplyLabelFormat("Vdd1V8")!)).toBe("Vdd1V8");
  for (const name of ["AVDD", "VDD_1V8", "V", "VDD!", ""])
    expect(supplyLabelFormat(name)).toBeUndefined();
});

it("recognises only an untouched supply default", () => {
  expect(isSupplyLabelFormat(supplyLabelFormat("VDD")!, "VDD")).toBe(true);
  expect(isSupplyLabelFormat(supplyLabelFormat("VDD")!, "VCC")).toBe(false);
  const flat = { runs: [{ kind: "text" as const, value: "VDD" }] };
  expect(isSupplyLabelFormat(flat, "VDD")).toBe(false);
});

it("lets an untouched supply default follow a rename", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  const label = { kind: "power-label" as const };
  const vdd = { ...label, formatOverride: supplyLabelFormat("VDD")! };
  // Any V-led supply takes the same look, e.g. separate VDDH and VDDL rails.
  for (const supply of ["VDDA", "VDDH", "VDDL"]) {
    const renamed = renamedLabelFormat(vdd, "VDD", supply, presentation)!;
    expect(renamed).toEqual(supplyLabelFormat(supply));
    expect(flattenRichText(renamed)).toBe(supply);
  }
  expect(renamedLabelFormat(vdd, "VDD", "VDD", presentation)).toEqual(
    supplyLabelFormat("VDD"),
  );
  // No supply spelling: the label returns to the ordinary rules.
  expect(renamedLabelFormat(vdd, "VDD", "AVDD", presentation)).toBeUndefined();
  // An authored format keeps the existing rename rewrite.
  const authored = {
    ...label,
    formatOverride: { runs: [{ kind: "text" as const, value: "VDD" }] },
  };
  expect(
    flattenRichText(renamedLabelFormat(authored, "VDD", "VCC", presentation)!),
  ).toBe("VCC");
  expect(
    renamedLabelFormat({ kind: "power-label" }, "VDD", "VCC", presentation),
  ).toBeUndefined();
});

it("stores a device Reference as italic letters over an upright index", () => {
  const format = roleLabelFormat("device-reference", "M1")!;
  expect(format).toEqual({
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "M" }],
          },
        ],
      },
      {
        kind: "span",
        style: "subscript",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "1" }],
          },
        ],
      },
    ],
  });
  expect(flattenRichText(roleLabelFormat("device-reference", "R12")!)).toBe(
    "R12",
  );
  // Without a device letter, only letters followed by an index have a
  // standard look; nothing is guessed.
  for (const name of ["MTAIL", "RL", "M_1", "M1a", "1M", ""])
    expect(roleLabelFormat("device-reference", name)).toBeUndefined();
});

it("writes a Reference from its device letter over the rest (#1116)", () => {
  const split = (name: string, deviceLetter: string) => {
    const format = roleLabelFormat("device-reference", name, { deviceLetter });
    return format
      ? [
          flattenRichText({ runs: format.runs.slice(0, 1) }),
          flattenRichText({ runs: format.runs.slice(1) }),
        ]
      : undefined;
  };
  expect(split("RL1", "R")).toEqual(["R", "L1"]);
  expect(split("CL", "C")).toEqual(["C", "L"]);
  expect(split("RFB", "R")).toEqual(["R", "FB"]);
  expect(split("MTAIL", "M")).toEqual(["M", "TAIL"]);
  // A plain index reads exactly as before, so M₁ labels stay standard.
  expect(
    roleLabelFormat("device-reference", "M1", { deviceLetter: "M" }),
  ).toEqual(roleLabelFormat("device-reference", "M1"));
  // A name that does not start with the device letter, and a block with no
  // letter, keep letters over an index or no look at all.
  expect(split("XU0", "M")).toEqual(["XU", "0"]);
  expect(split("XBIAS", "M")).toBeUndefined();
  expect(roleLabelFormat("device-reference", "OA1")).toEqual(
    roleLabelFormat("device-reference", "OA1", {}),
  );
  expect(split("R_1", "R")).toBeUndefined();
});

it("assigns standard looks by what a label shows, not by its spelling", () => {
  expect(labelRole({ kind: "power-label" })).toBe("supply");
  expect(
    labelRole({
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
    }),
  ).toBe("device-reference");
  expect(
    labelRole({
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "t" },
    }),
  ).toBe("voltage-node");
  expect(
    labelRole({ kind: "net-label", binding: { kind: "net-name", netId: "n" } }),
  ).toBe("voltage-node");
  expect(labelRole({ kind: "net-label" })).toBeUndefined();
  expect(labelRole({ kind: "route-marker" })).toBeUndefined();
});

it("gives V-led node names V with an upright subscript and leaves others alone", () => {
  for (const [name, subscript] of [
    ["VBP", "BP"],
    ["VBN", "BN"],
    ["Vin", "in"],
    ["Vout", "out"],
    ["VcasP", "casP"],
    ["VCASN", "CASN"],
  ] as const) {
    const format = roleLabelFormat("voltage-node", name)!;
    expect(flattenRichText(format)).toBe(name);
    expect(JSON.stringify(format)).toContain(`"value":"${subscript}"`);
  }
  for (const name of ["OUT", "CLK", "V_ref", "Vin-", "V"])
    expect(roleLabelFormat("voltage-node", name)).toBeUndefined();
});

// A Pin or Net named for a current reads like a voltage node: I_out, I_REF,
// I₁. Inputs (IN, INP, INN, IN1, INPUT) and an IO pin stay as written.
it("gives a current's name an italic I over an upright subscript", () => {
  for (const [name, subscript] of [
    ["Iout", "out"],
    ["IOUT", "OUT"],
    ["Iref", "ref"],
    ["iref", "ref"],
    ["IBias", "Bias"],
    ["I1", "1"],
    ["Iin", "in"],
  ] as const) {
    const format = roleLabelFormat("voltage-node", name)!;
    expect(flattenRichText(format)).toBe(name);
    expect(JSON.stringify(format)).toContain(`"value":"${subscript}"`);
    expect(JSON.stringify(format)).toContain('"subscript"');
  }
  for (const name of [
    "IN",
    "INP",
    "INN",
    "IN1",
    "INF1",
    "INPUT",
    "inp",
    "IO",
    "I",
    "I_ref",
    "IN+",
  ])
    expect(roleLabelFormat("voltage-node", name)).toBeUndefined();
  // Supplies and devices keep their own rules.
  expect(roleLabelFormat("supply", "Iout")).toBeUndefined();
});

it("recognises a standard look however its spans are nested", () => {
  const regrouped = {
    runs: [
      {
        kind: "span" as const,
        style: "bold" as const,
        children: [
          {
            kind: "span" as const,
            style: "italic" as const,
            children: [{ kind: "text" as const, value: "M" }],
          },
          {
            kind: "span" as const,
            style: "subscript" as const,
            children: [{ kind: "text" as const, value: "1" }],
          },
        ],
      },
    ],
  };
  expect(isRoleLabelFormat(regrouped, "device-reference", "M1")).toBe(true);
  expect(isRoleLabelFormat(regrouped, "device-reference", "M2")).toBe(false);
});

it("lets a stored M₁ look follow a device rename", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  const label = {
    kind: "instance-label" as const,
    binding: { kind: "instance-reference" as const, instanceId: "M1" },
    formatOverride: roleLabelFormat("device-reference", "M1")!,
  };
  expect(renamedLabelFormat(label, "M1", "M10", presentation)).toEqual(
    roleLabelFormat("device-reference", "M10"),
  );
  expect(
    renamedLabelFormat(label, "M1", "MTAIL", presentation),
  ).toBeUndefined();
});

it("shows a hidden underscore again when restyling leaves nothing to hide it", () => {
  const flat = { runs: [{ kind: "text" as const, value: "Mload" }] };
  expect(flattenRichText(formatPresentingName(flat, "M_load"))).toBe("M_load");
  // A format that already spells its name is kept as it is.
  const scripted = identifierTextDocument("M_load");
  expect(formatPresentingName(scripted, "M_load")).toBe(scripted);
});

it("lists the standard looks an existing drawing's unformatted labels would take", () => {
  const document = createEmptyDocument("a", "A");
  const placement = {
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    mirror: "none" as const,
  };
  const at = (objectId: string) => ({
    kind: "object" as const,
    objectId,
    localOffset: { x: 10, y: 0 },
    fallbackPosition: { x: 10, y: 0 },
  });
  const label = (
    id: string,
    kind: "instance-label" | "power-label" | "net-label",
    binding: NonNullable<(typeof document.annotations)[number]["binding"]>,
    objectId: string,
    formatOverride?: ReturnType<typeof identifierTextDocument>,
  ) => ({
    id,
    kind,
    binding,
    ...(formatOverride ? { formatOverride } : {}),
    anchor: at(objectId),
    alignment: "start" as const,
    rotation: 0 as const,
    locked: false,
  });
  document.instances.push(
    { id: "M1", reference: "M1", symbolId: "nmos", placement },
    { id: "MTAIL", reference: "MTAIL", symbolId: "nmos", placement },
    { id: "M2", reference: "M2", symbolId: "nmos", placement },
    { id: "VDD1", symbolId: "vdd-port", placement },
    { id: "VDD2", symbolId: "vdd-port", placement },
    { id: "P1", symbolId: "port-filled", placement },
    { id: "P2", symbolId: "port", placement },
  );
  document.netlist = {
    name: "A",
    terminals: [
      {
        id: "t-vbp",
        name: "VBP",
        netId: "net-vbp",
        direction: "inout",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "t-clk",
        name: "CLK",
        netId: "net-clk",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
    ],
    formalParameters: [],
  };
  document.connectivityEvidence.push(
    {
      id: "claim-vcasn",
      kind: "name-claim",
      netId: "net-vcasn",
      name: "VcasN",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-vcasn" },
    },
    {
      id: "claim-vhidden",
      kind: "name-claim",
      netId: "net-vhidden",
      name: "VSUB",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-vhidden" },
    },
    {
      id: "claim-vddh",
      kind: "name-claim",
      netId: "net-vddh",
      name: "VDDH",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD1" },
    },
    {
      id: "claim-avdd",
      kind: "name-claim",
      netId: "net-avdd",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD2" },
    },
  );
  const ref = (instanceId: string) => ({
    kind: "instance-reference" as const,
    instanceId,
  });
  document.annotations.push(
    label("label-M1", "instance-label", ref("M1"), "M1"),
    label("label-MTAIL", "instance-label", ref("MTAIL"), "MTAIL"),
    // An author's own format is never replaced.
    label(
      "label-M2",
      "instance-label",
      ref("M2"),
      "M2",
      identifierTextDocument("M2"),
    ),
    label(
      "label-vddh",
      "power-label",
      { kind: "net-name", netId: "net-vddh" },
      "VDD1",
    ),
    label(
      "label-avdd",
      "power-label",
      { kind: "net-name", netId: "net-avdd" },
      "VDD2",
    ),
    label(
      "label-vbp",
      "instance-label",
      { kind: "cell-terminal-name", terminalId: "t-vbp" },
      "P1",
    ),
    label(
      "label-clk",
      "instance-label",
      { kind: "cell-terminal-name", terminalId: "t-clk" },
      "P2",
    ),
    label(
      "label-vcasn",
      "net-label",
      { kind: "net-name", netId: "net-vcasn" },
      "M1",
    ),
    // A label that is not drawn has no look to change.
    {
      ...label(
        "label-vhidden",
        "net-label",
        { kind: "net-name", netId: "net-vhidden" },
        "M1",
      ),
      visible: false,
    },
  );
  expect(labelLookChanges(document)).toEqual({
    labels: [
      {
        annotationId: "label-M1",
        kind: "standard",
        role: "device-reference",
        name: "M1",
        format: roleLabelFormat("device-reference", "M1"),
      },
      {
        annotationId: "label-vddh",
        kind: "standard",
        role: "supply",
        name: "VDDH",
        format: supplyLabelFormat("VDDH"),
      },
      {
        annotationId: "label-vbp",
        kind: "standard",
        role: "voltage-node",
        name: "VBP",
        format: roleLabelFormat("voltage-node", "VBP"),
      },
      {
        annotationId: "label-vcasn",
        kind: "standard",
        role: "voltage-node",
        name: "VcasN",
        format: roleLabelFormat("voltage-node", "VcasN"),
      },
    ],
    uprightSubscripts: false,
  });
});

const run = (value: string, ...styles: RichTextStyle[]): RichTextRun =>
  styles.reduceRight<RichTextRun>(
    (child, style) => ({ kind: "span", style, children: [child] }),
    { kind: "text", value },
  );

it("draws scripts upright by default and keeps a script slanted inside it only on request", () => {
  // Subscripting part of an italic name used to carry the italic along.
  const carried = {
    runs: [
      run("V", "italic", "bold"),
      run("BST", "subscript", "italic", "bold"),
    ],
  };
  expect(hasItalicScripts(carried)).toBe(true);
  expect(uprightScripts(carried)).toEqual({
    runs: [run("V", "italic", "bold"), run("BST", "subscript", "bold")],
  });
  // Italic outside a script does not slant it.
  const outside = {
    runs: [run("V", "italic"), run("out", "italic", "subscript")],
  };
  expect(hasItalicScripts(outside)).toBe(false);
  expect(flattenRichText(uprightScripts(carried))).toBe("VBST");
});

it("restyles looks stored before the standards only when asked, and keeps an author's choice", () => {
  const document = createEmptyDocument("a", "A");
  delete document.presentation.labelSubscriptItalic;
  const placement = {
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    mirror: "none" as const,
  };
  const pins = ["V_b3", "VIN", "Vout", "VBP"];
  document.netlist = {
    name: "A",
    terminals: pins.map((name, index) => ({
      id: `t${index}`,
      name,
      netId: `n${index}`,
      direction: "inout" as const,
      interfaceInstanceIds: [`P${index}`],
    })),
    formalParameters: [],
  };
  const formats: (RichTextDocument | undefined)[] = [
    undefined,
    // A subscript that took the surrounding italic along.
    {
      runs: [
        run("V", "italic", "bold"),
        run("IN", "subscript", "italic", "bold"),
      ],
    },
    // A stored copy of the historical bold italic look.
    { runs: [run("Vout", "italic", "bold")] },
    // An author who turned V_BP's subscript off.
    { runs: [run("V", "italic", "bold"), run("BP", "bold")] },
  ];
  pins.forEach((_, index) => {
    document.instances.push({ id: `P${index}`, symbolId: "port", placement });
    document.annotations.push({
      id: `label-${index}`,
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: `t${index}` },
      ...(formats[index] ? { formatOverride: formats[index] } : {}),
      anchor: {
        kind: "object",
        objectId: `P${index}`,
        localOffset: { x: 10, y: 0 },
        fallbackPosition: { x: 10, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
  });
  // The drawing never chose a slant, so its unformatted V_b3 turns upright.
  expect(labelLookChanges(document)).toEqual({
    labels: [],
    uprightSubscripts: true,
  });
  const legacy = labelLookChanges(document, { legacyLooks: true });
  expect(
    legacy.labels.map(({ annotationId, kind }) => [annotationId, kind]),
  ).toEqual([
    ["label-1", "upright"],
    ["label-2", "standard"],
  ]);
  expect(legacy.labels[0]!.format).toEqual({
    runs: [run("V", "italic", "bold"), run("IN", "subscript", "bold")],
  });
  expect(legacy.labels[1]!.format).toEqual(
    roleLabelFormat("voltage-node", "Vout"),
  );
  // A drawing that chose italic subscripts keeps them.
  document.presentation.labelSubscriptItalic = true;
  expect(labelLookChanges(document).uprightSubscripts).toBe(false);
});
