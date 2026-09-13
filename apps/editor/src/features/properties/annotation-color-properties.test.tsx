import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnnotationColorProperties } from "./annotation-color-properties";

describe("annotation color properties", () => {
  it("previews an instance label's inherited component ink while Auto", () => {
    const document = createEmptyDocument("cell", "Cell");
    const annotation: (typeof document.annotations)[number] = {
      id: "instance-label-R1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R1" }] },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: -20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    const markup = renderToStaticMarkup(
      <AnnotationColorProperties
        annotation={annotation}
        inheritedColor="#dc2626"
        onApply={() => ({ ok: true })}
      />,
    );

    expect(markup).toContain('aria-label="Text properties"');
    expect(markup).toContain("Annotation property code");
    expect(markup).toContain("auto");
    expect(markup).toContain("placement");
    expect(markup).toContain("appearance");
    expect(markup).toContain("content");
  });

  it("shows the annotation-owned override instead of inherited ink", () => {
    const document = createEmptyDocument("cell", "Cell");
    const annotation: (typeof document.annotations)[number] = {
      id: "value",
      kind: "instance-value",
      content: { runs: [{ kind: "text", value: "10k" }] },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      textColor: "#2563eb",
    };
    const markup = renderToStaticMarkup(
      <AnnotationColorProperties
        annotation={annotation}
        inheritedColor="#dc2626"
        onApply={() => ({ ok: true })}
      />,
    );

    expect(markup).toContain("[37, 99, 235]");
    expect(markup).toContain("Copy JSON");
  });
});
