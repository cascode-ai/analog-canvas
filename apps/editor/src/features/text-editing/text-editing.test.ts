import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
  defaultDraftTextDocument,
  roleLabelFormat,
  supplyLabelFormat,
} from "@icm/model";
import type {
  Annotation,
  DraftingObject,
  Instance,
  RichTextDocument,
  RichTextRun,
  SchematicDocument,
} from "@icm/model";
import { signalFlowBodyTextDocument } from "@icm/symbols";

import {
  createTextEditingSession,
  editedBoundAnnotationName,
  proposeTextEditingCommit,
  editedRoleLabelFormat,
  resolveTextEditingTarget,
  roleLabelDefault,
  spliceVisibleEdit,
  textDeletionEdit,
  updateTextEditingSession,
} from "./text-editing";

const annotation = (): Annotation => ({
  id: "annotation-1",
  kind: "net-label",
  content: { runs: [{ kind: "text", value: "Vout" }] },
  netId: "net-1",
  anchor: { kind: "free", position: { x: 10, y: 20 } },
  alignment: "middle",
  rotation: 0,
  locked: false,
});

const draftingText = (): Extract<DraftingObject, { kind: "text" }> => ({
  id: "drafting-1",
  kind: "text",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 30, y: 40 } },
  content: { runs: [{ kind: "text", value: "Design note" }] },
  alignment: "middle",
  rotation: 0,
  typographyToken: "label",
});

describe("unified text editing", () => {
  it("interprets bound Instance and Cell Pin edits through the same name rule", () => {
    const document = createEmptyDocument("bound", "Bound");
    document.instances.push({
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: null,
    });
    document.netlist!.terminals.push({
      id: "pin-vout",
      name: "Vout",
      netId: "net-vout",
      direction: "output",
      interfaceInstanceIds: [],
    });
    const instanceLabel: Annotation = {
      ...annotation(),
      kind: "instance-label",
      content: undefined,
      netId: undefined,
      binding: { kind: "instance-reference", instanceId: "M1" },
    };
    const pinLabel: Annotation = {
      ...instanceLabel,
      id: "pin-label",
      binding: { kind: "cell-terminal-name", terminalId: "pin-vout" },
    };
    // Names are exactly what was typed; no underscore is ever inserted.
    const cases = [
      { label: instanceLabel, current: "M1", typed: "M2", expected: "M2" },
      { label: pinLabel, current: "Vout", typed: "Vin", expected: "Vin" },
    ];
    for (const { label, current, typed, expected } of cases) {
      const session = createTextEditingSession(
        { owner: "annotation", object: label },
        document,
      );
      expect(editedBoundAnnotationName(document, label, session, current)).toBe(
        current,
      );
      expect(
        editedBoundAnnotationName(
          document,
          label,
          updateTextEditingSession(session, {
            content: { runs: [{ kind: "text", value: typed }] },
          }),
          current,
        ),
      ).toBe(expected);
      expect(
        editedBoundAnnotationName(
          document,
          label,
          updateTextEditingSession(session, {
            content: {
              runs: [
                { kind: "span", style: "bold", children: session.content.runs },
              ],
            },
          }),
          current,
        ),
      ).toBe(current);
    }
  });
  it("names a signal's complement when its label gains or loses an overbar", () => {
    const document = createEmptyDocument("complement", "Complement");
    document.instances.push({
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: null,
    });
    document.netlist!.terminals.push(
      {
        id: "pin-d",
        name: "D",
        netId: "net-d",
        direction: "input",
        interfaceInstanceIds: [],
      },
      {
        id: "pin-q",
        name: "Q_bar",
        netId: "net-q",
        direction: "output",
        interfaceInstanceIds: [],
      },
    );
    const bound = (id: string, binding: Annotation["binding"]): Annotation => ({
      ...annotation(),
      id,
      kind: "instance-label",
      content: undefined,
      netId: undefined,
      binding,
    });
    const pinD = bound("pin-d-label", {
      kind: "cell-terminal-name",
      terminalId: "pin-d",
    });
    const pinQ = bound("pin-q-label", {
      kind: "cell-terminal-name",
      terminalId: "pin-q",
    });
    const device = bound("m1-label", {
      kind: "instance-reference",
      instanceId: "M1",
    });
    const overbar = (value: string) => ({
      runs: [
        {
          kind: "span" as const,
          style: "overbar" as const,
          children: [{ kind: "text" as const, value }],
        },
      ],
    });
    const edit = (
      label: Annotation,
      content: RichTextDocument,
      current: string,
    ) =>
      editedBoundAnnotationName(
        document,
        label,
        updateTextEditingSession(
          createTextEditingSession(
            { owner: "annotation", object: label },
            document,
          ),
          { content },
        ),
        current,
      );
    // D under an overbar is D_bar, a signal apart from D.
    expect(edit(pinD, overbar("D"), "D")).toBe("D_bar");
    // Typed and barred at once: the new name's complement.
    expect(edit(pinD, overbar("CLK"), "D")).toBe("CLK_bar");
    // Taking the overbar off Q_bar (drawn Q̄) gives Q back.
    expect(edit(pinQ, { runs: [{ kind: "text", value: "Q" }] }, "Q_bar")).toBe(
      "Q",
    );
    // A device reference has no complement: its overbar stays styling.
    expect(edit(device, overbar("M1"), "M1")).toBe("M1");
  });
  it("edits a scalar Value at its source and leaves compound MOS values to Properties", () => {
    const document = createEmptyDocument("value", "Value");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: { parameters: { value: "1k", tc: "0.01" } },
    });
    const label: Annotation = {
      ...annotation(),
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "R1" },
    };
    document.annotations = [label];
    const edit = (value: string) =>
      proposeTextEditingCommit(
        document,
        updateTextEditingSession(
          createTextEditingSession(
            { owner: "annotation", object: label },
            document,
          ),
          { content: { runs: [{ kind: "text", value }] } },
        ),
      );
    expect(edit("10k")).toMatchObject({
      kind: "update",
      beforeEdits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "R1",
          set: { value: "10k" },
        },
      ],
    });
    expect(edit("Value")).toMatchObject({
      kind: "update",
      beforeEdits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "R1",
          set: { value: "Value" },
        },
      ],
      edit: {
        annotation: {
          binding: { kind: "instance-value", instanceId: "R1" },
        },
      },
    });
    expect(edit("")).toMatchObject({
      kind: "delete",
      edit: {
        kind: "remove_schematic_annotation",
        annotationId: label.id,
      },
    });
    document.instances[0] = {
      id: "R1",
      symbolId: "nmos",
      placement: null,
      netlist: { parameters: { w: "1u", l: "150n" } },
    };
    expect(edit("10u")).toMatchObject({
      kind: "blocked",
      message: expect.stringContaining("Properties"),
    });
  });

  it("creates one session shape from semantic annotations and drafting text", () => {
    const annotationSession = createTextEditingSession({
      owner: "annotation",
      object: annotation(),
    });
    expect(annotationSession).toMatchObject({
      owner: "annotation",
      id: "annotation-1",
      sizeScale: 1,
    });
    expect(annotationSession.content.runs.length).toBeGreaterThan(0);

    expect(
      createTextEditingSession({ owner: "drafting", object: draftingText() }),
    ).toEqual({
      owner: "drafting",
      id: "drafting-1",
      content: { runs: [{ kind: "text", value: "Design note" }] },
      sizeScale: 1,
      alignment: "middle",
      bound: false,
      defaultBold: true,
    });
  });

  it("opens Net names as bound RichText while Route markers stay compact", () => {
    const netLabel = {
      ...annotation(),
      binding: { kind: "net-name" as const, netId: "net-1" },
    };
    const netLabelSession = createTextEditingSession({
      owner: "annotation",
      object: netLabel,
    });
    expect(netLabelSession).toMatchObject({
      bound: true,
      bindingKind: "net-name",
    });
    expect(netLabelSession).not.toHaveProperty("plainTextKind");
    expect(
      createTextEditingSession({
        owner: "annotation",
        object: {
          ...annotation(),
          kind: "route-marker",
          markerKind: "current",
        },
      }),
    ).toMatchObject({ plainTextKind: "route-marker" });
  });

  it("keeps untouched bold defaults revision-free and persists explicit normal text", () => {
    const object = draftingText();
    const document = {
      ...createEmptyDocument("text", "Text"),
      drafting: { objects: [object] },
    };
    const session = createTextEditingSession({ owner: "drafting", object });
    expect(session.defaultBold).toBe(true);
    expect(proposeTextEditingCommit(document, session)).toEqual({
      kind: "unchanged",
    });
    // Unbold keeps the same characters/AST but must change the effective weight.
    const proposal = proposeTextEditingCommit(
      document,
      updateTextEditingSession(session, { content: object.content }),
    );
    expect(proposal).toMatchObject({
      kind: "update",
      edit: {
        kind: "upsert_drafting_object",
        object: { styleOverride: { weight: "normal" } },
      },
    });
    if (
      proposal.kind !== "update" ||
      proposal.edit.kind !== "upsert_drafting_object" ||
      proposal.edit.object.kind !== "text"
    )
      throw new Error("Expected text update");
    const normal = proposal.edit.object;
    const reopened = createTextEditingSession({
      owner: "drafting",
      object: normal,
    });
    expect(reopened.defaultBold).toBe(false);
    expect(
      proposeTextEditingCommit(
        { ...document, drafting: { objects: [normal] } },
        reopened,
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it("updates session content and size without mutating the original", () => {
    const original = createTextEditingSession({
      owner: "drafting",
      object: draftingText(),
    });
    const next = updateTextEditingSession(original, { sizeScale: 1.4 });
    expect(next.sizeScale).toBe(1.4);
    expect(original.sizeScale).toBe(1);
  });

  it("distinguishes typing from an explicit presentation change", () => {
    const original = createTextEditingSession({
      owner: "drafting",
      object: draftingText(),
    });
    const typed = updateTextEditingSession(original, {
      content: { runs: [{ kind: "text", value: "Vinput" }] },
    });
    expect(typed.formatEdited).toBeUndefined();

    const formatted = updateTextEditingSession(typed, {
      content: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "Vinput" }],
          },
        ],
      },
    });
    expect(formatted.formatEdited).toBe(true);
  });

  it("does not mistake a stored voltage default for manual formatting", () => {
    const document = createEmptyDocument("text", "Text");
    document.netlist!.terminals.push({
      id: "terminal-vout",
      name: "Vout",
      netId: "net-vout",
      direction: "output",
      interfaceInstanceIds: [],
    });
    const bound: Annotation = {
      id: "annotation-vout",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-vout" },
      formatOverride: semanticTextDocument("Vout", "formal-port"),
      anchor: { kind: "free", position: { x: 10, y: 20 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };

    const automatic = createTextEditingSession(
      { owner: "annotation", object: bound },
      document,
    );
    expect(automatic.formatEdited).toBeUndefined();

    const manual = createTextEditingSession(
      {
        owner: "annotation",
        object: {
          ...bound,
          formatOverride: {
            runs: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: "Vout" }],
              },
            ],
          },
        },
      },
      document,
    );
    expect(manual.formatEdited).toBe(true);
  });

  it("keeps a stored standard look as a default whose text renames verbatim", () => {
    const document = createEmptyDocument("text", "Text");
    document.netlist!.terminals.push({
      id: "terminal-vdd",
      name: "VDD",
      netId: "net-vdd",
      direction: "inout",
      interfaceInstanceIds: [],
    });
    document.instances.push({
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: null,
    });
    const supply: Annotation = {
      id: "label-VDD1",
      kind: "power-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd" },
      formatOverride: supplyLabelFormat("VDD")!,
      netId: "net-vdd",
      anchor: { kind: "free", position: { x: 10, y: 20 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    const device: Annotation = {
      id: "instance-label-M1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
      formatOverride: roleLabelFormat("device-reference", "M1")!,
      anchor: { kind: "free", position: { x: 40, y: 20 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    const cases = [
      { label: supply, role: "supply" as const, name: "VDD", typed: "VDDH" },
      {
        label: device,
        role: "device-reference" as const,
        name: "M1",
        typed: "M12",
      },
    ];
    for (const { label, role, name, typed } of cases) {
      const session = createTextEditingSession(
        { owner: "annotation", object: label },
        document,
      );
      expect(session.formatEdited).toBeUndefined();
      expect(roleLabelDefault(document, label)).toEqual({ role, name });

      // Typing keeps the characters exactly and regenerates the look.
      const edited = updateTextEditingSession(session, {
        content: roleLabelFormat(role, typed)!,
      });
      const renamed = editedBoundAnnotationName(document, label, edited, name);
      expect(renamed).toBe(typed);
      expect(editedRoleLabelFormat(document, label, edited, renamed)).toEqual({
        format: roleLabelFormat(role, typed),
      });

      // Restyling alone never renames, and the author's look is kept.
      const flat = { runs: [{ kind: "text" as const, value: name }] };
      const restyled = updateTextEditingSession(session, { content: flat });
      expect(restyled.formatEdited).toBe(true);
      expect(editedBoundAnnotationName(document, label, restyled, name)).toBe(
        name,
      );
      expect(editedRoleLabelFormat(document, label, restyled, name)).toEqual({
        format: flat,
      });

      // An author's own format is not treated as the default.
      const authored = { ...label, formatOverride: flat };
      expect(roleLabelDefault(document, authored)).toBeUndefined();
      expect(
        createTextEditingSession(
          { owner: "annotation", object: authored },
          document,
        ).formatEdited,
      ).toBe(true);
    }
    // A name without a standard form returns to the ordinary rules.
    expect(
      editedRoleLabelFormat(
        document,
        supply,
        updateTextEditingSession(
          createTextEditingSession(
            { owner: "annotation", object: supply },
            document,
          ),
          { content: { runs: [{ kind: "text", value: "AVDD" }] } },
        ),
        "AVDD",
      ),
    ).toEqual({ format: undefined });
  });

  it("never turns a subscript into characters of the name, but bars a complement", () => {
    const document = createEmptyDocument("text", "Text");
    document.netlist!.terminals.push({
      id: "pin-clk",
      name: "CLK1",
      netId: "net-clk",
      direction: "input",
      interfaceInstanceIds: [],
    });
    const pin: Annotation = {
      ...annotation(),
      kind: "instance-label",
      content: undefined,
      netId: undefined,
      binding: { kind: "cell-terminal-name", terminalId: "pin-clk" },
    };
    const session = createTextEditingSession(
      { owner: "annotation", object: pin },
      document,
    );
    const text = (value: string) => ({ kind: "text" as const, value });
    const renamed = (content: RichTextDocument) =>
      editedBoundAnnotationName(
        document,
        pin,
        updateTextEditingSession(session, { content }),
        "CLK1",
      );
    // CLK with a subscript 1 is still CLK1, not CLK_1.
    expect(
      renamed({
        runs: [
          text("CLK"),
          { kind: "span", style: "subscript", children: [text("1")] },
        ],
      }),
    ).toBe("CLK1");
    // An overbar over a signal means its complement: CLK1_bar, not CLK1.
    expect(
      renamed({
        runs: [{ kind: "span", style: "overbar", children: [text("CLK1")] }],
      }),
    ).toBe("CLK1_bar");
  });

  it("splices a text edit into the name around characters the look hid", () => {
    // Plain names change exactly as typed.
    expect(spliceVisibleEdit("VDD", "VDD", "VDDA")).toBe("VDDA");
    expect(spliceVisibleEdit("M1", "M1", "M12")).toBe("M12");
    // A hidden underscore before a subscript stays in place.
    expect(spliceVisibleEdit("V_ref", "Vref", "Vrefx")).toBe("V_refx");
    expect(spliceVisibleEdit("V_ref", "Vref", "Vout")).toBe("V_out");
    // A hidden trailing _bar stays after the edited characters.
    expect(spliceVisibleEdit("D_bar", "D", "Dx")).toBe("Dx_bar");
    expect(spliceVisibleEdit("D_bar", "D", "E")).toBe("E_bar");
  });

  it("resolves only the tagged target kind", () => {
    const document = {
      ...createEmptyDocument("text", "Text"),
      annotations: [annotation()],
      drafting: { objects: [draftingText()] },
    };
    const annotationSession = createTextEditingSession({
      owner: "annotation",
      object: annotation(),
    });
    expect(resolveTextEditingTarget(document, annotationSession)).toMatchObject(
      {
        owner: "annotation",
        object: { id: "annotation-1" },
      },
    );
    expect(
      resolveTextEditingTarget(document, {
        ...annotationSession,
        owner: "drafting",
      }),
    ).toBeNull();
  });

  it("proposes typed updates for both persistence owners", () => {
    const base = createEmptyDocument("text", "Text");
    const document = {
      ...base,
      annotations: [annotation()],
      drafting: { objects: [draftingText()] },
    };
    const annotationSession = updateTextEditingSession(
      createTextEditingSession({ owner: "annotation", object: annotation() }),
      { content: { runs: [{ kind: "text", value: "Vbias" }] } },
    );
    expect(proposeTextEditingCommit(document, annotationSession)).toMatchObject(
      {
        kind: "update",
        edit: {
          kind: "upsert_schematic_annotation",
          annotation: {
            content: { runs: [{ kind: "text", value: "Vbias" }] },
          },
        },
      },
    );

    const draftingSession = updateTextEditingSession(
      createTextEditingSession({
        owner: "drafting",
        object: draftingText(),
      }),
      { sizeScale: 1.5 },
    );
    expect(proposeTextEditingCommit(document, draftingSession)).toMatchObject({
      kind: "update",
      edit: {
        kind: "upsert_drafting_object",
        object: { styleOverride: { sizeScale: 1.5 } },
      },
    });
  });

  it("distinguishes no-op, blank deletion, locked, and missing outcomes", () => {
    const object = { ...draftingText(), styleOverride: { sizeScale: 1 } };
    const document = {
      ...createEmptyDocument("text", "Text"),
      drafting: { objects: [object] },
    };
    const session = createTextEditingSession({ owner: "drafting", object });
    expect(proposeTextEditingCommit(document, session)).toEqual({
      kind: "unchanged",
    });

    const blank = updateTextEditingSession(session, {
      content: { runs: [{ kind: "text", value: "   " }] },
    });
    expect(proposeTextEditingCommit(document, blank)).toEqual({
      kind: "delete",
      edit: { kind: "remove_drafting_object", objectId: "drafting-1" },
      id: "drafting-1",
    });

    expect(
      proposeTextEditingCommit(
        {
          ...document,
          drafting: { objects: [{ ...object, locked: true }] },
        },
        updateTextEditingSession(session, { sizeScale: 1.2 }),
      ),
    ).toEqual({ kind: "blocked" });
    expect(
      proposeTextEditingCommit(
        createEmptyDocument("missing", "Missing"),
        session,
      ),
    ).toEqual({ kind: "blocked" });
  });

  it("keeps an emptied polarity label alive as its bare marks", () => {
    const object = { ...draftingText(), polarity: "both" as const };
    const document = {
      ...createEmptyDocument("text", "Text"),
      drafting: { objects: [object] },
    };
    const session = createTextEditingSession({ owner: "drafting", object });
    const blank = updateTextEditingSession(session, {
      content: { runs: [{ kind: "text", value: "   " }] },
    });
    // The + / − marks are the component; clearing the center text updates the
    // object to the canonical empty document instead of deleting it.
    expect(proposeTextEditingCommit(document, blank)).toMatchObject({
      kind: "update",
      edit: {
        kind: "upsert_drafting_object",
        object: {
          id: "drafting-1",
          polarity: "both",
          content: { runs: [{ kind: "line-break" }] },
        },
      },
    });
  });

  it("creates deletion edits from the session owner", () => {
    const session = createTextEditingSession({
      owner: "annotation",
      object: annotation(),
    });
    expect(textDeletionEdit(session)).toEqual({
      kind: "remove_schematic_annotation",
      annotationId: "annotation-1",
    });
  });
});

describe("Symbol body text edits like a label", () => {
  const dacPresentation = {
    defaultFormula: "DAC",
    supportsCoefficient: false,
    center: { x: 0, y: 0 },
    fontSize: 12,
  };
  const delayPresentation = {
    defaultFormula: "z^-1",
    supportsCoefficient: true,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 40,
      minBodyHeight: 30,
      horizontalPadding: 8,
      verticalPadding: 4,
      leadLength: 10,
    },
  };
  type Parameters = NonNullable<Instance["signalFlowParameters"]>;
  const block = (symbolId: string, signalFlowParameters?: Parameters) => ({
    id: "X1",
    symbolId,
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(signalFlowParameters ? { signalFlowParameters } : {}),
  });
  const drawingWith = (instance: Instance) => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(instance);
    return document;
  };
  const open = (
    document: SchematicDocument,
    presentation: typeof dacPresentation | typeof delayPresentation,
  ) =>
    createTextEditingSession(
      {
        owner: "instance-formula",
        object: document.instances[0]!,
        presentation,
      },
      document,
    );
  const bold = (...children: RichTextRun[]): RichTextDocument => ({
    runs: [{ kind: "span", style: "bold", children }],
  });
  const text = (value: string): RichTextRun => ({ kind: "text", value });

  // What the editor opens on is what the canvas draws, word or formula. A
  // converter's word stands upright; only a single-letter quantity slants.
  it("opens on a body word in the drawing's label look, upright", () => {
    const document = drawingWith(block("dac"));
    const session = open(document, dacPresentation);

    expect(session.content).toEqual(
      signalFlowBodyTextDocument(
        dacPresentation,
        undefined,
        document.presentation,
      ),
    );
    expect(flattenRichText(session.content)).toBe("DAC");
    expect(session).toMatchObject({ defaultBold: true, defaultItalic: false });
  });

  it("opens on a transfer function with its superscript", () => {
    const session = open(drawingWith(block("unit-delay")), delayPresentation);

    expect(session.content).toEqual(
      bold(text("z"), {
        kind: "span",
        style: "superscript",
        children: [text("-1")],
      }),
    );
  });

  it("stores only the text when it keeps the look plain text draws in", () => {
    const document = drawingWith(block("unit-delay"));
    const session = updateTextEditingSession(
      open(document, delayPresentation),
      {
        content: bold(text("H(s)")),
      },
    );

    expect(proposeTextEditingCommit(document, session)).toEqual({
      kind: "update",
      id: "X1",
      edit: {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "X1",
        parameters: { formula: "H(s)" },
      },
    });
  });

  // Typed text is source, as a label's name is: the drawing's label rules
  // keep drawing it, so a typed underscore becomes a subscript by rule.
  it("stores typed text as source that the drawing's rules keep drawing", () => {
    const lettered = {
      defaultFormula: "A",
      supportsCoefficient: false,
      center: { x: 0, y: 0 },
      fontSize: 16,
    };
    const document = drawingWith(block("opamp-lettered"));
    const session = updateTextEditingSession(open(document, lettered), {
      content: { runs: [text("A_gain")] },
    });

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      edit: { parameters: { formula: "A_gain" } },
    });
    expect(proposeTextEditingCommit(document, session)).not.toMatchObject({
      edit: { parameters: { formulaFormat: expect.anything() } },
    });
  });

  it("spells a transfer function's scripts back into its source", () => {
    const document = drawingWith(block("unit-delay"));
    const session = updateTextEditingSession(
      open(document, delayPresentation),
      {
        content: bold(
          text("z"),
          { kind: "span", style: "superscript", children: [text("-1")] },
          text("+1"),
        ),
      },
    );

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      edit: { parameters: { formula: "z^-1+1" } },
    });
  });

  // The owner's request: slant, scripts and every other format a label
  // keeps, the body text keeps too, once the author sets them.
  it("stores the author's look beside its text and reopens on it", () => {
    const document = drawingWith(block("dac"));
    const italic = (...children: RichTextRun[]): RichTextDocument => ({
      runs: [
        { kind: "span", style: "italic", children: bold(...children).runs },
      ],
    });
    const look = italic(text("DAC"), {
      kind: "span",
      style: "subscript",
      children: [text("1")],
    });
    // A slanted DAC first (a formatting command), then its subscript.
    const slanted = updateTextEditingSession(open(document, dacPresentation), {
      content: italic(text("DAC")),
    });
    const session = updateTextEditingSession(slanted, { content: look });

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      kind: "update",
      edit: { parameters: { formula: "DAC1", formulaFormat: look } },
    });
    const reopened = open(
      drawingWith(block("dac", { formula: "DAC1", formulaFormat: look })),
      dacPresentation,
    );
    expect(reopened.content).toEqual(look);
    expect(reopened.formatEdited).toBe(true);
  });

  it("keeps the block's other parameters when its text changes", () => {
    const document = drawingWith(
      block("unit-delay", { formula: "z^-2", coefficient: "K", bodyWidth: 60 }),
    );
    const session = updateTextEditingSession(
      open(document, delayPresentation),
      {
        content: bold(text("H(s)")),
      },
    );

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      edit: {
        parameters: { coefficient: "K", bodyWidth: 60, formula: "H(s)" },
      },
    });
  });

  // The Symbol's own text in its own look is not an override: storing it
  // would freeze a copy of a default that is allowed to change.
  it("clears the override when the Symbol's own text and look return", () => {
    const document = drawingWith(block("dac", { formula: "8-bit" }));
    const own = open(drawingWith(block("dac")), dacPresentation).content;
    const session = updateTextEditingSession(open(document, dacPresentation), {
      content: own,
    });

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      kind: "update",
      edit: { parameters: null },
    });
  });

  it("reports no change when the text is untouched", () => {
    const document = drawingWith(block("dac", { formula: "8-bit" }));

    expect(
      proposeTextEditingCommit(document, open(document, dacPresentation)),
    ).toEqual({ kind: "unchanged" });
  });
});

it("changing typography on a historical subscript does not rename the instance", () => {
  const document = createEmptyDocument("old", "Old");
  document.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "nmos",
    placement: null,
  });
  const label: Annotation = {
    ...annotation(),
    kind: "instance-label",
    netId: undefined,
    content: undefined,
    binding: { kind: "instance-reference", instanceId: "M1" },
    formatOverride: defaultDraftTextDocument("M1"),
  };
  document.annotations.push(label);
  const session = createTextEditingSession(
    { owner: "annotation", object: label },
    document,
  );
  const edited = updateTextEditingSession(session, {
    content: {
      runs: [
        { kind: "text", value: "M" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "1" }],
        },
      ],
    },
  });
  const proposal = proposeTextEditingCommit(document, edited);
  expect(proposal.kind).toBe("update");
  if (proposal.kind === "update")
    expect(proposal.beforeEdits ?? []).toEqual([]);
});

it("keeps an overbar as the label's look without renaming the instance", () => {
  const document = createEmptyDocument("bar", "Bar");
  document.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "nmos",
    placement: null,
  });
  const label: Annotation = {
    ...annotation(),
    kind: "instance-label",
    netId: undefined,
    content: undefined,
    binding: { kind: "instance-reference", instanceId: "M1" },
  };
  document.annotations.push(label);
  const original = createTextEditingSession(
    { owner: "annotation", object: label },
    document,
  );
  const edited = updateTextEditingSession(original, {
    content: {
      runs: [
        { kind: "span", style: "overbar", children: original.content.runs },
      ],
    },
  });
  const barred = proposeTextEditingCommit(document, edited);
  expect(barred.kind).toBe("update");
  if (barred.kind === "update") {
    // The Reference stays M1; the bar is stored as the label's format.
    expect(barred.beforeEdits ?? []).toEqual([]);
    expect(barred.edit).toMatchObject({
      kind: "upsert_schematic_annotation",
      annotation: { formatOverride: edited.content },
    });
  }
  const alias = proposeTextEditingCommit(document, {
    ...edited,
    displayAlias: true,
  });
  expect(alias.kind).toBe("update");
  if (alias.kind === "update") expect(alias.beforeEdits ?? []).toEqual([]);
});

it("shows the underscore again when its subscript is removed, without renaming", () => {
  const document = createEmptyDocument("manual", "Manual");
  document.presentation.labelSubscriptAfterFirst = true;
  document.instances.push({
    id: "M1",
    reference: "M_load",
    symbolId: "nmos",
    placement: null,
  });
  const label: Annotation = {
    ...annotation(),
    kind: "instance-label",
    netId: undefined,
    content: undefined,
    binding: { kind: "instance-reference", instanceId: "M1" },
  };
  document.annotations.push(label);
  const session = createTextEditingSession(
    { owner: "annotation", object: label },
    document,
  );
  const content = { runs: [{ kind: "text" as const, value: "Mload" }] };
  const proposal = proposeTextEditingCommit(
    document,
    updateTextEditingSession(session, { content }),
  );
  // Restyling never renames: M_load keeps its underscore, which is shown
  // once no subscript hides it. Renaming goes through the name itself.
  expect(proposal.kind).toBe("update");
  if (proposal.kind === "update") {
    expect(proposal.beforeEdits ?? []).toEqual([]);
    expect(proposal.edit).toMatchObject({
      kind: "upsert_schematic_annotation",
      annotation: {
        formatOverride: { runs: [{ kind: "text", value: "M_load" }] },
      },
    });
  }
});
