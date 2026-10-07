import { describe, it, expect } from "vitest";
import type { ProjectModelSource } from "@icm/model";
import {
  renderProjectModelSource,
  inspectProjectModelSource,
} from "./project-model-source.js";

describe("native Project model closure", () => {
  it("preserves two authored include visits without multiplying nested includes", () => {
    const source: ProjectModelSource = {
      id: "repeated",
      revision: 1,
      language: "spice",
      entry: "main.spice",
      dependencies: [],
      files: [
        {
          path: "main.spice",
          text: '.include "params.spice"\n.include "params.spice"\n.subckt amp A\nR1 A 0 1k\n.ends amp\n',
        },
        { path: "params.spice", text: '.include "bias.spice"\n' },
        { path: "bias.spice", text: ".param bias=3\n" },
      ],
    };
    expect(
      inspectProjectModelSource(source).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    expect(
      renderProjectModelSource(source).text.match(/\.param bias=3/gu),
    ).toHaveLength(2);
  });
  it("rebases declared dependency loads to the emitted file while retaining body bytes", () => {
    const body = ".subckt amp A B\nR1 A B 1k\n.ends amp\n";
    const source: ProjectModelSource = {
      id: "model",
      revision: 1,
      language: "spice",
      entry: "owned/main.spice",
      files: [
        {
          path: "owned/main.spice",
          text: '.lib "../vendor/library.spice" tt\n' + body,
        },
      ],
      dependencies: [
        {
          id: "library",
          mountPath: "vendor/library.spice",
          sha256: "a".repeat(64),
        },
      ],
    };
    expect(
      inspectProjectModelSource(source).diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([]);
    const rendered = renderProjectModelSource(source, {
      outputPath: "generated/circuit.spice",
    });
    expect(rendered.text).toContain('.lib "../vendor/library.spice" tt');
    const root = renderProjectModelSource(source);
    expect(root.text).toContain('.lib "vendor/library.spice" tt');
    expect(root.text).toContain(body);
    for (const location of root.segments)
      expect(root.text.slice(location.startOffset, location.endOffset)).toBe(
        source.files[0]!.text.slice(
          location.sourceOffset,
          location.sourceOffset + location.endOffset - location.startOffset,
        ),
      );
  });
});
