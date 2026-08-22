import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { DocumentSettingsSection } from "./document-settings-section";
import { normalizedStyleOverrides, styleOverrideDraft } from "./style-knobs";

describe("style knobs", () => {
  it("treats a factor of 1 as the profile default and writes nothing", () => {
    expect(
      normalizedStyleOverrides({
        fontScale: 1,
        wireStrokeScale: 1,
        symbolStrokeScale: 1,
        annotationStrokeScale: 1,
        junctionRadiusScale: 1,
      }),
    ).toBeNull();
  });

  it("persists only the factors that moved", () => {
    expect(
      normalizedStyleOverrides({
        fontScale: 1.5,
        wireStrokeScale: 1,
        symbolStrokeScale: 1,
        annotationStrokeScale: 1,
        junctionRadiusScale: 0.5,
      }),
    ).toEqual({ fontScale: 1.5, junctionRadiusScale: 0.5 });
  });

  it("normalizes an absent override back to 1", () => {
    expect(styleOverrideDraft(undefined).fontScale).toBe(1);
    expect(styleOverrideDraft({ fontScale: 2 }).wireStrokeScale).toBe(1);
  });
});

describe("DocumentSettingsSection", () => {
  it("carries the style knobs and the Document-wide bulk defaults", () => {
    const markup = renderToStaticMarkup(
      <DocumentSettingsSection
        document={createEmptyDocument("document-main", "Main")}
        onApplyStyle={vi.fn()}
        onChangeBulkDefault={vi.fn()}
      />,
    );

    // Docked beside the canvas, not a dialog that hides what it rescales.
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('aria-label="Document settings"');
    expect(markup).toContain('aria-label="Font size"');
    expect(markup).toContain('aria-label="Junction dot size"');
    // One Net answers for every NMOS or PMOS, so these belong to the Document
    // rather than to whichever transistor is selected.
    expect(markup).toContain('aria-label="Default NMOS bulk Net"');
    expect(markup).toContain('aria-label="Default PMOS bulk Net"');
  });
});
