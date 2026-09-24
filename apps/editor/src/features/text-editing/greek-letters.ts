import { GREEK_LETTERS } from "@icm/model";

/**
 * Greek letters by their LaTeX command names, so `\phi` spells φ and
 * `\Omega` spells Ω. Capitals that look like Latin letters (A, B, E …) have
 * no command in LaTeX either and are typed as those letters. The shared table
 * also gives the names a netlist writes every Greek letter with.
 */
function latexCommands(capital: boolean) {
  return GREEK_LETTERS.filter(
    ({ glyph, latex }) => latex && (glyph !== glyph.toLowerCase()) === capital,
  ).map(({ name, glyph }) => [name, glyph] as const);
}

export const GREEK_LOWERCASE: readonly (readonly [
  name: string,
  glyph: string,
])[] = latexCommands(false);

export const GREEK_UPPERCASE: readonly (readonly [
  name: string,
  glyph: string,
])[] = latexCommands(true);

export const GREEK_COMMANDS: Readonly<Record<string, string>> =
  Object.fromEntries([...GREEK_LOWERCASE, ...GREEK_UPPERCASE]);

/**
 * The Greek letter a `\name` command spells at the end of `text` (the text
 * just before the caret), with the length of the command it replaces.
 */
export function greekCommandBefore(
  text: string,
): { glyph: string; length: number } | null {
  const match = /\\([A-Za-z]+)$/u.exec(text);
  const glyph = match ? GREEK_COMMANDS[match[1]!] : undefined;
  return match && glyph ? { glyph, length: match[0].length } : null;
}
