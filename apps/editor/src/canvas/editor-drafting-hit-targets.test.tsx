import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorDraftingHitTargets } from "./editor-drafting-hit-targets";
import {
  createSelectionPolicy,
  DEFAULT_SELECTION_FILTER,
} from "../features/selection/selection-filter";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("EditorDraftingHitTargets", () => {
  it("lets an active arrow draw and snap through existing drafting strokes", () => {
    const document = createEmptyDocument("main", "Drawing");
    document.drafting = {
      objects: [
        {
          id: "box",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <svg>
        <EditorDraftingHitTargets
          document={document}
          resolver={resolver}
          tool="arrow"
          selectedDraftingId={null}
          supplementalDraftingIds={[]}
          selectionPolicy={createSelectionPolicy(
            document,
            DEFAULT_SELECTION_FILTER,
          )}
          onConstructionLineEdit={vi.fn()}
          onArrowEdit={vi.fn()}
          onTextEdit={vi.fn()}
          onTextContextMenu={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain('data-testid="drafting-hit-box"');
    expect(markup).toContain('pointer-events="none"');
  });

  it("captures filled foreground interiors but lets background interiors pass through", () => {
    const document = createEmptyDocument("main", "Filled drawing");
    document.drafting = {
      objects: [
        {
          id: "back",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          layer: "background",
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
          styleOverride: { fillColor: "#9ca3af" },
        },
        {
          id: "front",
          kind: "circle",
          locked: false,
          zIndex: 3,
          layer: "foreground",
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          radius: 20,
          lineStyle: "solid",
          styleOverride: { fillColor: "#2563eb" },
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <svg>
        <EditorDraftingHitTargets
          document={document}
          resolver={resolver}
          tool="pointer"
          selectedDraftingId={null}
          supplementalDraftingIds={[]}
          selectionPolicy={createSelectionPolicy(
            document,
            DEFAULT_SELECTION_FILTER,
          )}
          onConstructionLineEdit={vi.fn()}
          onArrowEdit={vi.fn()}
          onTextEdit={vi.fn()}
          onTextContextMenu={vi.fn()}
        />
      </svg>,
    );
    expect(markup).toMatch(
      /data-testid="drafting-hit-back"[^>]*drafting-shape-background-hit/u,
    );
    expect(markup).toMatch(
      /data-testid="drafting-hit-front"[^>]*drafting-shape-filled-hit/u,
    );
    expect(markup.indexOf("drafting-hit-back")).toBeLessThan(
      markup.indexOf("drafting-hit-front"),
    );
  });
});
