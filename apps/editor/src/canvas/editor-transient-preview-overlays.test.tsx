import { resolveDocumentStyleProfile } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EditorInteractionPreviews,
  EditorPlacementPreview,
} from "./editor-transient-preview-overlays";

describe("editor transient preview overlays", () => {
  it("renders a power-rail draft between its two points", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <EditorPlacementPreview
          vddRailMode
          vddRailStart={{ x: 10, y: 20 }}
          previewPoint={{ x: 10, y: 120 }}
          powerRailStrokeWidth={3}
          styleProfileId="razavi-textbook-v1"
          pendingSymbolId={null}
          rotation={0}
          mirror="none"
        />
      </svg>,
    );
    expect(markup).toContain('data-testid="vdd-rail-preview"');
    expect(markup).toContain('y2="120"');
  });

  it("renders directional selection boxes and wire snap previews", () => {
    const styleProfile = resolveDocumentStyleProfile(
      createEmptyDocument("cell", "Cell").presentation,
    );
    const markup = renderToStaticMarkup(
      <svg>
        <EditorInteractionPreviews
          boxPreview={{
            start: { x: 100, y: 20 },
            end: { x: 20, y: 80 },
            pointerId: 1,
            intent: "select",
          }}
          draftingSource={null}
          draftingWaypoints={[]}
          draftingHover={null}
          draftingSnapPoint={null}
          tool="wire"
          styleProfile={styleProfile}
          wirePreviewPoint={{ x: 40, y: 50 }}
          textEditing={null}
          textEditingBounds={null}
          viewBox={{ x: 0, y: 0, width: 200, height: 100 }}
          textEditingLocked={false}
          onTextUpdate={vi.fn()}
          onTextCommit={vi.fn()}
          onTextCancel={vi.fn()}
          onTextDelete={vi.fn()}
        />
      </svg>,
    );
    expect(markup).toContain('data-testid="selection-box"');
    expect(markup).toContain('class="selection-box selection-box--crossing"');
    expect(markup).toContain('class="snap-preview"');
  });
});
