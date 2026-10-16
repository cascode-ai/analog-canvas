import { expect, it } from "vitest";
import { namespaceModelSource } from "./model-source-variant.js";
import type { ProjectModelSource } from "@icm/model";

it.each(["R", "C", "L"])(
  "refuses unresolved %s model syntax without leaking original models",
  (family) => {
    const source: ProjectModelSource = {
      id: "s",
      revision: 1,
      language: "spice",
      entry: "s.sp",
      dependencies: [],
      files: [
        {
          path: "s.sp",
          text: `.model passive ${family}\n.subckt stage A B\n${family}1 A B passive l=1u w=1u\n.ends stage\n`,
        },
      ],
    };
    expect(() => namespaceModelSource(source, "v")).toThrow(
      "passive model reference",
    );
  },
);

it("refuses a shared include that resolves the same token to different model scopes", () => {
  const source: ProjectModelSource = {
    id: "s",
    revision: 1,
    language: "spice",
    entry: "main.sp",
    dependencies: [],
    files: [
      {
        path: "main.sp",
        text: ".model diode D is=1e-12\n.subckt global A B\n.include body.sp\n.ends global\n.subckt local A B\n.model diode D is=1e-14\n.include body.sp\n.ends local\n",
      },
      { path: "body.sp", text: "D1 A B diode\n" },
    ],
  };
  expect(() => namespaceModelSource(source, "v")).toThrow(
    "different model scopes",
  );
});

it.each(["spice", "spectre"] as const)(
  "copies %s declarations and references without rewriting parameters or comments",
  (language) => {
    const source: ProjectModelSource = {
      id: "source",
      language,
      revision: 1,
      entry: "model",
      dependencies: [],
      files: [
        {
          path: "model",
          text:
            language === "spice"
              ? "* stage must stay in this comment\n.subckt stage IN OUT params: stage=2\nX1 IN OUT helper\n.ends stage\n.subckt helper A B\nR1 A B {stage}\n.ends helper\n"
              : "// stage must stay in this comment\nsubckt stage (IN OUT)\nparameters stage=2\nX1 (IN OUT) helper\nends stage\nsubckt helper (A B)\nR1 (A B) resistor r=stage\nends helper\n",
        },
      ],
    };
    const copy = namespaceModelSource(source, "v2");
    expect(copy.names.get("stage")).toBe("stage_v2");
    expect(copy.source.files[0]!.text).toContain(
      language === "spice" ? "X1 IN OUT helper_v2" : "X1 (IN OUT) helper_v2",
    );
    expect(copy.source.files[0]!.text).toContain(
      "stage must stay in this comment",
    );
    expect(copy.source.files[0]!.text).toContain("stage=2");
    expect(copy.source.files[0]!.text).toContain(
      language === "spice" ? "{stage}" : "r=stage",
    );
    expect(source.files[0]!.text).not.toContain("_v2");
  },
);

it("keeps local model shadowing across includes while isolating globals", () => {
  const source: ProjectModelSource = {
    id: "s",
    revision: 1,
    language: "spice",
    entry: "main.sp",
    dependencies: [],
    files: [
      {
        path: "main.sp",
        text: ".model diode D is=1e-12\n.subckt global A B\nD1 A B diode\n.ends global\n.subckt local A B\n.include local.sp\nD2 A B diode\n.ends local\n",
      },
      { path: "local.sp", text: ".model diode D is=1e-14\n" },
    ],
  };
  const copy = namespaceModelSource(source, "v").source;
  expect(copy.files[0]!.text).toContain(".model diode_v D");
  expect(copy.files[0]!.text).toContain("D1 A B diode_v");
  expect(copy.files[0]!.text).toContain("D2 A B diode\n");
  expect(copy.files[1]!.text).toBe(source.files[1]!.text);
});

it("refuses shared global parameters instead of making a falsely independent variant", () => {
  expect(() =>
    namespaceModelSource(
      {
        id: "s",
        revision: 1,
        language: "spice",
        entry: "s.sp",
        dependencies: [],
        files: [
          {
            path: "s.sp",
            text: ".param gain=2\n.subckt stage A B\nE1 B 0 A 0 {gain}\n.ends stage\n",
          },
        ],
      },
      "v",
    ),
  ).toThrow("global parameters");
});
