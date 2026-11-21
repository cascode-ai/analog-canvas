import { useMemo, useState } from "react";
import type { SchematicEdit } from "@icm/edit-engine";
import {
  instanceGroupDisplay,
  resolveCommittedDocumentLogicalNets,
} from "@icm/derived";
import type { Instance, InstanceGroup, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { PropertyDisclosure } from "../properties/property-disclosure";
import {
  commonArrayPins,
  instanceGroupNetNames,
  planCreateInstanceArray,
  planInstanceArrayConnection,
} from "./instance-group-edits";

export interface InstanceGroupPropertiesProps {
  document: SchematicDocument;
  group: InstanceGroup;
  resolver: SymbolResolver;
  selectedId: string;
  onLocate(id: string, label: string): void;
  onToggle(): void;
  onEdit(edits: SchematicEdit[]): boolean;
}

export function InstanceGroupProperties({
  document,
  group,
  resolver,
  selectedId,
  onLocate,
  onToggle,
  onEdit,
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
    <PropertyDisclosure
      className="instance-group-properties"
      role="region"
      title="Instance group"
      summary={`${members.length} members · ${members.find(({ id }) => id === selectedId)?.label ?? selectedId} selected`}
    >
      <button type="button" onClick={onToggle}>
        {group.collapsed ? "Expand and place members" : "Collapse group"}
      </button>
      <InstanceArrayConnection
        document={document}
        resolver={resolver}
        group={group}
        onEdit={onEdit}
      />
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
    </PropertyDisclosure>
  );
}

export function InstanceArrayCreation({
  document,
  seed,
  onEdit,
}: {
  document: SchematicDocument;
  seed: Instance;
  onEdit(edits: SchematicEdit[]): boolean;
}) {
  const match = /^(.*?)(\d+)$/u.exec(seed.reference ?? "");
  const [prefix, setPrefix] = useState(match?.[1] ?? seed.reference ?? "X");
  const [first, setFirst] = useState(match?.[2] ?? "0");
  const [last, setLast] = useState(match?.[2] === "0" || !match ? "3" : "0");
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    try {
      if (!first.trim() || !last.trim()) throw new Error("Enter both indices");
      const edits = planCreateInstanceArray(
        document,
        seed.id,
        {
          prefix,
          first: Number(first),
          last: Number(last),
        },
        `instance-group-${crypto.randomUUID()}`,
      );
      if (onEdit(edits)) setError(null);
      else
        setError(
          "The array was not created. See the editor status for details.",
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <PropertyDisclosure title="Create instance array">
      <label>
        Reference prefix{" "}
        <input
          aria-label="Reference prefix"
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </label>
      <label>
        First index{" "}
        <input
          aria-label="First index"
          type="number"
          min="0"
          value={first}
          onChange={(event) => setFirst(event.target.value)}
        />
      </label>
      <label>
        Last index{" "}
        <input
          aria-label="Last index"
          type="number"
          min="0"
          value={last}
          onChange={(event) => setLast(event.target.value)}
        />
      </label>
      <p>
        {seed.reference ?? seed.id} will be the first member, {prefix.trim()}
        {first}.
      </p>
      <button type="button" onClick={create}>
        Create array
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </PropertyDisclosure>
  );
}

function InstanceArrayConnection({
  document,
  resolver,
  group,
  onEdit,
}: Pick<
  InstanceGroupPropertiesProps,
  "document" | "resolver" | "group" | "onEdit"
>) {
  const pins = useMemo(
    () => commonArrayPins(document, resolver, group),
    [document, resolver, group],
  );
  const [chosenPin, setChosenPin] = useState("");
  const [expression, setExpression] = useState("");
  const [reverse, setReverse] = useState(false);
  const pin = pins.includes(chosenPin) ? chosenPin : pins[0];
  const mapping = useMemo(() => {
    if (!pin || !expression.trim()) return null;
    try {
      return {
        ok: true,
        ...planInstanceArrayConnection(
          document,
          resolver,
          group,
          pin,
          expression,
          reverse,
        ),
      } as const;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  }, [document, resolver, group, pin, expression, reverse]);
  if (!pin) return null;
  return (
    <PropertyDisclosure title="Connect array terminals">
      <label>
        Terminal{" "}
        <select
          aria-label="Array terminal"
          value={pin}
          onChange={(event) => setChosenPin(event.target.value)}
        >
          {pins.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Net or signal expression{" "}
        <input
          aria-label="Net or signal expression"
          placeholder="VSS or EN<3:0>"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={reverse}
          onChange={(event) => setReverse(event.target.checked)}
        />{" "}
        Reverse bit order
      </label>
      {mapping?.ok ? (
        <>
          <div
            className="instance-array-preview"
            role="region"
            aria-label="Terminal pairings"
            tabIndex={0}
          >
            <table aria-label="Array connection preview">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {mapping.rows.map(({ reference, net }) => (
                  <tr key={reference}>
                    <td>{reference}</td>
                    <td>{net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapping.removedRouteCount > 0 ? (
            <p>
              {mapping.removedRouteCount} wire{" "}
              {mapping.removedRouteCount === 1 ? "path will" : "paths will"} be
              removed from the reassigned terminals.
            </p>
          ) : null}
        </>
      ) : mapping ? (
        <p role="alert">{mapping.message}</p>
      ) : null}
      <button
        type="button"
        onClick={() => mapping?.ok && onEdit(mapping.edits)}
        disabled={!mapping?.ok || !mapping.edits.length}
      >
        Apply array connections
      </button>
    </PropertyDisclosure>
  );
}
