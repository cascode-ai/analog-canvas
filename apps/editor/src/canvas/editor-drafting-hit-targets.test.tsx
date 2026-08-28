import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorDraftingHandles } from "./editor-drafting-hit-targets";

describe("EditorDraftingHandles", () => {
  it("shows one uniform scale handle for a selected waveform group", () => {
    const document = createEmptyDocument("main", "Waveform");
    document.drafting = {
      objects: [
        {
          id: "wave-a",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 20 } },
          points: [
            { x: 20, y: 20 },
            { x: 120, y: 20 },
          ],
          lineStyle: "solid",
        },
        {
          id: "wave-b",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 60 } },
          points: [
            { x: 20, y: 60 },
            { x: 120, y: 60 },
          ],
          lineStyle: "solid",
        },
      ],
    };
    document.layoutGroups.push({
      id: "waveform-group-1",
      kind: "custom",
      objectIds: ["wave-a", "wave-b"],
      locked: false,
    });

    const markup = renderToStaticMarkup(
      <svg>
        <EditorDraftingHandles
          document={document}
          resolver={new InMemorySymbolResolver(builtInSymbols)}
          selectedDraftingId="wave-b"
          selectedDraftingIds={["wave-a", "wave-b"]}
          onHandlePointerDown={vi.fn()}
          onGroupScalePointerDown={vi.fn()}
          onDeleteVertex={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain(
      'data-testid="drafting-group-handles-waveform-group-1"',
    );
    expect(markup).toContain(
      'data-testid="draft-group-scale-waveform-group-1"',
    );
    expect(markup).not.toContain("draft-handle-vx-");
  });
});
