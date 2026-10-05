---
name: ac-pr
description: Write an evidence-backed Analog Canvas PR description and publish it when authorized. Use for completed changes or review drafts; preserve branch-trial scope and the existing mainline delivery route.
license: MIT
metadata:
  upstream: mattpocock/skills
  revision: 4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d
  source: skills/engineering/pr/SKILL.md
  visual-source: humanlayer/skills
  visual-revision: ca7c8088db69e315a8b2deea43820270457f8f3c
---

# Explain a pull request

Read [the workflow](../../../docs/development-workflow.md), AGENTS.md and the
applicable delivery contract. Inspect the actual final diff, target commits, owning
Issue and validation evidence. Branch-only trial scope ends at committed handoff
unless the human requests a draft PR or delivery. A PR-body draft never authorizes
publishing; an authorized delivery follows the existing route without redundant
permission questions. Attach every created PR to the current task when supported.

Inspect the baseline before claiming that prior practice lacked a rule or entry;
added files alone do not establish that absence. When live Issue access is
unavailable, use a supplied snapshot with its number, URL and provenance. Attribute
supplied check results and distinguish them from checks observed in this run.

Use a concise description with these useful elements, omitting empty boilerplate:

- Problem and resulting behavior: explain the concrete trigger and before/after.
  Choose the smallest screenshot, diff sketch, call tree or diagram that clarifies
  a complex change; simple changes need only prose.
- Evidence: name relevant passing checks and observed behavior. Separate local,
  merge-queue and Production evidence; show failures and repairs when material.
  State unavailable simulation, runtime or private-data qualification. Do not claim
  readiness from a successful push or PR-only skipped required checks.
- Merge impact: affected consumers, cheap or difficult rollback, and known limits.
- Owning Issue, independent review/dispositions and Test-Impact records. Preserve
  per-target intent and validation in the squash description for a batch.

Prefer plain domain language and precise claims. Do not invent screenshots, tests,
results or guarantees. Rewrite title/body around the final implementation. Keep
one-off reports in the PR or ignored plan/, not in current product documentation.

Use a structured tool argument or a body file for multiline text. Verify repository
and base branch before publishing. Follow existing required gates and inspect queue
failures through repair and requeue when delivery is authorized. Report trial branch,
draft PR, queued candidate, merged change and verified Production as distinct states.
