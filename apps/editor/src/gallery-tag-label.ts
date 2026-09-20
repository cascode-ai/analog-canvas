const WHOLE_TAG_LABELS: Record<string, string> = {
  amplifier: "General Amplifier",
  "b icmos": "BiCMOS",
  "dc-dc": "DC–DC",
  "gm c": "gm-C",
  "r-2r": "R-2R",
  "t coil": "T-Coil",
};

const TAG_WORD_LABELS: Record<string, string> = {
  a: "A",
  ab: "AB",
  adc: "ADC",
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
  ldo: "LDO",
  lna: "LNA",
  mos: "MOS",
  nmos: "NMOS",
  ota: "OTA",
  pll: "PLL",
  pmos: "PMOS",
  ptat: "PTAT",
  rf: "RF",
  sar: "SAR",
  sram: "SRAM",
  tia: "TIA",
  tspc: "TSPC",
  vco: "VCO",
};

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
