import { useEffect, useMemo, useRef, useState } from "react";

import { matchDevices, netlistDevices } from "../netlist-match";

/** A netlist as it loads: its text, or why there is none. */
export interface LoadedNetlist {
  text: string | null;
  /** False when `text` is a message rather than a netlist. */
  ok: boolean;
}

/** One side's SPICE netlist, read once per URL. */
export function useNetlistText(
  url: string | null,
  read: (payload: {
    sourceNetlist?: string;
    netlist?: { text?: string } | null;
  }) => string | undefined,
  empty: string,
  fetchLike: typeof fetch,
): LoadedNetlist {
  const [loaded, setLoaded] = useState<LoadedNetlist>({
    text: null,
    ok: false,
  });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoaded({ text: null, ok: false });
    void fetchLike(url, { credentials: "same-origin" })
      .then(async (response): Promise<LoadedNetlist> => {
        if (response.status === 429)
          return {
            text: "Today's circuit opens are used up; the netlist returns tomorrow.",
            ok: false,
          };
        if (!response.ok)
          return { text: "The netlist could not be loaded.", ok: false };
        const text = read(await response.json())?.trim();
        return text ? { text, ok: true } : { text: empty, ok: false };
      })
      .catch(() => ({ text: "The netlist could not be loaded.", ok: false }))
      .then((next) => !cancelled && setLoaded(next));
    return () => {
      cancelled = true;
    };
    // `read` and `empty` belong to the caller's one call site per side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, fetchLike]);
  return loaded;
}

type Side = 0 | 1;

/**
 * The two netlists in full, side by side. With both in hand, choosing a
 * device's line lights its counterpart on the other side, matched by what
 * the devices connect to (their names differ).
 */
export function NetlistPair({
  theirs,
  ours,
}: {
  theirs: LoadedNetlist | null;
  ours: LoadedNetlist;
}) {
  const sides = [theirs, ours] as const;
  const devices = useMemo(
    () =>
      sides.map((side) =>
        side?.ok && side.text ? netlistDevices(side.text) : [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theirs?.text, ours.text],
  );
  const pairs = useMemo(() => {
    if (!devices[0]!.length || !devices[1]!.length) return null;
    const forward = matchDevices(devices[0]!, devices[1]!);
    return [
      forward,
      new Map([...forward].map(([left, right]) => [right, left])),
    ] as const;
  }, [devices]);
  const [selected, setSelected] = useState<{ side: Side; name: string } | null>(
    null,
  );
  useEffect(() => setSelected(null), [theirs?.text, ours.text]);
  const counterpart =
    selected && pairs ? pairs[selected.side].get(selected.name) : undefined;
  const lines = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!selected || !counterpart) return;
    lines.current
      .get(`${1 - selected.side}:${counterpart}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, counterpart]);

  const render = (side: Side) => {
    const loaded = sides[side];
    if (!loaded) return <div />;
    if (loaded.text === null)
      return <pre className="review-netlist">Loading the netlist…</pre>;
    if (!loaded.ok || !pairs)
      return <pre className="review-netlist">{loaded.text}</pre>;
    const byLine = new Map(
      devices[side]!.map((device) => [device.line, device]),
    );
    return (
      <pre className="review-netlist matched" data-testid={`netlist-${side}`}>
        {loaded.text.split("\n").map((line, index) => {
          const device = byLine.get(index);
          if (!device)
            return (
              <span key={index} className="nl-line">
                {line || " "}
              </span>
            );
          const on =
            (selected?.side === side && selected.name === device.name) ||
            (selected?.side !== side && counterpart === device.name);
          return (
            <span
              key={index}
              ref={(element) => {
                if (element)
                  lines.current.set(`${side}:${device.name}`, element);
              }}
              className={`nl-line nl-device${on ? " on" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={() =>
                setSelected((current) =>
                  current?.side === side && current.name === device.name
                    ? null
                    : { side, name: device.name },
                )
              }
            >
              {line}
            </span>
          );
        })}
      </pre>
    );
  };

  return (
    <>
      {render(0)}
      {render(1)}
      {pairs ? (
        <p className="review-netlist-pairing" data-testid="netlist-pairing">
          {selected
            ? counterpart
              ? `${selected.side === 0 ? selected.name : counterpart} in the dataset is ${
                  selected.side === 0 ? counterpart : selected.name
                } in ours.`
              : `${selected.name} has no counterpart on the other side.`
            : "Click a device's line to light its counterpart on the other side."}
        </p>
      ) : null}
    </>
  );
}
