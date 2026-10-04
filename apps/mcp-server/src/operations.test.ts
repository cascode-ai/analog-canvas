import { describe, expect, it } from "vitest";

import { withTiming } from "./operations.js";

describe("timing on a tool result (#1227)", () => {
  const request = {
    request: "circuit",
    startedAtMs: 1840,
    totalMs: 260,
    relayMs: 210,
    editorMs: 90,
    editorVisibility: "visible" as const,
  };

  it("reports the call, each hop, and a one-shot process's startup", () => {
    expect(withTiming({ ok: true }, 301.4, [request], true)).toEqual({
      ok: true,
      timing: {
        totalMs: 301,
        startupMs: 1840,
        requests: [
          {
            request: "circuit",
            totalMs: 260,
            relayMs: 210,
            editorMs: 90,
            editorVisibility: "visible",
          },
        ],
      },
    });
    // No request, or a result that is not an object: nothing to add.
    expect(withTiming({ ok: true }, 3, [], true)).toEqual({ ok: true });
    expect(withTiming("text", 3, [request], false)).toBe("text");
  });

  it("says when the editor was in the background or slow, with the fix", () => {
    const hidden = withTiming(
      { ok: true },
      400,
      [{ ...request, editorVisibility: "hidden" as const }],
      false,
    ) as { timing: { warning?: { code: string; message: string } } };
    expect(hidden.timing.warning).toMatchObject({ code: "EDITOR_BACKGROUND" });
    expect(hidden.timing.warning?.message).toContain("bring it to the front");
    const slow = withTiming(
      { ok: true },
      9000,
      [{ ...request, relayMs: 8800 }],
      false,
    ) as { timing: { warning?: { code: string; message: string } } };
    expect(slow.timing.warning?.message).toContain("took 9 s");
    expect(
      (withTiming({ ok: true }, 300, [request], false) as { timing: object })
        .timing,
    ).not.toHaveProperty("warning");
  });
});
