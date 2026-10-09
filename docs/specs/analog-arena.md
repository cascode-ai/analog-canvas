# AnalogArena

Status: `accepted`

Primary owner: `worker/render-and-grade.ts`

## Scope

The contracts between Analog Canvas and AnalogArena. Arena runs as its own
Worker and imports no Analog Canvas package, so what crosses between the two
Workers is only what this file states: the render-and-grade service.

## Render-and-grade service

Arena renders every Submission and checks its netlist against its Task
through Analog Canvas, never with a renderer or netlist tools of its own.
[`worker/render-and-grade.ts`](../../worker/render-and-grade.ts) implements it.

### Reachability

The service is the Analog Canvas Worker's named entrypoint
`RenderAndGradeService`, called over RPC. Only a Worker whose service binding
names that entrypoint reaches it:

```jsonc
{
  "binding": "CANVAS",
  "service": "interactive-circuit-maker",
  "entrypoint": "RenderAndGradeService",
}
```

No route of the Worker's public `fetch` serves it, on the custom domain or on
workers.dev, so it needs no credential: a binding can only be declared by a
Worker deployed to the same account.

### Request

`renderAndGrade({ projectText, taskNetlist })`:

- `projectText`: the Submission's Project file, as text.
- `taskNetlist`: the Task's netlist, SPICE or structural Spectre.

### Answer

Every call is answered, never thrown across the binding, and every answer
carries `rendererVersion`. A graded answer is:

| Field          | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `status`       | `"graded"`                                                                   |
| `svg`          | The Project's top Cell, drawn exactly as its Gallery preview                 |
| `netlist`      | The top Cell's structural SPICE export, or `null` when the export is blocked |
| `exportErrors` | Why `netlist` is `null`: the export's errors; empty when it is set           |
| `verdict`      | One of the three verdicts below                                              |

| `verdict`                                                 | When                                                |
| --------------------------------------------------------- | --------------------------------------------------- |
| `{ "equivalent": true }`                                  | The drawing's structure is the Task's               |
| `{ "equivalent": false, "reason": "…" }`                  | The structure was graded and is not the Task's      |
| `{ "equivalent": false, "blocked": true, "reason": "…" }` | The structure does not export, so it was not graded |

Equivalence is the #1524 grading the headless batch grading applies
(`gradeNetlists` in [`grade.ts`](../../apps/editor/src/headless/grade.ts),
whose header states its rules), with its defaults, except that source polarity
counts: names are ignored, rails keep their class, transistor bodies count
only when neither side leaves every body on its conventional rail, and an
independent source drawn the wrong way round is not the Task's, since the Task
netlist fixes its polarity and a drawn source marks it.

The verdict grades structure only; parameter values are #1524's separate
score. A drawing whose export is blocked only by missing parameter values,
such as a transistor without `w`, is graded on the structure the export would
print with them, and the missing values stay in `exportErrors`. The grading
fills each with a placeholder that no grade reads; that text is never handed
out, and `netlist` stays `null`. Any other export error (an undefined block,
a device without a model) leaves no structure to grade, and the verdict is
`blocked`, its reason listing the errors.

A `reason` is a sentence for the Owner's upload report, not a stable code.
`explainGrade` in [`grade.ts`](../../apps/editor/src/headless/grade.ts) writes
it from the grade and says only what the grading established: a search that
ran out of budget is inconclusive, not a difference.

### Errors

An input that cannot be graded, or a failure inside the service, is answered
with `{ "status": "error", "error", "message", "rendererVersion" }` and no
verdict:

| `error`                   | When                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `project-unreadable`      | `projectText` is not text, or fails the strict Project boundary ([trust boundary](community-gallery.md#trust-boundary)) |
| `task-netlist-unreadable` | `taskNetlist` is not text, or does not grade as equivalent to itself, as the batch grading requires of a reference      |
| `internal`                | The renderer, the export or the grading failed unexpectedly, such as on a formula the typesetter cannot set             |

The `message` says why, for the Owner; it is not stable. An unreadable Task
netlist is never turned into a verdict against the Submission.

### Renderer version

`rendererVersion` names the look of the Gallery preview renderer
(`PREVIEW_RENDERER_VERSION` in
[`gallery-requests.ts`](../../worker/gallery-requests.ts)). One version draws
an unchanged Project the same way. A change that alters what a preview draws
for an unchanged Project, in the renderer, the built-in symbols' artwork or
formula typesetting, bumps it in the same change. Arena compares it only for
equality: when it changes, Arena re-renders the Season's Submissions, and each
Battle records the version it showed.

[`gallery-requests.test.ts`](../../worker/gallery-requests.test.ts) records
the digest of each fixture's preview with the version, and fails when a
preview changes while the version stays. The fixtures are the visual-golden
Projects and formulas in both typographies; a look change none of them shows
still needs its bump by hand.

### Evidence

[`render-and-grade.test.ts`](../../worker/render-and-grade.test.ts) calls the
service as Arena does, over a service binding to the bundled Worker in the
Workers runtime, with the real renderer and grading.
