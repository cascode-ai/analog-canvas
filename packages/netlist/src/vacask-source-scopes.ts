import type { SimulationCircuitBinding } from "@icm/model";
import type { DesignNetlistIR } from "./ir.js";
import {
  authoredCircuitScopes,
  type AuthoredCircuitEvent,
} from "./authored-circuit-scopes.js";
import type { SourceFileGraph } from "./source-file-graph.js";
import type {
  VacaskSourceStatement,
  VacaskSourceToken,
} from "./vacask-source.js";

function bare(statement: VacaskSourceStatement, name: string) {
  const token = statement.tokens[0];
  return (
    token?.kind === "word" &&
    token.value === name &&
    statement.rawText.slice(0, token.end - token.start) === name
  );
}

/** Only statically declared circuit facts feed Canvas acquisition mapping.
 * Native control/evaluation stays simulator-owned; conditional calls remain
 * runnable but do not acquire a guessed Canvas identity. */
export function vacaskCircuitScopes(
  graph: SourceFileGraph<VacaskSourceStatement>,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
) {
  return authoredCircuitScopes(
    vacaskAuthoredCircuitEvents(graph),
    binding,
    circuit,
    {
      key: (name) => name,
      separator: ":",
    },
  );
}

/** Shared literal circuit facts for occurrence resolution and authoring helpers.
 * Control programs are never evaluated to guess an instance or node identity. */
export function vacaskAuthoredCircuitEvents(
  graph: SourceFileGraph<VacaskSourceStatement>,
): AuthoredCircuitEvent[] {
  const events: AuthoredCircuitEvent[] = [];
  let conditionalDepth = 0;
  let control = false;
  const words = (tokens: VacaskSourceToken[]) =>
    tokens.every((t) => t.kind === "word");
  for (const { statement } of graph.statements) {
    if (bare(statement, "control")) {
      control = true;
      continue;
    }
    if (control) {
      if (bare(statement, "endc")) control = false;
      continue;
    }
    if (bare(statement, "@if")) {
      conditionalDepth++;
      continue;
    }
    if (bare(statement, "@end")) {
      conditionalDepth = Math.max(0, conditionalDepth - 1);
      continue;
    }
    const [head, name] = statement.tokens;
    if (!head) continue;
    if (bare(statement, "global") || bare(statement, "ground")) {
      const names = statement.tokens.slice(1);
      if (words(names))
        events.push({ kind: "globals", names: names.map((t) => t.value) });
    } else if (bare(statement, "model") && name?.kind === "word")
      events.push({
        kind: "opaque-master",
        name: name.value,
        ...(conditionalDepth === 0 && statement.tokens[2]?.kind === "word"
          ? { module: statement.tokens[2].value }
          : {}),
      });
    else if (bare(statement, "ends")) events.push({ kind: "end" });
    else {
      const definition = bare(statement, "subckt");
      const start = definition ? 2 : 1;
      const tokens = statement.tokens;
      const end = tokens.findIndex(
        (t, i) => i > start && t.value === ")" && t.kind === "symbol",
      );
      if (
        tokens[start]?.value !== "(" ||
        tokens[start]?.kind !== "symbol" ||
        end < 0
      )
        continue;
      const nodes = tokens.slice(start + 1, end);
      if (!words(nodes)) continue;
      if (definition && name?.kind === "word")
        events.push({
          kind: "definition",
          name: name.value,
          ports: nodes.map((t) => t.value),
          conditional: conditionalDepth > 0,
        });
      else if (head.kind === "word" && tokens[end + 1]?.kind === "word")
        events.push({
          kind: "call",
          name: head.value,
          nodes: nodes.map((t) => t.value),
          master: tokens[end + 1]!.value,
          conditional: conditionalDepth > 0,
        });
    }
  }
  return events;
}
