import { useEffect, useRef } from "react";

import {
  ALL_SELECTION_FILTER,
  DEFAULT_SELECTION_FILTER,
  NO_SELECTION_FILTER,
  type SelectionClass,
  type SelectionFilter,
} from "./selection-filter";

const GROUPS: readonly {
  title: string;
  items: readonly { kind: SelectionClass; label: string }[];
}[] = [
  {
    title: "Circuit",
    items: [
      { kind: "instance", label: "Instances" },
      { kind: "route", label: "Wires" },
      { kind: "junction", label: "Junctions" },
      { kind: "terminal", label: "Pins" },
    ],
  },
  {
    title: "Electrical text",
    items: [
      { kind: "instance-name", label: "Instance names" },
      { kind: "instance-value", label: "Instance values" },
      { kind: "net-name", label: "Net / power names" },
      { kind: "pin-name", label: "Pin names" },
      { kind: "route-marker", label: "Route markers" },
    ],
  },
  {
    title: "Markup",
    items: [
      { kind: "drafting-text", label: "Note text / callouts" },
      { kind: "drafting-line", label: "Lines / arrows" },
      { kind: "drafting-shape", label: "Shapes" },
    ],
  },
] as const;

export function SelectionFilterPopover({
  open,
  filter,
  onChange,
  onClose,
}: {
  open: boolean;
  filter: SelectionFilter;
  onChange: (filter: SelectionFilter) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <aside
      ref={rootRef}
      className="selection-filter-popover"
      data-testid="selection-filter-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="selection-filter-title"
    >
      <header>
        <div>
          <p className="selection-filter-kicker">Selection</p>
          <h2 id="selection-filter-title">Selection Filter</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close selection filter"
        >
          Close
        </button>
      </header>
      <div className="selection-filter-presets" aria-label="Filter presets">
        <button type="button" onClick={() => onChange(ALL_SELECTION_FILTER)}>
          All
        </button>
        <button type="button" onClick={() => onChange(NO_SELECTION_FILTER)}>
          None
        </button>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_SELECTION_FILTER)}
        >
          Default
        </button>
      </div>
      {GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend>{group.title}</legend>
          {group.items.map((item) => (
            <label key={item.kind}>
              <input
                type="checkbox"
                checked={filter[item.kind]}
                onChange={(event) =>
                  onChange({
                    ...filter,
                    [item.kind]: event.currentTarget.checked,
                  })
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <small>
        Affects new selections only. Drawing, simulation, visibility, and
        connectivity stay unchanged.
      </small>
    </aside>
  );
}
