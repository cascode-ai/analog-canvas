import { instanceDisplayParameters } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { arrangeInstanceLabels } from "./arrange-instance-labels";
import { instanceDisplayEdits } from "./instance-display-edits";
import { instanceParameterVisibilityEdits } from "./instance-parameter-display";

/**
 * A textbook figure's labels (#1350), as the edits of one transaction: each
 * MOS transistor's W/L hidden, as set-instance-display `showValue:false`
 * hides it, then the parts' labels arranged as arrange-labels arranges them,
 * names in their role look (R_L, I_SS, M_1). Resistor, capacitor, inductor
 * and source values stay as they are, and nothing else hidden is shown: a
 * transistor whose multiplier is not 1 shows it as ×m, which is what a
 * bandgap's or a mirror's figure is about once the W/L that carried it is
 * hidden (#1423).
 *
 * The labels are arranged on a private copy with the W/L already hidden, so
 * the rows they leave free count. Labels the arrangement leaves alone, moved
 * by hand or by an earlier pass, locked or restyled, keep their place and
 * look.
 */
export function textbookLabelEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
): SchematicEdit[] {
  // The six MOS symbols, three- and four-terminal and DMOS alike, are the
  // devices whose value is a W/L.
  const transistors = instanceIds.filter((id) => {
    const instance = document.instances.find((item) => item.id === id);
    return (
      instance !== undefined &&
      deviceDescriptor(instance.symbolId)?.deviceClass === "mos"
    );
  });
  // Only a W/L that shows: hiding a hidden one again changes nothing.
  const hidden = instanceDisplayEdits(document, resolver, transistors, {
    showValue: false,
  }).filter(
    (edit) =>
      edit.kind !== "upsert_schematic_annotation" ||
      document.annotations.find((item) => item.id === edit.annotation.id)
        ?.visible !== false,
  );
  let draft = document;
  const apply = (edits: readonly SchematicEdit[]) => {
    if (!edits.length) return;
    const result = executeTransaction(
      draft,
      {
        transactionId: "textbook-label-preset",
        documentId: draft.id,
        expectedRevision: draft.revision,
        actor: { kind: "agent", id: "label-preset" },
        edits: [...edits],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok)
      throw new Error(result.diagnostics[0]?.message ?? result.error.message);
    draft = result.document;
  };
  apply(hidden);
  const multiplied = instanceIds.flatMap((id) => {
    const instance = draft.instances.find((item) => item.id === id);
    const multiplier = instance
      ? instanceDisplayParameters(instance.symbolId).find(
          (parameter) => parameter.displayRole === "multiplier",
        )
      : undefined;
    const value = Object.entries(instance?.netlist?.parameters ?? {})
      .find(
        ([key]) => key.toLowerCase() === multiplier?.name.toLowerCase(),
      )?.[1]
      ?.trim();
    return instance && multiplier && value && Number(value) !== 1
      ? instanceParameterVisibilityEdits(draft, instance, resolver, {
          [multiplier.name]: true,
        })
      : [];
  });
  apply(multiplied);
  return [
    ...hidden,
    ...multiplied,
    ...arrangeInstanceLabels(draft, resolver, instanceIds, {
      referenceStyle: "first-letter-subscript",
    }),
  ];
}
