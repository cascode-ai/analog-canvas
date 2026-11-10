---
name: canvas-review
description: Open a local netlist or Canvas Project for review in Analog Canvas. Use for an explicit Canvas review request with a source path and an optional Cell and Web or image preference.
---

Use the Analog Canvas MCP registered for the user's editor origin. Read
`analog-canvas://reference/quickstart` and the **From a netlist to a review**
section of `analog-canvas://reference/mcp-tools`. Use their current tool
arguments, task rules and delivery receipts.

Take the source path, Cell and presentation from the request. If the source
is missing, ask for it. Default to Web when the user does not specify a
presentation. When the user only wants an image, show the exported image and
skip the Web hand-off. Follow the guide to open the task, import the source
and choose the drawing path.

A task opened from a trusted device reads and edits local review copies only.
When a call answers `TRUSTED_TASK_LOCAL_ONLY`, tell the user what it needed.
Let them do it in Canvas or, if they agree, open a separate task with
`open_canvas({approval:"once"})`, which they approve in the browser. Do not
retry the refused call in the trusted task.

Before reporting the drawing ready, read `review_delivery`. Name the source
version, any Cell it lists as incomplete, and the comparison's status with
its differences and notes. Return the Web location or requested image and
any unresolved issues. A comment the user copies from Canvas names the Cell,
the object's name and ID, and its netlist line when known. Change the source
files, save or publish only at the user's request.
