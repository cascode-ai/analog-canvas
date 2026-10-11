import {
  Children,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Adjustable preview/code workspace; narrow layouts stack the same two panes. */
export function DefinitionWorkspace({
  children,
  initialSplit = 40,
}: {
  children: ReactNode;
  initialSplit?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(initialSplit);
  const panes = Children.toArray(children);
  const change = (value: number) => setSplit(Math.min(75, Math.max(25, value)));
  return (
    <div
      ref={container}
      className="component-definition-workspace"
      style={{ "--definition-split": `${split}%` } as CSSProperties}
    >
      {panes[0]}
      <div
        className="component-definition-divider"
        role="separator"
        aria-label="Resize definition panels"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={split}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const box = container.current!.getBoundingClientRect();
          change(((event.clientX - box.left) / box.width) * 100);
        }}
        onPointerUp={(event) =>
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        onDoubleClick={() => change(initialSplit)}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
            event.preventDefault();
            change(
              event.key === "Home"
                ? initialSplit
                : split + (event.key === "ArrowLeft" ? -5 : 5),
            );
          }
        }}
      />
      {panes[1]}
    </div>
  );
}
