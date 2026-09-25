/** One Greek letter and its name as LaTeX types it. */
export interface GreekLetter {
  readonly glyph: string;
  /** Capitalised for a capital letter (Φ Phi), lower case otherwise (φ phi),
   * as the LaTeX commands `\Phi` and `\phi` spell it. A netlist writes the
   * letter through `spellGreekLetters` instead (Φ PHI). */
  readonly name: string;
  /** LaTeX has a `\name` command for it; capitals that look like Latin letters
   * (Α, Β, Ε …) and omicron have none, so they are typed as those letters. */
  readonly latex: boolean;
}

const letter = (glyph: string, name: string, latex = true): GreekLetter => ({
  glyph,
  name,
  latex,
});

/** Every Greek letter, in alphabetical order, lower case then capitals. */
export const GREEK_LETTERS: readonly GreekLetter[] = [
  letter("α", "alpha"),
  letter("β", "beta"),
  letter("γ", "gamma"),
  letter("δ", "delta"),
  letter("ε", "epsilon"),
  letter("ζ", "zeta"),
  letter("η", "eta"),
  letter("θ", "theta"),
  letter("ι", "iota"),
  letter("κ", "kappa"),
  letter("λ", "lambda"),
  letter("μ", "mu"),
  letter("ν", "nu"),
  letter("ξ", "xi"),
  letter("ο", "omicron", false),
  letter("π", "pi"),
  letter("ρ", "rho"),
  letter("σ", "sigma"),
  letter("τ", "tau"),
  letter("υ", "upsilon"),
  letter("φ", "phi"),
  letter("χ", "chi"),
  letter("ψ", "psi"),
  letter("ω", "omega"),
  letter("Α", "Alpha", false),
  letter("Β", "Beta", false),
  letter("Γ", "Gamma"),
  letter("Δ", "Delta"),
  letter("Ε", "Epsilon", false),
  letter("Ζ", "Zeta", false),
  letter("Η", "Eta", false),
  letter("Θ", "Theta"),
  letter("Ι", "Iota", false),
  letter("Κ", "Kappa", false),
  letter("Λ", "Lambda"),
  letter("Μ", "Mu", false),
  letter("Ν", "Nu", false),
  letter("Ξ", "Xi"),
  letter("Ο", "Omicron", false),
  letter("Π", "Pi"),
  letter("Ρ", "Rho", false),
  letter("Σ", "Sigma"),
  letter("Τ", "Tau", false),
  letter("Υ", "Upsilon"),
  letter("Φ", "Phi"),
  letter("Χ", "Chi", false),
  letter("Ψ", "Psi"),
  letter("Ω", "Omega"),
];

/**
 * How a netlist spells each Greek letter: a small letter in small letters,
 * a capital in capitals (σ sigma, Σ SIGMA). A table of its own, because
 * LaTeX capitalises only a capital's first letter (`\Sigma`). The last
 * entries read alternative forms of the same letters: final sigma, the
 * "variant" glyphs, and the micro and ohm signs keyboards type for μ and Ω.
 */
const NETLIST_GREEK_NAMES: Readonly<Record<string, string>> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "epsilon",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ι: "iota",
  κ: "kappa",
  λ: "lambda",
  μ: "mu",
  ν: "nu",
  ξ: "xi",
  ο: "omicron",
  π: "pi",
  ρ: "rho",
  σ: "sigma",
  τ: "tau",
  υ: "upsilon",
  φ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
  Α: "ALPHA",
  Β: "BETA",
  Γ: "GAMMA",
  Δ: "DELTA",
  Ε: "EPSILON",
  Ζ: "ZETA",
  Η: "ETA",
  Θ: "THETA",
  Ι: "IOTA",
  Κ: "KAPPA",
  Λ: "LAMBDA",
  Μ: "MU",
  Ν: "NU",
  Ξ: "XI",
  Ο: "OMICRON",
  Π: "PI",
  Ρ: "RHO",
  Σ: "SIGMA",
  Τ: "TAU",
  Υ: "UPSILON",
  Φ: "PHI",
  Χ: "CHI",
  Ψ: "PSI",
  Ω: "OMEGA",
  ς: "sigma",
  ϵ: "epsilon",
  ϑ: "theta",
  ϰ: "kappa",
  ϖ: "pi",
  ϱ: "rho",
  ϕ: "phi",
  ϴ: "THETA",
  µ: "mu", // U+00B5 MICRO SIGN, not U+03BC
  Ω: "OMEGA", // U+2126 OHM SIGN, not U+03A9
};

/**
 * Write each Greek letter as its standard name, in its own case, so a Net
 * drawn as φ₁ (name `φ1`) is written `phi1`, Φ₁ is written `PHI1` and Ω is
 * written `OMEGA`. Netlist formats read only ASCII names; everything else is
 * left as it is.
 */
export function spellGreekLetters(text: string): string {
  let spelled = "";
  for (const character of text)
    spelled += NETLIST_GREEK_NAMES[character] ?? character;
  return spelled;
}
