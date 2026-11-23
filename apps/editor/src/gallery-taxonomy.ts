import taxonomy from "../../../config/gallery-taxonomy.json";
export const galleryTagGroups = Object.entries(taxonomy.tagsByGroup);
const TAG_ALIASES: Record<string, string> = {
  op: "operational amplifier",
  osc: "oscillator",
  bgr: "bandgap",
  dcdc: "dc-dc",
  "d-latch": "d latch",
  levelshifter: "level shifter",
  sha: "sample and hold",
  "switch capacitor": "switched capacitor",
  cts: "charge transfer switch",
  "v-i": "voltage to current",
  vtc: "voltage to time",
  tdc: "time to digital",
  "gain-boost": "gain boosting",
  "low-dropout": "ldo",
  dropout: "ldo",
  "linear regulator": "regulator",
  "bootstrapped cts": "charge transfer switch",
};

export function galleryTagGroup(tag: string): string {
  const key = TAG_ALIASES[tag.toLowerCase()] ?? tag.toLowerCase();
  return (
    galleryTagGroups.find(([, values]) => values.includes(key))?.[0] ??
    "Custom & legacy"
  );
}
