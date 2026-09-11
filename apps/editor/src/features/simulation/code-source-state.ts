import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";
import {
  applyCodeTextChanges,
  type CodeTextChange,
} from "./code-text-coordinates";

export const restoreExactSource = StateEffect.define<string>();
const restoreLineEndings = StateEffect.define<string>();
export function changedSourceText(
  text: string,
  transaction: Transaction,
): string {
  const changes: CodeTextChange[] = [];
  transaction.changes.iterChanges((from, to, _fromB, _toB, insert) =>
    changes.push({ from, to, text: insert.toString() }),
  );
  return applyCodeTextChanges(text, changes);
}
export const exactSourceField = StateField.define<string>({
  create: () => "",
  update(value, transaction) {
    const restored = transaction.effects.filter((effect) =>
      effect.is(restoreExactSource),
    );
    if (restored.length) return restored.at(-1)!.value;
    const endings = transaction.effects
      .filter((effect) => effect.is(restoreLineEndings))
      .at(-1)?.value;
    if (endings !== undefined) {
      let line = 0;
      return transaction.newDoc.toString().replace(/\n/gu, () => {
        const code = endings[line++];
        return code === "c" ? "\r\n" : code === "r" ? "\r" : "\n";
      });
    }
    return transaction.docChanged
      ? changedSourceText(value, transaction)
      : value;
  },
});
/** Native history also restores the precise CRLF/LF bytes removed by grouped edits. */
export const exactSourceHistory = invertedEffects.of((transaction) =>
  transaction.docChanged
    ? [
        restoreLineEndings.of(
          (
            transaction.startState
              .field(exactSourceField)
              .match(/\r\n|\r|\n/gu) ?? []
          )
            .map((end) => (end === "\r\n" ? "c" : end === "\r" ? "r" : "n"))
            .join(""),
        ),
      ]
    : [],
);
