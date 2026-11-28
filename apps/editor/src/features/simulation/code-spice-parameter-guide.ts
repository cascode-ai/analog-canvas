import { lookupSimulationHelp, type SimulationLanguageHelp } from "@icm/spice";
import { type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { createParameterGuide } from "./parameter-guide-view";

export function controlContext(text: string): boolean {
  return (
    [...text.matchAll(/^\s*\.(control|endc)\b/gimu)]
      .at(-1)?.[1]
      ?.toLowerCase() === "control"
  );
}

export function parameterGuide(state: EditorState) {
  const cursor = state.selection.main.head;
  let line = state.doc.lineAt(cursor);
  if (/^\s*(?:\*|;)/u.test(line.text)) return null;
  const head = /^\s*([.\w]+)(\s*)/u.exec(line.text);
  if (!head) return null;
  const context = controlContext(state.doc.sliceString(0, line.from))
    ? "control"
    : "deck";
  const waveform = /\b(PULSE|SIN|PWL)\s*\(/iu.exec(line.text);
  const waveEnd = waveform
    ? line.text.indexOf(")", waveform.index + waveform[0].length)
    : -1;
  const inWaveform =
    waveform &&
    cursor >= line.from + waveform.index + waveform[0].length &&
    (waveEnd < 0 || cursor <= line.from + waveEnd);
  const help =
    (inWaveform ? lookupSimulationHelp(waveform[1]!, "deck") : undefined) ??
    lookupSimulationHelp(head[1]!, context) ??
    (context === "deck"
      ? lookupSimulationHelp(head[1]![0]!, context)
      : undefined);
  if (!help?.parameters?.length || cursor < line.from + head[1]!.length)
    return null;
  // Balanced vectors/expressions and quoted paths form a single argument.
  const tokens: { from: number; to: number; value: string }[] = [];
  let start = -1,
    depth = 0,
    quote = "";
  const bodyStart = inWaveform
    ? waveform.index + waveform[0].length
    : head[0].length;
  if (inWaveform && waveEnd >= 0)
    line = {
      ...line,
      text: line.text.slice(0, waveEnd),
      to: line.from + waveEnd,
      length: waveEnd,
    };
  for (let i = bodyStart; i <= line.text.length; i++) {
    const char = line.text[i] ?? " ";
    if (start < 0 && /\s/u.test(char)) continue;
    if (start < 0) start = i;
    if (quote) {
      if (char === quote && line.text[i - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "{") depth++;
    else if (char === ")" || char === "}") depth--;
    if (/\s/u.test(char) && !quote && depth <= 0) {
      tokens.push({
        from: line.from + start,
        to: line.from + i,
        value: line.text.slice(start, i),
      });
      start = -1;
    }
  }
  const active = tokens.findIndex(
    (token) => cursor >= token.from && cursor <= token.to,
  );
  const index = active >= 0 ? active : tokens.length;
  let parameters = help.parameters.map((p, i) =>
    help.name.replace(/^\./u, "") === "ac" && i === 1
      ? {
          ...p,
          label:
            tokens[0]?.value.toLowerCase() === "dec"
              ? "points / decade"
              : tokens[0]?.value.toLowerCase() === "oct"
                ? "points / octave"
                : tokens[0]?.value.toLowerCase() === "lin"
                  ? "points (total)"
                  : "points",
        }
      : p,
  );
  if (/^[VI]$/u.test(help.name) && tokens[2]) {
    parameters = parameters.slice(0, 2);
    let ac = false,
      waveform = false;
    const clause = (value: string | undefined) =>
      /^(?:DC|AC|PULSE|SIN|PWL)(?:\(|$)/iu.test(value ?? "");
    for (let i = 2; i < tokens.length; i++) {
      const value = tokens[i]!.value.toUpperCase();
      if (value === "DC") {
        parameters.push({ label: "DC" }, { label: "DC value" });
        i++;
      } else if (value === "AC") {
        ac = true;
        parameters.push({ label: "AC" }, { label: "magnitude" });
        i++;
        if (!clause(tokens[i + 1]?.value)) {
          parameters.push({ label: "phase / deg", optional: true });
          if (tokens[i + 1]) i++;
        }
      } else if (/^(PULSE|SIN|PWL)\(/u.test(value)) {
        waveform = true;
        parameters.push({ label: "transient waveform" });
      } else parameters.push({ label: i === 2 ? "DC value" : "excitation" });
    }
    if (!ac)
      parameters.push({ label: "AC magnitude [phase / deg]", optional: true });
    if (!waveform)
      parameters.push({
        label: "PULSE(...) | SIN(...) | PWL(...)",
        optional: true,
      });
  }
  const repeated = parameters.at(-1);
  if (repeated?.repeat) {
    while (parameters.length <= index) parameters.push({ ...repeated });
  }
  return { line, help, tokens, index, parameters };
}

export function insertSpiceHelp(
  view: EditorView,
  help: SimulationLanguageHelp,
  from?: number,
  to?: number,
) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const start = from ?? line.from;
  const end = to ?? line.to;
  const name = /^[RCLVI]$/u.test(help.name) ? `${help.name}1` : help.name;
  const waveform = /^(PULSE|SIN|PWL)$/iu.test(name);
  const text = name + (waveform ? "()" : help.parameters?.length ? " " : "");
  view.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: { anchor: start + text.length - (waveform ? 1 : 0) },
    effects: dismissParameterGuide.of(false),
    userEvent: "input.complete",
  });
  view.focus();
}

const guide = createParameterGuide(parameterGuide);
export const dismissParameterGuide = guide.dismissParameterGuide;
export const dismissSpiceGuide = guide.dismiss;
export const spiceParameterGuide = guide.extension;
