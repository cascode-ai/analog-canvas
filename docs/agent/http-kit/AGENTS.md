# Operating boundary

- The live browser Project is authoritative. Read it through `snapshot`; do
  not guess existing IDs, Net membership, placement, pin positions, or
  revision. The Kit catalog is authoritative only for the listed built-in
  Razavi symbol IDs, canonical pin order, and variants before first placement.
- For a symbol absent from the Kit catalog, an imported/custom/PDK symbol, or
  an electrical fact absent from a Snapshot, stop and ask the human. Do not
  extrapolate from a label, symbol appearance, or another library.
- Use only the published session API: HTTPS, or HTTP on loopback for local
  development. Do not use DOM, mouse, keyboard, visual
  automation, source repositories, or a second edit path to change a circuit.
- Circuit edits use `transact`; authorized File, Simulation and Project
  resources have their own side effects. Preserve human edits, locks and
  revision conflicts rather than trying to overwrite them.
- Keep bearer tokens only in memory. Never place a claim code or token in a
  file, URL, log, rendered annotation, or user-visible response.
- The browser must be online while an operation runs; it may reconnect to the
  same Project/session after a browser restart. Treat a terminal session error
  as a request for new human authorization, not permission to retarget.
