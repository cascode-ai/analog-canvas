# netlist-crawler attribution

The deterministic translator in `src/conversion.ts` adapts the tokenization,
numeric suffix conversion, and pragmatic instance translation in
[Arcadia-1/netlist-crawler](https://github.com/Arcadia-1/netlist-crawler),
`src/netlist_crawler/translate/core.py` (public main, retrieved 2026-09-15).
The upstream code is Copyright (c) 2026 Token Zhang under the adjacent MIT license.

Canvas's TypeScript adaptation runs in the Worker and browser with no Python
service. It is a strict structural subset, not a vendored copy of the entire CLI.
It rejects unsupported fields instead of dropping them, handles parenthesized
subcircuit declarations and SPICE language sections, checks generated reference
collisions, and leaves PDK selection to the explicit export configuration.
It never resolves includes, searches the filesystem or executes a netlist.

The browser/portable distribution also includes this notice as
`apps/editor/public/third-party/netlist-crawler-LICENSE.txt`; keep that copy
identical to the adjacent license when updating the attribution.
