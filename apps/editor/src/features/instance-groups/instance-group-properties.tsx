import { useMemo } from "react";
import {
  instanceGroupDisplay,
  resolveCommittedDocumentLogicalNets,
} from "@icm/derived";
import type { InstanceGroup, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { instanceGroupNetNames } from "./instance-group-edits";

export interface InstanceGroupPropertiesProps {
  document: SchematicDocument;
  group: InstanceGroup;
  resolver: SymbolResolver;
  selectedId: string;
  onLocate(id: string, label: string): void;
  onToggle(): void;
}

export function InstanceGroupProperties({
  document,
  group,
  resolver,
  selectedId,
  onLocate,
  onToggle,
}: InstanceGroupPropertiesProps) {
  const members = useMemo(() => {
    const instances = new Map(
      document.instances.map((part) => [part.id, part]),
    );
    const logical = resolveCommittedDocumentLogicalNets(document);
    const netNames = instanceGroupNetNames(document, logical);
    const hidden = instanceGroupDisplay(document)?.hidden;
    const memberIds = new Set(group.memberIds);
    const connections = new Map<string, string[]>();
    for (const net of document.nets) {
      const name =
        netNames.get(logical.byBaseNetId.get(net.id)?.id ?? net.id) ?? net.id;
      for (const terminal of net.terminals) {
        if (!memberIds.has(terminal.instanceId)) continue;
        const rows = connections.get(terminal.instanceId) ?? [];
        const instance = instances.get(terminal.instanceId);
        const pin =
          terminal.memberId &&
          instance &&
          resolver
            .resolve(instance.symbolId, instance.symbolVariantId)
            ?.definition.pins.find((pin) => pin.name === terminal.pinName);
        const member =
          pin && pin.signalMembers?.find(({ id }) => id === terminal.memberId);
        rows.push(`${member ? member.name : terminal.pinName} → ${name}`);
        connections.set(terminal.instanceId, rows);
      }
    }
    return group.memberIds.flatMap((id) => {
      const part = instances.get(id);
      return part
        ? [
            {
              id,
              label: part.reference ?? id,
              placement: !part.placement
                ? "Unplaced"
                : hidden?.has(id)
                  ? "Collapsed"
                  : "Placed",
              parameters: Object.entries(part.netlist?.parameters ?? {}).map(
                ([key, value]) => `${key}=${value}`,
              ),
              connections: connections.get(id) ?? [],
            },
          ]
        : [];
    });
  }, [document, group, resolver]);

  return (
    <section className="property-section" aria-label="Instance group">
      <h2>Instance group ({members.length})</h2>
      <button type="button" onClick={onToggle}>
        {group.collapsed ? "Expand and place members" : "Collapse group"}
      </button>
      <ol>
        {members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              aria-label={`Locate ${member.label}`}
              aria-pressed={selectedId === member.id}
              onClick={() => onLocate(member.id, member.label)}
            >
              {member.label}
            </button>{" "}
            <small>{member.placement}</small>
            <div>
              {member.connections.join(" · ") || "No connected terminals"}
            </div>
            {member.parameters.length > 0 && (
              <div>{member.parameters.join(" · ")}</div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
