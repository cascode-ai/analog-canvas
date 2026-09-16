# Reference Sources

Reference repositories are pinned research inputs, not product dependencies.
They are fetched into the ignored `.reference-src/` directory and must never
be imported, bundled, or required by CI or a product build.

`manifest.json` records repository identity, immutable commit, declared
license, usage classification, default-fetch selection, allowed study scope,
and explicitly excluded scope.

The previous `net-painting-converter` repository has a deliberately narrow
role. Only its SPICE source handling, parsing, diagnostics, and fixtures may be
considered. Its automatic layout, routing, Page Scene, rendering, publishing,
and repository workflow are not architectural inputs to this product.

Fetch the default references:

```powershell
./scripts/fetch-references.ps1
```

Fetch one optional reference:

```powershell
./scripts/fetch-references.ps1 -Name spice-ts
```

The script refuses to rewrite an existing checkout whose origin or checked-out
commit differs. Resolve such state manually; reference fetching must not hide
local work or silently move a pin.
