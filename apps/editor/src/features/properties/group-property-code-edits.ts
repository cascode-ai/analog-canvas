import type { SchematicEdit } from "@icm/edit-engine";
import type { Instance } from "@icm/model";
import { updateComponentParameterValues } from "../component-insert/component-parameters";
import type {
  GroupPerItem,
  GroupPropertyCodeContext,
  GroupPropertyCodeValue,
  GroupPropertyItem,
  GroupPropertyMixedValue,
} from "./group-property-code";

const isPerItem = <T>(
  setting: T | GroupPerItem<T>,
): setting is GroupPerItem<T> =>
  typeof setting === "object" && setting !== null;

/**
 * One component's own setting: a shared value applies to every component, a
 * dictionary gives each its entry. Undefined leaves the component as it is.
 */
function ownSetting<T>(
  setting: T | GroupPerItem<T>,
  item: GroupPropertyItem | undefined,
): T | undefined {
  if (!isPerItem(setting)) return setting;
  return item ? setting[item.key] : undefined;
}

/** Batch edits only patch explicitly changed fields; empty fields keep each original. */
export function planGroupPropertyCodeEdits(
  instances: readonly Instance[],
  value: GroupPropertyCodeValue,
  context: GroupPropertyCodeContext,
): SchematicEdit[] {
  const items = new Map(
    (context.items ?? []).map((item) => [item.instanceId, item]),
  );
  const edits: SchematicEdit[] = [];
  for (const instance of instances) {
    const item = items.get(instance.id);
    const color = ownSetting(value.appearance.color, item);
    if (
      color !== undefined &&
      color !== "" &&
      color !== (item ? item.foreground : context.foreground)
    ) {
      // Component code does not expose fill/background paint. A color edit also
      // retires that old component-only override, matching single selection.
      const { background: _retiredBackground, ...styleOverride } = {
        ...instance.styleOverride,
      };
      if (color === "auto") delete styleOverride.foreground;
      else styleOverride.foreground = color;
      if (
        instance.styleOverride?.foreground !== styleOverride.foreground ||
        _retiredBackground !== undefined
      )
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
      for (const [key, setting] of Object.entries(value.parameters)) {
        const raw = ownSetting(setting, item);
        const current = item
          ? (item.parameters[key] ?? "")
          : context.parameters[key];
        if (raw !== undefined && raw.trim() !== "" && raw !== current)
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

/**
 * Which components a batch shows a label (or value) for, and which it hides.
 * A shared switch turns every one; a dictionary turns each by its entry.
 */
export function groupVisibilityTargets(
  setting: GroupPropertyMixedValue | GroupPerItem<boolean> | undefined,
  common: GroupPropertyMixedValue | null,
  selectedIds: readonly string[],
  items: readonly GroupPropertyItem[] | undefined,
  current: (item: GroupPropertyItem) => boolean | null,
): { show: string[]; hide: string[] } {
  if (setting === undefined || setting === "") return { show: [], hide: [] };
  if (!isPerItem(setting)) {
    if (setting === common) return { show: [], hide: [] };
    return setting
      ? { show: [...selectedIds], hide: [] }
      : { show: [], hide: [...selectedIds] };
  }
  const show: string[] = [];
  const hide: string[] = [];
  for (const item of items ?? []) {
    const wanted = setting[item.key];
    const was = current(item);
    if (wanted === undefined || was === null || wanted === was) continue;
    (wanted ? show : hide).push(item.instanceId);
  }
  return { show, hide };
}
