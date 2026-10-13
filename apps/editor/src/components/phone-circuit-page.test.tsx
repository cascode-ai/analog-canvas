import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PhoneCircuitView,
  PhoneEditorNotice,
  type PhoneEntry,
} from "./phone-circuit-page";

const entry: PhoneEntry = {
  id: "efx8jakksk",
  name: "Five-transistor OTA",
  author: "Maker",
  description: "A textbook OTA.",
  createdAt: "2026-10-13T08:00:00.000Z",
  previewRevision: "a".repeat(64),
  tags: ["amplifier"],
  netlistable: true,
};

const view = (netlist: Parameters<typeof PhoneCircuitView>[0]["netlist"]) =>
  renderToStaticMarkup(
    createElement(PhoneCircuitView, {
      entry,
      netlist,
      copied: false,
      onShowNetlist: () => undefined,
      onCopyLink: () => undefined,
    }),
  );

describe("a phone's circuit page (2026-10-14)", () => {
  it("shows the circuit's picture and facts, its netlist on request, and the way to a computer", () => {
    const page = view(null);
    expect(page).toContain("Five-transistor OTA");
    expect(page).toContain("Maker · 2026-10-13 · Netlist");
    expect(page).toContain(
      `/api/gallery/efx8jakksk/preview.svg?v=${"a".repeat(64)}`,
    );
    expect(page).toContain("amplifier");
    expect(page).toContain('data-testid="phone-show-netlist"');
    expect(page).toContain("open its link on a computer");
    expect(page).toContain('data-testid="phone-editor-anyway"');
    const written = view({ status: "ready", text: "R1 a b 1k\n.end" });
    expect(written).toContain('data-testid="phone-netlist"');
    expect(written).toContain("R1 a b 1k");
    expect(written).not.toContain('data-testid="phone-show-netlist"');
    expect(
      view({
        status: "blocked",
        reasons: ["Instance R1 requires parameter value"],
      }),
    ).toContain(
      "does not yet make a netlist: Instance R1 requires parameter value",
    );
  });

  it("tells a phone opening the editor to draw on a computer or a tablet", () => {
    const page = renderToStaticMarkup(createElement(PhoneEditorNotice, {}));
    expect(page).toContain("Drawing needs a computer or a tablet");
    expect(page).toContain('href="/"');
    expect(page).toContain('data-testid="phone-editor-anyway"');
  });
});
