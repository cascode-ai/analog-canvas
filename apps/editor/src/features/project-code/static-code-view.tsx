import type { CSSProperties } from "react";

/** A code viewport's height for its line count: 19.2 px lines and padding. */
export function codeViewportHeight(lineCount: number): CSSProperties {
  return {
    "--netlist-editor-height": `${lineCount * 19.2 + 22}px`,
  } as CSSProperties;
}

/**
 * Source text laid out as the code editor lays it out, line numbers and
 * all, while the editor's own code loads. Nothing moves when the editor
 * takes its place, so loading it shows no second stage (#1673).
 */
export function StaticCodeView({
  ariaLabel,
  value,
  invalid,
}: {
  ariaLabel: string;
  value: string;
  invalid?: boolean;
}) {
  const [first = "", ...rest] = value.split(/\r\n?|\n/u);
  const numbers = rest.map((_, index) => index + 2).join("\n");
  // The editor marks the line its cursor starts on; the first line here.
  return (
    <div
      className="project-source-editor static-code-view"
      data-invalid={invalid ? "true" : "false"}
      role="region"
      aria-label={ariaLabel}
      aria-busy="true"
    >
      <div className="static-code-scroller">
        <div className="static-code-gutter" aria-hidden="true">
          <div className="static-code-active">1</div>
          {rest.length ? <div>{numbers}</div> : null}
        </div>
        <div className="static-code-content">
          <div className="static-code-active">{first || <br />}</div>
          {rest.length ? <div>{rest.join("\n")}</div> : null}
        </div>
      </div>
    </div>
  );
}
