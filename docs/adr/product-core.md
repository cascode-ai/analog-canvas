# Product Core

Status: `accepted`

Owners: `packages/model`, `packages/edit-engine`, `apps/editor`

## Decision

Use one in-process TypeScript model and transaction engine for human and Agent
edits. [Schematic model](../specs/schematic-model.md) owns Project facts;
[Edit Engine](../specs/edit-engine.md) owns mutation and history.

## Context

A collaborative editor needs one answer to what exists, which revision is
current and what undo restores. Renderer scenes and transport messages cannot
supply independent answers.

## Rationale

A second circuit service or editable scene would duplicate validation and
revision ownership. Documents directly represent reusable Cells; adding a Page
layer without a multi-page authoring concept would only add identity and query
nesting. Export bounds and the viewport do not require persisted pages.

The shared core is not a language restriction on every tool or executor.
Offline extraction and isolated simulation can use suitable runtimes behind
owned file/service contracts without becoming a second schematic authority.
