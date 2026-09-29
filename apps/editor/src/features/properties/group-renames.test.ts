import { describe, expect, it } from "vitest";

import type { GroupPropertyCodeValue } from "./group-property-code";
import {
  groupBatchName,
  groupRenames,
  mergeRenamePlans,
} from "./group-renames";

const item = (key: string, name: string) => ({
  key,
  instanceId: `id-${key}`,
  name,
  parameters: {},
  reference: true,
  value: null,
  foreground: "auto" as const,
});
const context = { items: [item("P1", "Vcontp"), item("P2", "Vcontn")] };
const value = (names: Record<string, string>): GroupPropertyCodeValue => ({
  symbol: "port",
  names,
  parameters: "",
  display: { visualAnnotation: true },
  appearance: { color: "auto" },
});

describe("renaming components from a batch", () => {
  it("renames each entry that changed, and only those", () => {
    expect(groupRenames(value({ P1: "Voutp", P2: "Vcontn" }), context)).toEqual(
      {
        ok: true,
        renames: [{ instanceId: "id-P1", key: "P1", name: "Voutp" }],
      },
    );
    expect(
      groupRenames(value({ P1: "Voutp", P2: "Voutn" }), context),
    ).toMatchObject({ ok: true, renames: [{ key: "P1" }, { key: "P2" }] });
  });

  it("leaves one name for them all to the batch name", () => {
    const one = { ...value({}), names: "Vcont" };
    expect(groupRenames(one, context)).toEqual({ ok: true, renames: [] });
    expect(groupBatchName(one)).toBe("Vcont");
    for (const kept of ["as is", "As Is", " ", ""])
      expect(groupBatchName({ ...one, names: kept })).toBeNull();
    expect(groupBatchName(value({ P1: "Voutp" }))).toBeNull();
  });

  it("refuses a swap or two entries with one name", () => {
    expect(
      groupRenames(value({ P1: "Vcontn", P2: "Vcontp" }), context),
    ).toMatchObject({ ok: false });
    expect(
      groupRenames(value({ P1: "Vout", P2: "Vout" }), context),
    ).toMatchObject({
      ok: false,
      message: "Two components cannot both be named Vout",
    });
  });

  it("gathers several Pin renames per document under one revision", () => {
    const edit = (documentId: string, name: string, revision: number) => ({
      kind: "transact_document" as const,
      documentId,
      expectedRevision: revision,
      edits: [
        {
          kind: "update_cell_terminal" as const,
          terminalId: `t-${name}`,
          name,
        },
      ],
    });
    const merged = mergeRenamePlans([
      [edit("cell", "Voutp", 3), edit("top", "Voutp", 7)],
      [edit("cell", "Voutn", 3)],
    ] as never);
    expect(merged).toEqual([
      {
        ...edit("cell", "Voutp", 3),
        edits: [
          ...edit("cell", "Voutp", 3).edits,
          ...edit("cell", "Voutn", 3).edits,
        ],
      },
      edit("top", "Voutp", 7),
    ]);
    expect(
      mergeRenamePlans([[{ kind: "rename_project", name: "x" }]] as never),
    ).toBeNull();
  });
});
