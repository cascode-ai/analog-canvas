/** Four-terminal primitive MOS names from the ICsprout55 v2 9T standard-cell CDL. */
export const ICS55_MOS_MODELS = {
  nmos: ["nm1p2_svt_lp", "nm1p2_lvt_lp", "nm1p2_hvt_lp"],
  pmos: ["pm1p2_svt_lp", "pm1p2_lvt_lp", "pm1p2_hvt_lp"],
} as const;

export function ics55MosType(name: string) {
  const key = name.toLowerCase();
  if (ICS55_MOS_MODELS.nmos.some((model) => model === key)) return "nmos";
  if (ICS55_MOS_MODELS.pmos.some((model) => model === key)) return "pmos";
  return undefined;
}
