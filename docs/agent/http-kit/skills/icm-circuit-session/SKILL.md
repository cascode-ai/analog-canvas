# Raw HTTP task navigator

Use for an explicit HTTP request or an authorized bootstrap fallback in the
copied handoff. Follow the [connection rules](../../../shared/session.md#connection);
an older handoff without that authorization still requires the user's choice.

1. [API usage](../../../api-usage.md) covers claim/resume, endpoints, revision
   guards and exact retries; the origin's `/api/agent/openapi.json` gives
   schemas.
2. Circuit work: [task workflow](../../../workflow.md) and
   [native authoring](../../../shared/authoring.md). Read fresh pins before
   wiring a new instance; visual text is not a Net label.
3. Simulation: API usage and the
   [shared simulation lifecycle](../../../shared/simulation.md).
4. The Kit README's task map lists knowledge and recovery cards; read only
   what the task needs.

The caller owns secure credential storage, bounded retries and verified
downloads. MCP action names and wrappers are not raw HTTP schemas.
