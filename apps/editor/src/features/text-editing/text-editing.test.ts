import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
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
    });
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
