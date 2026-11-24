import { diagnosticPresentationGroup, type Diagnostic } from "@icm/derived";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Row heights depend on message wrapping and dock width. Unknown rows use
// the first measured finding until they enter the scroll area.
function rowAt(offsets: readonly number[], top: number) {
  let first = 0;
  let end = offsets.length - 1;
  while (first < end) {
    const middle = Math.floor((first + end) / 2);
    if (offsets[middle + 1]! <= top) first = middle + 1;
    else end = middle;
  }
  return first;
}

export function DiagnosticList({
  findings,
  current,
  documentLabel,
  onSelectDiagnostic,
}: {
  findings: readonly Diagnostic[];
  current: boolean;
  documentLabel(documentId: string): string;
  onSelectDiagnostic(diagnostic: Diagnostic): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const heights = useMemo(() => new Map<number, number>(), [findings]);
  const [measurement, setMeasurement] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [focused, setFocused] = useState<number | null>(null);
  const previousWidth = useRef(0);
  const count = findings.length;
  const [complete, setComplete] = useState(false);
  const large = count > 24 && typeof ResizeObserver !== "undefined";
  const windowed = large && !complete;
  const offsets = useMemo(() => {
    const result = [0];
    const estimate = heights.get(0) ?? 48;
    for (let i = 0; i < count; i++)
      result.push(result[i]! + (heights.get(i) ?? estimate));
    return result;
  }, [count, heights, measurement]);
  const first = windowed ? Math.max(0, rowAt(offsets, viewport.top) - 3) : 0;
  const end = windowed
    ? Math.min(count, rowAt(offsets, viewport.top + viewport.height) + 4)
    : count;
  const indices = useMemo(() => {
    const visible = new Set<number>();
    for (let i = first; i < end; i++) visible.add(i);
    // Keep native Tab entry from either end. A focused button and its next
    // Tab stops stay in the DOM even when the user scrolls elsewhere.
    if (count) {
      visible.add(0);
      visible.add(count - 1);
      if (focused !== null) {
        for (
          let i = Math.max(0, focused - 1);
          i <= Math.min(count - 1, focused + 1);
          i++
        )
          visible.add(i);
      }
    }
    return [...visible].sort((a, b) => a - b);
  }, [first, end, focused, count]);

  useLayoutEffect(() => {
    const root = list.current;
    if (!root || !windowed) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>("li[aria-posinset]"),
    );
    function measure(reset = false) {
      if (!root || !root.clientHeight) return;
      const width = root.clientWidth;
      let changed = reset || width !== previousWidth.current;
      if (changed) heights.clear();
      previousWidth.current = width;
      for (const row of rows) {
        const i = Number(row.getAttribute("aria-posinset")) - 1;
        const height = row.getBoundingClientRect().height;
        if (height > 0 && height !== (heights.get(i) ?? heights.get(0) ?? 48)) {
          heights.set(i, height);
          changed = true;
        }
      }
      if (changed) setMeasurement((version) => version + 1);
      const top = root.scrollTop,
        height = root.clientHeight;
      setViewport((v) =>
        v.top === top && v.height === height ? v : { top, height },
      );
    }
    measure();
    const resize = new ResizeObserver(() => measure());
    resize.observe(root);
    for (const row of rows) resize.observe(row);
    const fontsChanged = () => measure(true);
    document.fonts?.addEventListener("loadingdone", fontsChanged);
    return () => {
      resize.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontsChanged);
    };
  }, [windowed, heights, indices]);

  const children: ReactNode[] = [];
  let previous = 0;
  for (const i of indices) {
    if (previous < i)
      children.push(
        <li
          key={`gap-${i}`}
          role="presentation"
          aria-hidden="true"
          style={{
            height: offsets[i]! - offsets[previous]!,
            listStyle: "none",
          }}
        />,
      );
    const diagnostic = findings[i]!;
    children.push(
      <li
        key={diagnostic.id}
        aria-posinset={i + 1}
        aria-setsize={count}
        data-domain={diagnostic.domain}
        data-document-id={diagnostic.primary.documentId}
        data-severity={diagnostic.severity}
        data-confidence={diagnostic.confidence}
        data-presentation={diagnosticPresentationGroup(diagnostic)}
      >
        <button
          type="button"
          data-testid={`project-diagnostic-${diagnostic.id}`}
          disabled={!current}
          onFocus={() => setFocused(i)}
          onClick={() => onSelectDiagnostic(diagnostic)}
        >
          <strong>
            {diagnostic.domain.toUpperCase()} / {diagnostic.code}
          </strong>
          : {diagnostic.message}
          <small>Cell: {documentLabel(diagnostic.primary.documentId)}</small>
        </button>
      </li>,
    );
    previous = i + 1;
  }
  return (
    <>
      {large && (
        <button
          type="button"
          className="diagnostics-complete-list"
          aria-pressed={complete}
          tabIndex={complete ? 0 : -1}
          onClick={() => setComplete((value) => !value)}
        >
          Show complete Issues list
        </button>
      )}
      <ul
        data-testid="project-diagnostics"
        ref={list}
        onScroll={
          windowed
            ? (event) =>
                setViewport({
                  top: event.currentTarget.scrollTop,
                  height: event.currentTarget.clientHeight,
                })
            : undefined
        }
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(null);
        }}
      >
        {children}
      </ul>
    </>
  );
}
