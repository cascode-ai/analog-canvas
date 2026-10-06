const WHOLE_TAG_LABELS: Record<string, string> = {
  amplifier: "General Amplifier",
  // A logic gate's name on its own. Inside a longer tag, "and" and "or" are
  // small words.
  and: "AND",
  "and gate": "AND Gate",
  "auto zero": "Auto-Zero",
  "b icmos": "BiCMOS",
  "gm c": "gm-C",
  or: "OR",
  "or gate": "OR Gate",
  "t coil": "T-Coil",
};

const TAG_WORD_LABELS: Record<string, string> = {
  a: "A",
  ab: "AB",
  ac: "AC",
  adc: "ADC",
  agc: "AGC",
  b: "B",
  bgr: "BGR",
  bicmos: "BiCMOS",
  bjt: "BJT",
  bpf: "BPF",
  cdr: "CDR",
  cim: "CIM",
  cml: "CML",
  cmfb: "CMFB",
  cmos: "CMOS",
  cmrr: "CMRR",
  ctat: "CTAT",
  ctle: "CTLE",
  d: "D",
  dac: "DAC",
  dc: "DC",
  dcdc: "DC–DC",
  "dc-ac-dc": "DC–AC–DC",
  "dc-dc": "DC–DC",
  dco: "DCO",
  dfe: "DFE",
  dll: "DLL",
  dnl: "DNL",
  dram: "DRAM",
  emi: "EMI",
  enob: "ENOB",
  esd: "ESD",
  ffe: "FFE",
  finfet: "FinFET",
  fir: "FIR",
  fsm: "FSM",
  gbw: "GBW",
  gm: "gm",
  hpf: "HPF",
  igbt: "IGBT",
  iir: "IIR",
  inl: "INL",
  iq: "IQ",
  jfet: "JFET",
  jk: "JK",
  lc: "LC",
  ldmos: "LDMOS",
  ldo: "LDO",
  lna: "LNA",
  lpf: "LPF",
  lvds: "LVDS",
  mems: "MEMS",
  mim: "MIM",
  mom: "MOM",
  mos: "MOS",
  mosfet: "MOSFET",
  mppt: "MPPT",
  nand: "NAND",
  nmos: "NMOS",
  nor: "NOR",
  ota: "OTA",
  pa: "PA",
  pfd: "PFD",
  pga: "PGA",
  pll: "PLL",
  pmos: "PMOS",
  psrr: "PSRR",
  ptat: "PTAT",
  pwm: "PWM",
  // A whole term too: "r-2r ladder" reads "R-2R Ladder", not "R-2r Ladder".
  "r-2r": "R-2R",
  rc: "RC",
  rf: "RF",
  rlc: "RLC",
  rms: "RMS",
  sar: "SAR",
  sepic: "SEPIC",
  serdes: "SerDes",
  smps: "SMPS",
  sndr: "SNDR",
  snr: "SNR",
  soi: "SOI",
  sr: "SR",
  sram: "SRAM",
  tdc: "TDC",
  tia: "TIA",
  tspc: "TSPC",
  uvlo: "UVLO",
  vco: "VCO",
  vga: "VGA",
  xor: "XOR",
  zvs: "ZVS",
};

/** Small words stay lowercase after a tag's first word: "Sample and Hold". */
const SMALL_TAG_WORDS = new Set([
  "and",
  "for",
  "in",
  "of",
  "or",
  "the",
  "to",
  "via",
  "vs",
  "with",
]);

const GALLERY_LABEL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function compareGalleryLabels(left: string, right: string): number {
  return GALLERY_LABEL_COLLATOR.compare(left, right);
}

/** One piece of a word between hyphens, slashes, plus signs or brackets. */
function tagPartLabel(part: string, leading: boolean): string {
  const known = TAG_WORD_LABELS[part];
  if (known) return known;
  if (!leading && SMALL_TAG_WORDS.has(part)) return part;
  return part.replace(/^[a-z]/u, (letter) => letter.toUpperCase());
}

/** Stored tags stay normalized lowercase; this is presentation only. */
export function galleryTagLabel(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  return (
    WHOLE_TAG_LABELS[normalized] ??
    normalized
      .split(" ")
      .map(
        (word, index) =>
          TAG_WORD_LABELS[word] ??
          word
            .split(/([-/+()])/u)
            .map((part, at) => tagPartLabel(part, index === 0 && at === 0))
            .join(""),
      )
      .join(" ")
  );
}

/** Tag menus are alphabetical by what readers see, never by live popularity. */
export function compareGalleryTagLabels(left: string, right: string): number {
  return compareGalleryLabels(galleryTagLabel(left), galleryTagLabel(right));
}
