import { razaviLibrarySymbols } from "./razavi-catalog.js";

/**
 * The sole runtime device library. The historical hand-authored and generic
 * compatibility symbols were intentionally removed; this collection contains
 * only reviewed Razavi catalog entries.
 *
 * Everything reviewed resolves here, browsable or not: a Symbol an action
 * switches an Instance to must draw even though nobody picks it from the
 * Library. The Library's own list is `razaviProductSymbols`.
 */
export const builtInSymbols = razaviLibrarySymbols;
