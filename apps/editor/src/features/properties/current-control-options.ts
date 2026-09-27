import type { Instance } from "@icm/model";
import { terminalCurrentDirectionPartners } from "../simulation/terminal-current-pick";

export interface CurrentControlOption {
  value: string;
  label: string;
  instanceId: string;
  pinName: string;
  partners: string[];
}

export const currentTerminalKey = (instanceId: string, pinName: string) =>
  JSON.stringify([instanceId, pinName]);

/** Same legal pairs as canvas Pick; IDs identify options, References label them. */
export function currentControlOptions(
  instances: readonly Instance[],
  pins: (instance: Instance) => readonly string[],
): CurrentControlOption[] {
  return instances.flatMap((instance) => {
    const names = [...new Set(pins(instance))];
    return names.flatMap((pinName) => {
      const partners = terminalCurrentDirectionPartners(
        instance,
        pinName,
        names,
      );
      return partners.length
        ? [
            {
              value: currentTerminalKey(instance.id, pinName),
              label: `${instance.reference ?? instance.id}.${pinName}`,
              instanceId: instance.id,
              pinName,
              partners: partners.map((pin) =>
                currentTerminalKey(instance.id, pin),
              ),
            },
          ]
        : [];
    });
  });
}

export function currentControlPair(
  options: readonly CurrentControlOption[],
  control:
    | { instanceId: string; pinName: string; direction: "into" | "out" }
    | undefined,
) {
  const terminal = options.find(
    (item) =>
      item.value ===
      currentTerminalKey(control?.instanceId ?? "", control?.pinName ?? ""),
  );
  const partner = terminal?.partners[0] ?? "";
  return control?.direction === "out"
    ? { positive: partner, negative: terminal?.value ?? "" }
    : { positive: terminal?.value ?? "", negative: partner };
}
