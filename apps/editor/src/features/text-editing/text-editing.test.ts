import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  semanticTextDocument,
  defaultDraftTextDocument,
} from "@icm/model";
import type { Annotation, DraftingObject } from "@icm/model";

import {
  createTextEditingSession,
  proposeTextEditingCommit,
  resolveTextEditingTarget,
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

describe("Symbol body text edits in place", () => {
  const dac = (formula?: string) => ({
    id: "X1",
    symbolId: "dac",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(formula ? { signalFlowParameters: { formula } } : {}),
  });

  // The text inside a Symbol body is a plain string with its own compact
  // script syntax, not a RichText document. It rides the same session so the
  // canvas overlay can host it, carried as one text run.
  it("opens a session on the Symbol's own default text", () => {
    const session = createTextEditingSession({
      owner: "instance-formula",
      object: dac(),
      defaultFormula: "DAC",
    });

    expect(session).toMatchObject({
      owner: "instance-formula",
      id: "X1",
      content: { runs: [{ kind: "text", value: "DAC" }] },
    });
  });

  it("opens a session on the override once the person has set one", () => {
    const session = createTextEditingSession({
      owner: "instance-formula",
      object: dac("8-bit"),
      defaultFormula: "DAC",
    });

    expect(session.content).toEqual({
      runs: [{ kind: "text", value: "8-bit" }],
    });
  });

  // Editing in place writes the same field the Properties panel writes, so the
  // two surfaces cannot drift: there is one value, not two copies of it.
  it("commits the edited text as a signal-flow parameter override", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(dac());
    const session = updateTextEditingSession(
      createTextEditingSession({
        owner: "instance-formula",
        object: dac(),
        defaultFormula: "DAC",
      }),
      { content: { runs: [{ kind: "text", value: "8-bit DAC" }] } },
    );

    expect(proposeTextEditingCommit(document, session)).toEqual({
      kind: "update",
      id: "X1",
      edit: {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "X1",
        parameters: { formula: "8-bit DAC" },
      },
    });
  });

  // Typing the Symbol's own default back is not an override: storing it would
  // freeze a copy of a default that is allowed to change.
  it("clears the override when the text returns to the Symbol default", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(dac("8-bit"));
    const session = updateTextEditingSession(
      createTextEditingSession({
        owner: "instance-formula",
        object: dac("8-bit"),
        defaultFormula: "DAC",
      }),
      { content: { runs: [{ kind: "text", value: "DAC" }] } },
    );

    expect(proposeTextEditingCommit(document, session)).toMatchObject({
      kind: "update",
      edit: { parameters: null },
    });
  });

  it("reports no change when the text is untouched", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(dac("8-bit"));

    expect(
      proposeTextEditingCommit(
        document,
        createTextEditingSession({
          owner: "instance-formula",
          object: dac("8-bit"),
          defaultFormula: "DAC",
        }),
      ),
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
