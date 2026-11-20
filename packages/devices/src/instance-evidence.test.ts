import { describe, expect, it } from "vitest";
import type { CircuitProject } from "@icm/model";

import { instanceEvidence } from "./instance-evidence.js";
import { instanceParameterContract } from "./instance-parameters.js";

type Provenance = NonNullable<
  CircuitProject["documents"][number]["instances"][number]["importProvenance"]
>;

function project(...texts: string[]): Pick<CircuitProject, "source"> {
  return {
    source: {
      entryPath: "top.sp",
      files: texts.map((text, index) => ({
        id: `file-${index}`,
        path: `file-${index}.sp`,
        hash: "sha256:0",
        content: { text, encoding: "utf-8" },
      })),
    },
  } as unknown as Pick<CircuitProject, "source">;
}

function mos(provenance: Partial<Provenance> | undefined, model = "nch_mac") {
  return {
    symbolId: "nmos",
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: model },
      parameters: { w: "1u", ad: "1p" },
    },
    ...(provenance
      ? {
          importProvenance: {
            kind: "model",
            sourceMasterName: "nch_mac",
            sourceTarget: "model:nch_mac",
            ...provenance,
          } as Provenance,
        }
      : {}),
  };
}

describe("instance evidence", () => {
  it("tells a Canvas part from what an import brought", () => {
    expect(instanceEvidence(project(), mos(undefined))).toBe("canvas");
    expect(
      instanceEvidence(
        project(),
        mos({ status: "missing", modelType: "nmos" }),
      ),
    ).toBe("typed-only");
    expect(instanceEvidence(project(), mos({ status: "missing" }))).toBe(
      "untyped",
    );
    expect(
      instanceEvidence(project(), {
        importProvenance: {
          kind: "opaque",
          sourceMasterName: "cfmom_2t",
          status: "missing",
        },
      }),
    ).toBe("external-call");
  });

  it("treats a model target changed in Canvas as Canvas's", () => {
    expect(
      instanceEvidence(
        project(),
        mos({ status: "missing", modelType: "nmos" }, "NMOS"),
      ),
    ).toBe("canvas");
  });

  it("decides a Project imported before the status by the sources it keeps", () => {
    const old = mos({ status: "resolved", modelType: "nmos" });
    expect(instanceEvidence(project(".model nch_mac nmos level=54"), old)).toBe(
      "resolved",
    );
    // A binned card defines its group's name.
    expect(instanceEvidence(project(".model nch_mac.1 nmos"), old)).toBe(
      "resolved",
    );
    expect(instanceEvidence(project("M1 d g s b nch_mac"), old)).toBe(
      "typed-only",
    );
    // A Project that keeps no sources (a Gallery copy) keeps its status.
    expect(instanceEvidence(project(), old)).toBe("resolved");
  });

  it("opens the parameter contract of a model its sources do not define, and only that", () => {
    const outside = instanceParameterContract(
      project(),
      mos({ status: "missing", modelType: "nmos" }),
    );
    expect(outside).toMatchObject({ open: true, unverified: true });
    expect(instanceParameterContract(project(), mos(undefined))).toMatchObject({
      open: false,
    });
    expect(
      instanceParameterContract(project(), mos(undefined))?.unverified,
    ).toBeUndefined();
  });
});
