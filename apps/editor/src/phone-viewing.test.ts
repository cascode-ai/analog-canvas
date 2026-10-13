import { describe, expect, it, vi } from "vitest";

import {
  isPhoneViewing,
  openEditorOnPhone,
  PHONE_EDITOR_KEY,
  PHONE_QUERY,
} from "./phone-viewing";

const screen = (matches: boolean, saved: Record<string, string> = {}) => ({
  matchMedia: (query: string) =>
    ({ matches: matches && query === PHONE_QUERY }) as MediaQueryList,
  sessionStorage: {
    getItem: (key: string) => saved[key] ?? null,
  } as unknown as Storage,
});

describe("phones view circuits, computers and tablets draw (2026-10-14)", () => {
  it("tells a phone by a narrow screen and a coarse pointer", () => {
    expect(isPhoneViewing(screen(true))).toBe(true);
    expect(isPhoneViewing(screen(false))).toBe(false);
    // The editor opened anyway, this tab keeps it.
    expect(isPhoneViewing(screen(true, { [PHONE_EDITOR_KEY]: "1" }))).toBe(
      false,
    );
    expect(
      isPhoneViewing({
        matchMedia: undefined as never,
        sessionStorage: screen(true).sessionStorage,
      }),
    ).toBe(false);
  });

  it("opens the editor anyway for this tab", () => {
    const saved = new Map<string, string>();
    const reload = vi.fn();
    openEditorOnPhone({
      sessionStorage: {
        setItem: (key: string, value: string) => void saved.set(key, value),
      } as unknown as Storage,
      location: { reload } as unknown as Location,
    });
    expect(saved.get(PHONE_EDITOR_KEY)).toBe("1");
    expect(reload).toHaveBeenCalled();
  });
});
