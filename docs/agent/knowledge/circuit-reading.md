# Reading an unfamiliar circuit

Use the complete selected-Document Snapshot when interpreting unfamiliar
topology or planning broad changes. Separate electrical facts from functional
hypotheses and drawing choices.

Read `Document.netlist.terminals`, Project references and source binding for
boundaries; then device model/parameters and the full pin-to-Net mapping. Use
explicit `powerDomain`, `mosBulk` and model facts for supply/body semantics.
Names and artwork are hints, not replacements for these fields.

Trace shared controls, source/emitter nodes, stacks and feedback. Before using a
matched-pair or mirror expression, check differing loads, parameters, body
connections and control domains. For an unresolved device, stop that semantic
inference until its pin/model facts are available; unrelated understood regions
can still be reviewed.

Keep cross-region Nets while focusing on one signal path, bias spine or repeated
branch group. Do not turn a reading partition into a new Cell or flatten a
shared definition unless the task calls for that structural change.
