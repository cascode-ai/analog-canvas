import { describe, it, expect } from "vitest";
import type { ProjectModelSource } from "@icm/model";
import {
  renderProjectModelSource,
  inspectProjectModelSource,
  projectModelConversionDiagnostic,
} from "./project-model-source.js";

describe("native Project model closure", () => {
  it("resolves embedded SPICE section case while preserving native Spectre sections", () => {
    const source: ProjectModelSource = {
      id: "mixed-section",
      revision: 1,
      language: "spectre",
      entry: "main.scs",
      dependencies: [],
      files: [
        {
          path: "main.scs",
          text: 'simulator lang=spice\n.lib "helper.lib" TT\nsimulator lang=spectre\n',
        },
        {
          path: "helper.lib",
          text: "simulator lang=spice\n.lib tt\n.subckt demo\n.ends demo\n.endl tt\nsimulator lang=spectre\n",
        },
      ],
    };
    expect(inspectProjectModelSource(source).diagnostics).toEqual([]);
    expect(renderProjectModelSource(source).text).toContain(
      ".subckt demo\n.ends demo",
    );
    source.files = [
      { path: "main.scs", text: 'include "helper.lib" section=TT\n' },
      {
        path: "helper.lib",
        text: "section tt\nsubckt lower ()\nends lower\nendsection tt\nsection TT\nsubckt upper ()\nends upper\nendsection TT\n",
      },
    ];
    expect(
      inspectProjectModelSource(source).entries.map((e) => e.name),
    ).toEqual(["upper"]);
    expect(renderProjectModelSource(source).text).toContain("subckt upper");
    expect(renderProjectModelSource(source).text).not.toContain("subckt lower");
  });
  it("locates failed helper conversion and refuses relabelling an external Spectre library", () => {
    const source: ProjectModelSource = {
      id: "native",
      revision: 1,
      language: "spectre",
      entry: "main.scs",
      dependencies: [],
      files: [
        {
          path: "main.scs",
          text: 'include "helper.scs"\nsubckt top ()\nX1 () helper\nends top\n',
        },
        {
          path: "helper.scs",
          text: "subckt helper ()\nB1 (a 0) bsource v=sin(time)\nends helper\n",
        },
      ],
    };
    expect(projectModelConversionDiagnostic(source, "spice")).toMatchObject({
      path: "helper.scs",
      sourceRef: { start: { line: 2 } },
    });
    source.dependencies = [
      { id: "vendor", mountPath: "vendor.scs", sha256: "a".repeat(64) },
    ];
    source.files[0]!.text =
      'include "vendor.scs" section=tt\nsubckt top ()\nends top\n';
    expect(projectModelConversionDiagnostic(source, "spice")).toMatchObject({
      code: "MODEL_SOURCE_LIBRARY_DIALECT",
      path: "main.scs",
      sourceRef: { start: { line: 1 } },
    });
    expect(
      renderProjectModelSource(source, { format: "spectre" }).text,
    ).toContain('include "vendor.scs" section=tt');
    expect(() => renderProjectModelSource(source, { format: "spice" })).toThrow(
      /library/,
    );
  });
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
