import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
  it("keeps one canonical JSON editor instead of a parallel settings form", () => {
    const markup = renderToStaticMarkup(
      <DocumentSettingsSection
        document={createEmptyDocument("document-main", "Main")}
        canvas={{
          showGrid: true,
          annotationGrid: 5,
          drawAngle: "free",
          scrollBehavior: "auto",
        }}
        onApply={() => ({ ok: true })}
      />,
    );

    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('aria-label="Document settings"');
    expect(markup).toContain('data-testid="document-settings-code-editor"');
    expect(markup).toContain('aria-label="Loading Properties code"');
    expect(markup).toContain("Properties code");
    expect(markup).toContain("&quot;appearance&quot;");
    expect(markup).toContain("&quot;bulkDefaults&quot;");
    expect(markup).toContain("&quot;labels&quot;");
    expect(markup).toContain("&quot;canvas&quot;");
    expect(markup).toContain("Copy Properties JSON");
    expect(markup).toContain("Defaults");
    expect(markup).not.toContain("Format all Port labels in this Cell");
    expect(markup).not.toContain("Existing suffix case");
    expect(markup).not.toContain("Existing suffix position");
  });
});
