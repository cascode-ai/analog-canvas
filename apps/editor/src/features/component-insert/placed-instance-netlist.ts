import type { InstanceNetlistData } from "@icm/model";

import { initialInstanceNetlist } from "../netlist-export/netlist-authoring";
import { initialComponentParameterValues } from "./component-parameters";

/**
 * The netlist record a newly placed part carries, whoever places it: each
 * parameter it is given, the catalog default for each one it is not, and
 * the model the Process in hand names for it. The library, the shapes panel
 * and the Agent all place through this, so a part lands alike from each.
 */
export function placedInstanceNetlist(
  symbolId: string,
  parameters: Readonly<Record<string, string>>,
  modelTarget?: string,
): InstanceNetlistData | undefined {
  return initialInstanceNetlist(
    symbolId,
    { ...initialComponentParameterValues(symbolId), ...parameters },
    modelTarget,
  );
}
