import {
  expandedComponentSymbols,
  expandedComponentCatalogEntries,
} from "./expanded-components.generated.js";
import type { SymbolDefinition } from "./schema.js";

/**
 * Optional devices that extend the Reference-calibrated Razavi core without
 * claiming Razavi visual authority.  These symbols follow the conventional
 * high-voltage DMOS drawing supplied for the Extended Devices library. DMOS
 * deliberately reuses the complete NMOS/PMOS artwork and differs only by one
 * additional line in the drain-side drift region.
 */

export const EXTENDED_DEVICE_CATEGORY = "Extended Devices";
export const HIGH_VOLTAGE_DEVICE_SUBCATEGORY = "High-voltage devices";

export interface ExpandedDeviceCatalogEntry {
  readonly symbolId: string;
  readonly category: typeof EXTENDED_DEVICE_CATEGORY;
  readonly subcategory: typeof HIGH_VOLTAGE_DEVICE_SUBCATEGORY;
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
