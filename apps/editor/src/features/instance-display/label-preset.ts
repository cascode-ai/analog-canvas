import { deviceDescriptor } from "@icm/devices";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { arrangeInstanceLabels } from "./arrange-instance-labels";
import { instanceDisplayEdits } from "./instance-display-edits";

/**
 * A textbook figure's labels (#1350), as the edits of one transaction: each
 * MOS transistor's W/L hidden, as set-instance-display `showValue:false`
 * hides it, then the parts' labels arranged as arrange-labels arranges them,
 * names in their role look (R_L, I_SS, M_1). Resistor, capacitor, inductor
 * and source values stay as they are, and nothing hidden is shown.
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
  if (hidden.length) {
    const result = executeTransaction(
      document,
      {
        transactionId: "textbook-label-preset",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "label-preset" },
        edits: hidden,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok)
      throw new Error(result.diagnostics[0]?.message ?? result.error.message);
    draft = result.document;
  }
  return [
    ...hidden,
    ...arrangeInstanceLabels(draft, resolver, instanceIds, {
      referenceStyle: "first-letter-subscript",
    }),
  ];
}
