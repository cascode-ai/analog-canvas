---
name: ac-grill-with-docs
description: Clarify ambiguous Analog Canvas development requirements and domain decisions before implementation. Use for consequential design questions, not routine changes whose scope and acceptance are already agreed.
license: MIT
metadata:
  upstream: mattpocock/skills
  revision: 4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d
  sources: grill-with-docs, grilling, domain-modeling
---

# Clarify requirements

Read [the workflow](../../../docs/development-workflow.md), AGENTS.md and the
relevant existing specs/ADRs. Work in the user's language and preserve decisions
already made. The interview and domain-modeling primitives below are self-contained.

Find discoverable facts yourself. Read code/tests when a factual answer is available;
delegate bounded fact finding only when appropriate. Ask the human to decide product
behavior, meaningful trade-offs and ownership, not to locate facts you can inspect.

Identify consequential unresolved decisions and their prerequisites. Ask the ready
questions together, each with a recommended answer and concrete consequence. Wait
for answers before advancing dependent decisions; continue independent investigation.
Use a failing or edge-case scenario to clarify a term or boundary. Skip questions
already resolved by the conversation or an accepted contract.

Use existing domain terms such as Cell, Cell Pin, Instance Terminal, physical Net,
Cloud Project and Gallery publication. Check their owning spec when meaning matters.
When a term conflicts with code or a contract, show the difference and seek a decision;
do not silently change accepted electrical meaning. Refine existing topic definitions
instead of starting a second glossary. Add an ADR only for a consequential trade-off
whose reason cannot live beside the owning rule, following docs/adr/README.md.

Summarize problem, acceptance, scope, decisions and genuine unresolved questions in
the owning Issue or an authorized draft. Distinguish proposals from agreed decisions.
The stage is complete when significant choices and acceptance are settled. Reuse
explicit prior agreement; if material decisions remain unconfirmed, ask for that
confirmation before dependent implementation. Do not start implementation or create
permanent documents solely because the interview ended. Publication follows the
workflow's authorization boundary and the user's current request.
