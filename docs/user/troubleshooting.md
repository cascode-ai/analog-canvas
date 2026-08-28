# Troubleshooting v0.1

## Import says the entry is ambiguous

Choose exactly one `.cir`, `.sp`, or `.spi` entry. If a directory contains one
`circuit.spi`, it is preferred. Include every local `.inc` or `.lib` file used
by the entry.

## A crossing is not connected

This is intentional. Add a Junction dot at the connection. Never infer an
electrical join from geometry.

## A SPICE statement is reported as opaque

Opaque text is preserved exactly but is not editable circuit semantics yet.
Consult the compatibility matrix and keep the diagnostic when reporting a
missing vendor construct.

## Recovery copies

Safety copies live in this browser's IndexedDB and are never authoritative.
Use **File / Recover Local Work…** to browse them. A damaged latest copy
offers the previous generation; a copy from a newer Project schema cannot be
restored here but can still be downloaded. Deleting one copy never deletes
another Project's copy. If a warning says recovery cannot be saved (storage
full or unavailable), download the Project with the button in the warning. A
reload immediately after an edit may miss that very last edit — the copy
lands within a fraction of a second; reloading after that restores the
latest committed state.

## PNG or PDF export fails

Confirm that Canvas 2D and Blob downloads are permitted by the browser. SVG is
the canonical fallback and contains the same formal scene.

## The portable host does not start

Use Node 24 or newer and ensure port 4173 is free. The v0.1 host intentionally
does not accept a LAN address. Use `pnpm dev` for a different development port.

## Agent API requests fail

The static host does not enable the optional loopback Agent adapter. Start that
adapter explicitly, use a token of at least 32 characters, and send requests
only to its loopback JSON endpoint. The published editor currently exposes no
Agent connection controls; its browser relay is reserved for explicitly enabled
development and staging deployments.
