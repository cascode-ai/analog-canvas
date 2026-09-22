# Agent documentation: consumers and distribution

All hand-authored Agent operating guidance is maintained here. Different
transports share electrical and result-handoff rules, not their connection
procedures. The [registry](distribution.json) declares consumers, tasks,
dependencies and destinations. The generated [report](distribution.generated.json)
records source and output hashes; it is evidence, not another editable registry.

## Consumer × task × document

| Consumer | Task | Entry / required reading | On demand | Delivery |
| --- | --- | --- | --- | --- |
| Setup Agent | Install and verify callable MCP | [Connection message](entrypoints/connect.md), [installation](mcp-install.md) | Host manifest | Browser copied message |
| MCP circuit Agent | Inspect, author and render | [Quickstart](mcp-quickstart.md), [authoring](shared/authoring.md) | Workflow, recovery, knowledge | MCP resources and tool descriptions |
| MCP simulation Agent | Save, run, measure, hand off | [Quickstart](mcp-quickstart.md), [simulation calls](mcp/simulation.md) | [Detailed contracts](mcp/simulation-reference.md), [Specs](simulation-specs.md), [handoff](simulation-result-handoff.md); authoring only when editing circuits | MCP resources |
| Raw HTTP Agent / integrator | Claim, resume, request and retry | [Kit README](http-kit/README.md), [boundary](http-kit/AGENTS.md), [API lifecycle](api-usage.md), published OpenAPI | [Request examples](examples.md), common knowledge | `GET /api/agent/kit` |
| Shared-client CLI Agent / script | Invoke tools without MCP host | [CLI lifecycle](http-cli.md), authoring | `--http list-tools`, `--http resource` | Same package and operation registry as MCP |
| Repository circuit Agent | Read, place, route, review | [Skill source](repo-skill/SKILL.md), task-selected workflow | Generated reading map | `skills/circuit-layout/` |
| Product maintainer | Change, verify and release guidance | [Maintenance](maintenance.md), root working rules | Code contracts and release docs | Repository only |

MCP is the default. Configuration success is not proof of callable tools. If a
host cannot load the adapter, explain the failed stage and possible restart
once; do not restart it or silently switch protocols. Raw HTTP and CLI are
explicit user choices. CLI shares MCP's client but has per-process obligations;
raw HTTP requires the caller to implement lifecycle.

## Authority and coordination

- `distribution.json` is the only distribution registry. No channel is generated
  by reading another channel's generated bundle.
- Shared authoring, session, Specs and handoff are topic authorities. Channel
  guides map these rules to calls rather than redefining policy.
- Tool schemas, edit validation and symbol facts remain code-owned. The
  generator consumes the canonical catalog; prose cannot redefine pins.
- HTTP operation help comes from `http-kit/api-help.json` into OpenAPI;
  MCP selection help comes from `mcp/tool-help.json`. They describe different
  calling surfaces, not interchangeable envelopes.
- Reading load is `entry`, `required` or `on-demand`, never a permission gate.
- Knowledge cards are evidence aids, not automatic classifiers. Drawing review
  cannot establish electrical correctness without suitable simulation evidence.

Run `pnpm agent-docs:generate` after edits. `pnpm agent-docs:check` checks all
destinations without writing. See maintenance for validation and release scope.

## On-demand knowledge

Five cards remain: circuit reading, hierarchy, model/symbol binding, circuit
patterns and visible Net shapes. Shared workflow owns human collaboration;
shared diagnostics owns finding/repair policy; schematic style owns visual
preferences. The optional RouteGraph library reference is repository-only.
Runtime guides cannot link to an undistributed local document: generation fails
instead of silently sending an installed Agent to the repository's latest branch.
