/** Four-terminal MOS names of Cadence's GPDK045 (45 nm Generic Process Design Kit). */
export const GPDK045_MOS_MODELS = {
  nmos: ["nmos1v", "nmos1v_lvt", "nmos1v_hvt", "nmos2v"],
  pmos: ["pmos1v", "pmos1v_lvt", "pmos1v_hvt", "pmos2v"],
} as const;

/** The sections of the kit's `gpdk045.scs`. */
export const GPDK045_CORNERS = ["tt", "ff", "ss", "fs", "sf"] as const;
export type Gpdk045Corner = (typeof GPDK045_CORNERS)[number];

export function gpdk045MosType(name: string) {
  const key = name.toLowerCase();
  if (GPDK045_MOS_MODELS.nmos.some((model) => model === key)) return "nmos";
  if (GPDK045_MOS_MODELS.pmos.some((model) => model === key)) return "pmos";
  return undefined;
}

/** The kit CDF's default geometry: the 2 V devices are thick-oxide. */
export function gpdk045MosGeometry(name: string) {
  return /2v$/iu.test(name)
    ? { l: "150n", w: "400n" }
    : { l: "45n", w: "120n" };
}
