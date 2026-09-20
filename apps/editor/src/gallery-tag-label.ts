const WHOLE_TAG_LABELS: Record<string, string> = {
  amplifier: "General Amplifier",
  "b icmos": "BiCMOS",
  dcdc: "DC–DC",
  "dc-dc": "DC–DC",
  "gm c": "gm-C",
  "r-2r": "R-2R",
  "t coil": "T-Coil",
};

const TAG_WORD_LABELS: Record<string, string> = {
  a: "A",
  ab: "AB",
  adc: "ADC",
  and: "AND",
  b: "B",
  bjt: "BJT",
  cdr: "CDR",
  cml: "CML",
  cmfb: "CMFB",
  cmos: "CMOS",
  ctat: "CTAT",
  ctle: "CTLE",
  d: "D",
  dac: "DAC",
  dfe: "DFE",
  dll: "DLL",
  dram: "DRAM",
  lc: "LC",
  ldo: "LDO",
  lna: "LNA",
  mos: "MOS",
  nmos: "NMOS",
  nand: "NAND",
  nor: "NOR",
  or: "OR",
  ota: "OTA",
  pll: "PLL",
  pmos: "PMOS",
  ptat: "PTAT",
  rf: "RF",
  rc: "RC",
  sar: "SAR",
  sram: "SRAM",
  tia: "TIA",
  tspc: "TSPC",
  vco: "VCO",
  xor: "XOR",
};

const TAG_LABEL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** Stored tags stay normalized lowercase; this is presentation only. */
export function galleryTagLabel(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  return (
    WHOLE_TAG_LABELS[normalized] ??
    normalized
      .split(" ")
      .map(
        (word) =>
          TAG_WORD_LABELS[word] ??
          word.replace(
            /(^|[-/+()])([a-z])/gu,
            (_match, boundary, letter) => `${boundary}${letter.toUpperCase()}`,
          ),
      )
      .join(" ")
  );
}

/** Tag menus are alphabetical by what readers see, never by live popularity. */
export function compareGalleryTagLabels(left: string, right: string): number {
  return TAG_LABEL_COLLATOR.compare(
    galleryTagLabel(left),
    galleryTagLabel(right),
  );
}
