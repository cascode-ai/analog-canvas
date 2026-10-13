import { describe, expect, it } from "vitest";

import { closesDetails } from "./dismiss-details";

describe("a details menu's dismissal", () => {
  const inside = { id: "inside" } as unknown as EventTarget;
  const outside = { id: "outside" } as unknown as EventTarget;
  const menu = (open: boolean) => ({
    open,
    contains: (node: Node | null) => node === (inside as unknown as Node),
  });

  it("closes an open menu on a press outside it or on Escape", () => {
    expect(
      closesDetails(menu(true), { type: "pointerdown", target: outside }),
    ).toBe(true);
    expect(
      closesDetails(menu(true), {
        type: "keydown",
        key: "Escape",
        target: inside,
      }),
    ).toBe(true);
  });

  it("leaves it alone on a press inside, another key, or when closed", () => {
    expect(
      closesDetails(menu(true), { type: "pointerdown", target: inside }),
    ).toBe(false);
    expect(
      closesDetails(menu(true), { type: "keydown", key: "a", target: outside }),
    ).toBe(false);
    expect(
      closesDetails(menu(false), { type: "pointerdown", target: outside }),
    ).toBe(false);
  });
});
