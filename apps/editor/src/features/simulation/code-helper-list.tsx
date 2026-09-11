import { useEffect, useRef, useState } from "react";
import {
  simulationLanguageHelp,
  type SimulationLanguageHelp,
} from "@icm/spice";

export interface CodeHelperAction {
  id: string;
  label: string;
  keywords: string;
  run(): void;
}
export function CodeHelperList({
  control,
  language = "spice",
  actions = [],
  onChoose,
  onClose,
}: {
  control: boolean;
  language?: "spice" | "json";
  actions?: readonly CodeHelperAction[] | undefined;
  onChoose(rule: SimulationLanguageHelp): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [selected, select] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const terms = query.trim().toLowerCase().split(/\s+/u);
  const matches = (text: string) =>
    terms.every((term) => text.toLowerCase().includes(term));
  const rules = simulationLanguageHelp
    .filter(() => language === "spice")
    .filter((rule) => rule.context === (control ? "control" : "deck"))
    .filter((rule) => matches(`${rule.name} ${rule.summary} ${rule.keywords}`))
    .toSorted((a, b) => (a.priority ?? 90) - (b.priority ?? 90));
  const entries = [
    ...actions
      .filter((action) => matches(`${action.label} ${action.keywords}`))
      .map((action) => ({
        key: action.id,
        label: action.label,
        detail: "",
        group: "Observe",
        run: action.run,
      })),
    ...rules.map((rule) => ({
      key: `${rule.context}:${rule.name}`,
      label: rule.name,
      detail: rule.signature,
      group: rule.group!,
      run: () => onChoose(rule),
    })),
  ];
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onClose]);
  const choose = (index: number) => {
    if (!entries[index]) return;
    entries[index].run();
    onClose();
  };
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);
  return (
    <div
      ref={root}
      className="simulation-helper-list"
      role="dialog"
      aria-label="Insert / Helper"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          select((value) => Math.min(value + 1, entries.length - 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          select((value) => Math.max(0, value - 1));
        }
        if (event.key === "Enter") {
          event.preventDefault();
          choose(selected);
        }
      }}
    >
      <input
        autoFocus
        aria-label="Search commands or purpose"
        placeholder="Search commands or purpose… / 搜索用途"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          select(0);
        }}
      />
      <div
        className="simulation-helper-options"
        role="listbox"
        aria-label="Helpers"
      >
        {entries.map((item, i) => (
          <div key={item.key}>
            {entries[i - 1]?.group !== item.group && (
              <div className="simulation-helper-group">{item.group}</div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={selected === i}
              onMouseEnter={() => select(i)}
              onClick={() => choose(i)}
            >
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          </div>
        ))}
        {!entries.length && (
          <p>No matching helper. You can keep writing native SPICE.</p>
        )}
      </div>
    </div>
  );
}
