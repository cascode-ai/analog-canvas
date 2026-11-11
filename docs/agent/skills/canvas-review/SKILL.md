---
name: canvas-review
description: Open a local netlist or Canvas Project for review in Analog Canvas. Use for an explicit Canvas review request with a source path and an optional Cell and Web or image preference.
disable-model-invocation: true
---

Use the Analog Canvas MCP registered for the user's editor origin. Read
`analog-canvas://reference/quickstart?section=Connect` and
`analog-canvas://reference/mcp-tools?section=Start%20a%20review`.
Read linked sections only when their task branch applies; use the MCP
`section` selector with the exact heading title instead of the whole manual. Use their current tool
arguments, task rules and delivery receipts.

Take the source path, Cell and presentation from the request. If the source
is missing, ask for it. Default to Web when the user does not specify a
presentation. When the user only wants an image, show the exported image and
skip the Web hand-off. Follow the guide to open the task, import the source
and choose the drawing path.

When a trusted task answers `TRUSTED_TASK_LOCAL_ONLY`, tell the user what it
needed and take the quickstart's next step; do not retry the call in that
task.

Before reporting the drawing ready, read `review_delivery` and report its
source version, incomplete Cells, comparison status, differences and notes.
Return the Web location or requested image and any unresolved issues. Change
the source files, save or publish only at the user's request.
