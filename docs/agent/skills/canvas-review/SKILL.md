---
name: canvas-review
description: Review a local netlist, pasted netlist or Canvas Project in Analog Canvas.
disable-model-invocation: true
---

Use the Analog Canvas MCP for the user's editor origin. For a dedicated task,
read `analog-canvas://reference/quickstart?section=Open%20a%20review%20task`.
For a supplied Claim or an older adapter without that section, read
`analog-canvas://reference/quickstart?section=Connect`. For the review, read
`analog-canvas://reference/mcp-tools?section=Start%20a%20review`.
Read linked sections by exact heading only when their branch applies.

Use the given source path or stage pasted netlist text in a scratch file.
Ask for a source if none was supplied. Draw plain netlists in Canvas and reuse
usable imported drawings. An existing RNL drawing is reviewed in Canvas.
Use the RNL Skill only for requested RNL output, edits, validation or
RNL-specific diagnosis.

For `TRUSTED_TASK_LOCAL_ONLY`, follow the quickstart's recovery branch without
retrying the call in that task.

Check the requested Cell's rendering and read `review_delivery` before
reporting the source version, incomplete Cells, comparison status, differences,
notes and unresolved issues. Default to Web. For image-only delivery, show
the image. Change source files, save or publish only at the user's request.
