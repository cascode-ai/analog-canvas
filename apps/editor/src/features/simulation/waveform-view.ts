import { useEffect, useState, type SetStateAction } from "react";

export type WaveformRange = readonly [number, number];
export type WaveformAxes = "xy" | "x" | "y";
export type MarkerName = "A" | "B";
export interface WaveformView {
  x: WaveformRange | undefined;
  y: Readonly<Record<string, WaveformRange | undefined>>;
}
export interface WaveformState {
  history: readonly WaveformView[];
  index: number;
  axes: WaveformAxes;
  markers: Partial<Record<MarkerName, number>>;
  activeMarker: MarkerName;
  hidden: ReadonlySet<string>;
  selected: string | null;
}
export function initialWaveformState(): WaveformState {
  return {
    history: [{ x: undefined, y: {} }],
    index: 0,
    axes: "xy",
    markers: {},
    activeMarker: "A",
    hidden: new Set(),
    selected: null,
  };
}

export function commitWaveformView(
  state: WaveformState,
  view: WaveformView,
): WaveformState {
  if (
    [view.x, ...Object.values(view.y)].some(
      (range) =>
        range &&
        (!Number.isFinite(range[0]) ||
          !Number.isFinite(range[1]) ||
          range[0] >= range[1]),
    )
  )
    return state;
  if (JSON.stringify(state.history[state.index]) === JSON.stringify(view))
    return state;
  const history = [...state.history.slice(0, state.index + 1), view].slice(-50);
  return { ...state, history, index: history.length - 1 };
}
export function travelWaveformView(
  state: WaveformState,
  delta: number,
): WaveformState {
  return {
    ...state,
    index: Math.max(0, Math.min(state.history.length - 1, state.index + delta)),
  };
}

/** Session-only result views. Unique run/analysis keys prevent reuse on a new run.
 * Bounded storage survives tab/panel unmounts without retaining numeric results.
 */
const resultViews = new Map<string, WaveformState>();
export function useWaveformView(resultKey?: string) {
  const [state, setState] = useState(
    () =>
      (resultKey ? resultViews.get(resultKey) : undefined) ??
      initialWaveformState(),
  );
  useEffect(() => {
    if (resultKey) {
      resultViews.delete(resultKey);
      resultViews.set(resultKey, state);
      if (resultViews.size > 24)
        resultViews.delete(resultViews.keys().next().value!);
    }
  }, [resultKey, state]);
  const update = (apply: (current: WaveformState) => WaveformState) =>
    setState(apply);
  const set = <K extends keyof WaveformState>(
    key: K,
    value: SetStateAction<WaveformState[K]>,
  ) =>
    update((current) => ({
      ...current,
      [key]:
        typeof value === "function"
          ? (value as (v: WaveformState[K]) => WaveformState[K])(current[key])
          : value,
    }));
  return {
    state,
    view: state.history[state.index]!,
    set,
    commit: (view: WaveformView) =>
      update((current) => commitWaveformView(current, view)),
    travel: (delta: number) =>
      update((current) => travelWaveformView(current, delta)),
    mark: (x: number, marker?: MarkerName) =>
      update((current) => ({
        ...current,
        markers: {
          ...current.markers,
          [marker ?? current.activeMarker]: x,
        },
      })),
  };
}
export type WaveformController = ReturnType<typeof useWaveformView>;

export function parseWaveformRange(
  low: string,
  high: string,
  logarithmic = false,
): WaveformRange | string {
  const min = Number(low),
    max = Number(high);
  if (
    !low.trim() ||
    !high.trim() ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  )
    return "Enter finite minimum and maximum values.";
  if (min >= max) return "Minimum must be less than maximum.";
  if (logarithmic && min <= 0)
    return "Logarithmic frequency limits must be positive.";
  return [min, max];
}

export function zoomWaveformRange(
  range: WaveformRange,
  factor: number,
  logarithmic = false,
): WaveformRange {
  const low = logarithmic ? Math.log(range[0]) : range[0];
  const high = logarithmic ? Math.log(range[1]) : range[1];
  const center = (low + high) / 2,
    half = ((high - low) * factor) / 2;
  return logarithmic
    ? [Math.exp(center - half), Math.exp(center + half)]
    : [center - half, center + half];
}
