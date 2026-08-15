import { describe, expect, it } from "vitest";

import {
  activateInteractionTool,
  interactionReducer,
  interactionTool,
} from "./interaction-state";

describe("editor interaction state", () => {
  it("makes creation modes mutually exclusive", () => {
    const drawing = activateInteractionTool("arrow");
    expect(drawing.kind).toBe("drawing");

    const wiring = interactionReducer(drawing, {
      type: "activate-tool",
      tool: "wire",
    });
    expect(wiring).toEqual({
      kind: "wire",
      source: null,
      sourceRevision: null,
      previewPoint: null,
      waypoints: [],
    });
    expect(interactionTool(wiring)).toBe("wire");
  });

  it("keeps an in-progress wire when Wire is activated again", () => {
    const source = {
      endpoint: { kind: "junction" as const, junctionId: "J1" },
      netId: "n1",
      point: { x: 10, y: 20 },
      preludeEdits: [],
    };
    let state = activateInteractionTool("wire");
    state = interactionReducer(state, {
      type: "set-wire-source",
      source,
      sourceRevision: 7,
    });
    state = interactionReducer(state, {
      type: "set-wire-waypoints",
      update: [{ x: 30, y: 20 }],
    });

    expect(
      interactionReducer(state, { type: "activate-tool", tool: "wire" }),
    ).toBe(state);
  });

  it("keeps in-progress drawing geometry when the same tool is activated", () => {
    let state = activateInteractionTool("arrow");
    state = interactionReducer(state, {
      type: "set-drawing-source",
      point: { x: 10, y: 20 },
    });
    state = interactionReducer(state, {
      type: "set-drawing-hover",
      point: { x: 80, y: 20 },
    });

    expect(
      interactionReducer(state, { type: "activate-tool", tool: "arrow" }),
    ).toBe(state);
  });

  it("cancels every creation mode to one idle state", () => {
    for (const tool of [
      "wire",
      "construction-line",
      "arrow",
      "rectangle",
    ] as const) {
      expect(
        interactionReducer(activateInteractionTool(tool), { type: "cancel" }),
      ).toEqual({ kind: "idle" });
    }
  });

  it("clears drawing geometry without leaving the active drawing tool", () => {
    let state = activateInteractionTool("construction-line");
    state = interactionReducer(state, {
      type: "set-drawing-source",
      point: { x: 10, y: 20 },
    });
    state = interactionReducer(state, {
      type: "set-drawing-waypoints",
      update: [{ x: 30, y: 20 }],
    });
    state = interactionReducer(state, { type: "clear-drawing" });

    expect(state).toEqual({
      kind: "drawing",
      tool: "construction-line",
      source: null,
      hover: null,
      waypoints: [],
      snapPoint: null,
    });
  });

  it("clears committed Wire geometry without leaving Wire mode", () => {
    let state = activateInteractionTool("wire");
    state = interactionReducer(state, {
      type: "set-wire-source",
      source: {
        endpoint: { kind: "junction", junctionId: "j1" },
        netId: "n1",
        point: { x: 10, y: 20 },
        preludeEdits: [],
      },
      sourceRevision: 7,
    });
    state = interactionReducer(state, {
      type: "set-wire-preview",
      point: { x: 30, y: 20 },
    });
    state = interactionReducer(state, {
      type: "set-wire-waypoints",
      update: [{ x: 20, y: 20 }],
    });

    expect(interactionReducer(state, { type: "complete-wire" })).toEqual({
      kind: "wire",
      source: null,
      sourceRevision: null,
      previewPoint: null,
      waypoints: [],
    });
  });

  it("carries component parameters and annotation choices only while placing", () => {
    const state = interactionReducer(
      { kind: "idle" },
      {
        type: "place-component",
        placement: {
          symbolId: "nmos",
          properties: { w: "2u", l: "150n", m: "2" },
          initialRotation: 90,
          showReference: false,
          referenceText: "MIN",
        },
      },
    );
    expect(state).toEqual({
      kind: "placing-component",
      placement: {
        symbolId: "nmos",
        properties: { w: "2u", l: "150n", m: "2" },
        initialRotation: 90,
        showReference: false,
        referenceText: "MIN",
      },
      rotation: 90,
      previewPoint: null,
    });
    expect(interactionReducer(state, { type: "cancel" })).toEqual({
      kind: "idle",
    });
  });

  it("keeps repeated Copy idempotent and replaces it atomically with a tool", () => {
    const clipboard = { ids: ["M1"] };
    const copying = interactionReducer<{ ids: string[] }>(
      { kind: "idle" },
      {
        type: "begin-copy-placement",
        clipboard,
        anchor: { x: 10, y: 20 },
      },
    );
    const previewing = interactionReducer(copying, {
      type: "set-copy-preview",
      point: { x: 40, y: 50 },
    });
    const rotated = interactionReducer(previewing, {
      type: "rotate-copy",
      deltaDegrees: 90,
    });
    expect(rotated).toMatchObject({
      kind: "copy-placement",
      copy: { previewPoint: { x: 40, y: 50 }, rotation: 90 },
    });

    expect(
      interactionReducer(rotated, {
        type: "begin-copy-placement",
        clipboard: { ids: ["M2"] },
        anchor: { x: 0, y: 0 },
      }),
    ).toBe(rotated);
    expect(
      interactionReducer(rotated, {
        type: "activate-tool",
        tool: "wire",
      }),
    ).toEqual({
      kind: "wire",
      source: null,
      sourceRevision: null,
      previewPoint: null,
      waypoints: [],
    });
  });

  it("owns the complete VDD rail gesture and exits after commit", () => {
    let state = interactionReducer(
      { kind: "idle" },
      { type: "begin-vdd-rail" },
    );
    state = interactionReducer(state, {
      type: "set-vdd-rail-preview",
      point: { x: 20, y: 30 },
    });
    state = interactionReducer(state, {
      type: "set-vdd-rail-start",
      point: { x: 20, y: 30 },
    });
    state = interactionReducer(state, {
      type: "set-vdd-rail-preview",
      point: { x: 120, y: 30 },
    });

    expect(state).toEqual({
      kind: "placing-vdd-rail",
      start: { x: 20, y: 30 },
      previewPoint: { x: 120, y: 30 },
    });
    expect(interactionReducer(state, { type: "complete-vdd-rail" })).toEqual({
      kind: "idle",
    });
  });
});
