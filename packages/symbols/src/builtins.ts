import { expandedDeviceSymbols } from "./expanded-device-catalog.js";
import { razaviLibrarySymbols } from "./razavi-catalog.js";

/**
 * The complete runtime resolver library. The Reference-calibrated Razavi core
 * remains authoritative for its own style, while deliberately separated
 * Extended Devices add optional device families without claiming that
 * authority.
 *
 * Everything reviewed resolves here, browsable or not: a Symbol an action
 * switches an Instance to must draw even though nobody picks it from the
 * Library. Browsable lists are owned by `razaviProductSymbols` and
 * `expandedDeviceSymbols`.
 */
export const builtInSymbols = freezeSnapshot([
  ...razaviLibrarySymbols,
  ...expandedDeviceSymbols,
]);
import { freezeSnapshot } from "@icm/model";
