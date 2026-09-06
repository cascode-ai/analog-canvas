export interface WaveformTraceChoice {
  readonly id: string;
  readonly label: string;
  readonly colorIndex: number;
  readonly visible: boolean;
}

/**
 * A compact plot-side legend. Visibility is the only button state: pressed
 * means the authored Output is drawn, and pressing it again hides the trace.
 */
export function WaveformTraceList({
  traces,
  label,
  onToggle,
}: {
  traces: readonly WaveformTraceChoice[];
  label: string;
  onToggle(traceId: string): void;
}) {
  return (
    <div className="waveform-trace-list" role="group" aria-label={label}>
      {traces.map((trace) => (
        <button
          key={trace.id}
          type="button"
          className={`waveform-trace-toggle ac-trace-${trace.colorIndex % 6}`}
          aria-label={`${trace.visible ? "Hide" : "Show"} ${trace.label}`}
          aria-pressed={trace.visible}
          title={trace.label}
          onClick={() => onToggle(trace.id)}
        >
          {trace.label}
        </button>
      ))}
    </div>
  );
}
