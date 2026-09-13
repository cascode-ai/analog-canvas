import {
  expandedComponentSymbols,
  expandedComponentCatalogEntries,
} from "./expanded-components.generated.js";
import type { SymbolDefinition } from "./schema.js";

/**
 * Optional devices that extend the Reference-calibrated Razavi core without
 * claiming Razavi visual authority.  These symbols follow the conventional
 * high-voltage and MOS-variant drawings supplied for the Extended Devices
 * library. Derived MOS entries deliberately reuse the complete NMOS/PMOS
 * artwork and add only their named distinguishing geometry.
 */

export const EXTENDED_DEVICE_CATEGORY = "Extended Devices";
export const HIGH_VOLTAGE_DEVICE_SUBCATEGORY = "High-voltage devices";
export const MOS_VARIANT_SUBCATEGORY = "MOS variants";

export interface ExpandedDeviceCatalogEntry {
  readonly symbolId: string;
  readonly category: typeof EXTENDED_DEVICE_CATEGORY;
  readonly subcategory:
    typeof HIGH_VOLTAGE_DEVICE_SUBCATEGORY | typeof MOS_VARIANT_SUBCATEGORY;
}

export const nChannelDmosSymbol = expandedComponentSymbols.find(
  (symbol) => symbol.id === "ndmos",
)!;
export const pChannelDmosSymbol = expandedComponentSymbols.find(
  (symbol) => symbol.id === "pdmos",
)!;

export const expandedDeviceSymbols: readonly SymbolDefinition[] =
  expandedComponentSymbols;

export const expandedDeviceCatalogEntries: readonly ExpandedDeviceCatalogEntry[] =
  expandedComponentCatalogEntries;

export function expandedDeviceCatalogEntry(
  symbolId: string,
): ExpandedDeviceCatalogEntry | undefined {
  return expandedDeviceCatalogEntries.find(
    (entry) => entry.symbolId === symbolId,
  );
}
