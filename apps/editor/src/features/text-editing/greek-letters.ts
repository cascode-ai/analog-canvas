/**
 * Greek letters by their LaTeX command names, so `\phi` spells φ and
 * `\Omega` spells Ω. Capitals that look like Latin letters (A, B, E …) have
 * no command in LaTeX either and are typed as those letters.
 */
export const GREEK_LOWERCASE: readonly (readonly [
  name: string,
  glyph: string,
])[] = [
  ["alpha", "α"],
  ["beta", "β"],
  ["gamma", "γ"],
  ["delta", "δ"],
  ["epsilon", "ε"],
  ["zeta", "ζ"],
  ["eta", "η"],
  ["theta", "θ"],
  ["iota", "ι"],
  ["kappa", "κ"],
  ["lambda", "λ"],
  ["mu", "μ"],
  ["nu", "ν"],
  ["xi", "ξ"],
  ["pi", "π"],
  ["rho", "ρ"],
  ["sigma", "σ"],
  ["tau", "τ"],
  ["upsilon", "υ"],
  ["phi", "φ"],
  ["chi", "χ"],
  ["psi", "ψ"],
  ["omega", "ω"],
];

export const GREEK_UPPERCASE: readonly (readonly [
  name: string,
  glyph: string,
])[] = [
  ["Gamma", "Γ"],
  ["Delta", "Δ"],
  ["Theta", "Θ"],
  ["Lambda", "Λ"],
  ["Xi", "Ξ"],
  ["Pi", "Π"],
  ["Sigma", "Σ"],
  ["Upsilon", "Υ"],
  ["Phi", "Φ"],
  ["Psi", "Ψ"],
  ["Omega", "Ω"],
];

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
