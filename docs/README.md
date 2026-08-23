# Project Documentation

This directory separates current product and user documentation from durable
contracts, delivery planning, and explicitly non-authoritative history.

## Documentation map

| Area                                                 | Purpose                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [`user/`](user/getting-started.md)                   | Install, edit, save, compatibility, and troubleshooting guidance            |
| [`overall-product-plan.md`](overall-product-plan.md) | Current product boundary, system shape, and source-of-truth map             |
| [`current/`](current/README.md)                      | Default reading set for contributors and Agent-assisted product work        |
| [`specs/`](specs/README.md)                          | Normative data, API, parser, rendering, persistence, and export contracts   |
| [`adr/`](adr/README.md)                              | Accepted architectural decisions and their consequences                     |
| [`agent/`](agent/README.md)                          | Agent workflow, API usage, response interpretation, and on-demand knowledge |
| [`roadmap/`](roadmap/README.md)                      | Remaining cross-module work and its acceptance boundaries                   |
| [`release/`](release/v0.1-checklist.md)              | Release checklist and known accessibility limits                            |
| [`experience/`](experience/README.md)                | Human-requested, evidence-backed reusable lessons                           |
| [`testing/`](testing/README.md)                       | Test layers, change-impact discipline, and contract ownership matrix        |
| [`archive/`](archive/README.md)                      | Historical records; excluded from default task context                      |

## Authority order

When documents disagree, resolve the conflict explicitly rather than silently
choosing one:

```text
accepted ADR or approved normative spec
→ current overall product plan
→ current roadmap phase
→ implementation and tests
```

Implementation and tests are evidence, but they do not silently redefine an
approved contract. Update the relevant spec or ADR when behavior intentionally
changes. Archived documents cannot override an accepted ADR, active spec, or
current product plan.

## Start in the right place

- To use the product: [getting started](user/getting-started.md).
- To contribute product work: [current reading set](current/README.md).
- To connect an Agent: [Agent workflow](agent/workflow.md).
- To understand an approved interface: [specifications](specs/README.md) and
  the related [ADR](adr/README.md).
- To review unfinished cross-module work: [roadmap](roadmap/README.md).

## Planning flow

```text
overall architecture
→ roadmap phase
→ normative specs / ADRs
→ implementation and focused validation
→ a commit that states its intent, validation, and test impact
```

Roadmap files describe product delivery. A commit describes one specific
execution target and the paths it owned.
