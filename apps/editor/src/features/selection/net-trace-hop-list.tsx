import type {
  GlobalNetTraceHop,
  HierarchyNetTraceHop,
  HierarchyNetTraceView,
} from "@icm/derived";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

const rowsPerBlock = 64;
type TraceHop = HierarchyNetTraceHop | GlobalNetTraceHop;

/** The scroll bar covers the entire ordered trace. Blocks retain the height of
 * their wrapped rows when they leave the visible area. */
export function NetTraceHopList({
  hops,
  renderLabel,
  onNavigateHop,
}: {
  hops: HierarchyNetTraceView["hops"];
  renderLabel(hop: TraceHop): ReactNode;
  onNavigateHop(hop: TraceHop): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const metricsProbe = useRef<HTMLSpanElement>(null);
  const [sizes, setSizes] = useState(() => ({
    heights: new Map<number, number>(),
    rowHeight: 0,
  }));
  const [visible, setVisible] = useState(() => new Set([0]));
  const [focusedBlock, setFocusedBlock] = useState<number | null>(null);
  const blocks = Math.ceil(hops.length / rowsPerBlock);

  useLayoutEffect(() => {
    const root = list.current;
    if (!root || blocks <= 1) return;
    const elements = Array.from(root.children) as HTMLElement[];
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof ResizeObserver === "undefined"
    ) {
      setVisible(new Set(elements.map((_, i) => i)));
      return;
    }
    const visibility = new IntersectionObserver(
      (entries) => {
        setVisible((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const block = Number(
              (entry.target as HTMLElement).dataset.traceBlock,
            );
            if (entry.isIntersecting) next.add(block);
            else next.delete(block);
          }
          return next;
        });
      },
      { root, rootMargin: "100% 0px" },
    );
    const probe = metricsProbe.current!;
    const measured = new Map<number, number>();
    let layoutKey = "";
    function measure(
      entries: readonly ResizeObserverEntry[],
      fontLoaded = false,
    ) {
      const box = probe.getBoundingClientRect();
      const sampleHeight = elements[0]!.getBoundingClientRect().height;
      const key = [
        root!.clientWidth,
        box.width,
        box.height,
        sampleHeight,
        getComputedStyle(probe).font,
      ].join("/");
      const reset = fontLoaded || key !== layoutKey;
      layoutKey = key;
      if (reset) measured.clear();
      let changed = reset;
      for (const element of reset
        ? elements
        : entries.map((entry) => entry.target as HTMLElement)) {
        if (
          element.dataset.traceBlock === undefined ||
          !element.childElementCount
        )
          continue;
        const block = Number(element.dataset.traceBlock);
        const height = element.getBoundingClientRect().height;
        if (height && measured.get(block) !== height) {
          measured.set(block, height);
          changed = true;
        }
      }
      if (changed)
        setSizes({
          heights: new Map(measured),
          rowHeight: sampleHeight / rowsPerBlock,
        });
    }
    const resize = new ResizeObserver((entries) => measure(entries));
    const fontsChanged = () => measure([], true);
    document.fonts?.addEventListener("loadingdone", fontsChanged);
    resize.observe(root);
    resize.observe(probe);
    for (const element of elements) {
      visibility.observe(element);
      resize.observe(element);
    }
    return () => {
      visibility.disconnect();
      resize.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontsChanged);
    };
  }, [blocks, hops]);

  function rowOf(target: EventTarget | null) {
    return target instanceof HTMLButtonElement &&
      target.dataset.traceRow !== undefined
      ? Number(target.dataset.traceRow)
      : undefined;
  }
  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    const current = rowOf(event.target);
    if (current === undefined || event.metaKey || event.ctrlKey || event.altKey)
      return;
    let next: number;
    switch (event.key) {
      case "Home":
        next = 0;
        break;
      case "End":
        next = hops.length - 1;
        break;
      case "ArrowDown":
        next = Math.min(current + 1, hops.length - 1);
        break;
      case "ArrowUp":
        next = Math.max(current - 1, 0);
        break;
      case "Tab":
        next = current + (event.shiftKey ? -1 : 1);
        break;
      default:
        return;
    }
    if (next < 0 || next >= hops.length) return;
    event.preventDefault();
    const button = () =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-trace-row="${next}"]`,
      );
    if (!button())
      flushSync(() => setFocusedBlock(Math.floor(next / rowsPerBlock)));
    button()?.focus();
  }
  function rows(start: number, count: number) {
    return Array.from({ length: count }, (_, offset) => {
      const index = start + offset;
      const hop = hops.at(index)!;
      return (
        <li key={index} aria-posinset={index + 1} aria-setsize={hops.length}>
          <button
            type="button"
            data-trace-row={index}
            data-testid={`net-trace-hop-${index}`}
            onClick={() => onNavigateHop(hop)}
          >
            {renderLabel(hop)}
            {index === 0 && blocks > 1 && (
              <span
                aria-hidden="true"
                className="net-trace-metrics"
                ref={metricsProbe}
              >
                MWgi09
              </span>
            )}
          </button>
        </li>
      );
    });
  }
  return (
    <ul
      data-testid="net-trace-hops"
      ref={list}
      onKeyDown={navigate}
      onFocus={(event) => {
        const row = rowOf(event.target);
        if (row !== undefined) setFocusedBlock(Math.floor(row / rowsPerBlock));
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocusedBlock(null);
      }}
    >
      {blocks <= 1
        ? rows(0, hops.length)
        : Array.from({ length: blocks }, (_, block) => {
            const start = block * rowsPerBlock;
            const count = Math.min(rowsPerBlock, hops.length - start);
            // The browser's own Tab order enters at the first or last button
            // even when the reader has scrolled to the opposite end.
            const show =
              block === 0 ||
              block === blocks - 1 ||
              visible.has(block) ||
              block === focusedBlock;
            return (
              <li
                role="presentation"
                className="net-trace-block"
                data-trace-block={block}
                key={block}
                style={
                  show
                    ? undefined
                    : {
                        height:
                          sizes.heights.get(block) ??
                          (sizes.rowHeight
                            ? count * sizes.rowHeight
                            : `${count * 1.7}em`),
                      }
                }
              >
                {show && (
                  <ul role="presentation" className="net-trace-block-rows">
                    {rows(start, count)}
                  </ul>
                )}
              </li>
            );
          })}
    </ul>
  );
}
