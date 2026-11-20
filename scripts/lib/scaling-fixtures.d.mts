import type { importSpiceSources } from "@icm/spice";

export function createScalingInputs(): Map<string, string>;
export function createSharedSupplyInput(
  importer: typeof importSpiceSources,
): Promise<string>;
export function verifyScalingInput(name: string, body: string): void;
