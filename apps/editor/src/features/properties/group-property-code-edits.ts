import type { SchematicEdit } from "@icm/edit-engine";
import type { Instance } from "@icm/model";
import { updateComponentParameterValues } from "../component-insert/component-parameters";
import type {
  GroupPropertyCodeContext,
  GroupPropertyCodeValue,
} from "./group-property-code";

/** Batch edits only patch explicitly changed fields; empty fields keep each original. */
export function planGroupPropertyCodeEdits(
  instances: readonly Instance[],
  value: GroupPropertyCodeValue,
  context: GroupPropertyCodeContext,
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  for (const instance of instances) {
    const foreground = value.appearance.foreground;
    if (foreground !== "" && foreground !== context.foreground) {
      const styleOverride = { ...instance.styleOverride };
      if (foreground === "auto") delete styleOverride.foreground;
      else styleOverride.foreground = foreground;
      if (instance.styleOverride?.foreground !== styleOverride.foreground)
        edits.push({
          kind: "set_instance_style_override",
          instanceId: instance.id,
          styleOverride: Object.keys(styleOverride).length
            ? styleOverride
            : null,
        });
    }
    if (
      instance.netlist &&
      value.parameters !== "" &&
      context.parameters !== null
    ) {
      let parameters = { ...instance.netlist.parameters };
      for (const [key, raw] of Object.entries(value.parameters)) {
        if (raw.trim() !== "" && raw !== context.parameters[key])
          parameters = updateComponentParameterValues(
            instance.symbolId,
            parameters,
            key,
            raw,
          );
      }
      const set = Object.fromEntries(
        Object.entries(parameters).filter(
          ([key, raw]) => raw !== instance.netlist!.parameters[key],
        ),
      );
      if (Object.keys(set).length)
        edits.push({
          kind: "patch_instance_netlist_parameters",
          instanceId: instance.id,
          set,
        });
    }
  }
  return edits;
}
