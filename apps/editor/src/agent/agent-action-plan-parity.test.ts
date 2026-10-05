import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import {
  AgentSessionClient,
  type ApplyActionsReport,
} from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

/** IDs made in order, so the client and the editor make the same ones. */
function counter() {
  let next = 0;
  return (prefix: string) => `${prefix}-${++next}`;
}

/**
 * One editor, reached by a client that either compiles each action list
 * itself, as before, or sends it for the editor to plan.
 */
async function editor(planActionsLocally: boolean) {
  const project = createEmptyProject("project-1", "Plan parity");
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(controller),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      semanticControl: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
    allocateId: counter(),
  });
  const http = new FakeAgentHttp();
  http.circuitHandler = async ({ request }) => service.handle(request);
  const client = new AgentSessionClient({
    http,
    planActionsLocally,
    allocateId: counter(),
  });
  await client.connect("session-1.code");
  return { controller, client, http };
}

/** A report without the request's own identity. */
function comparable({ requestId: _requestId, ...report }: ApplyActionsReport) {
  return report;
}

/** The same lists through both clients: the same report and Project. */
async function pair() {
  const local = await editor(true);
  const planned = await editor(false);
  async function same(actions: unknown[]) {
    const expected = await local.client.applyActions(actions);
    const report = await planned.client.applyActions(actions);
    expect(comparable(report)).toEqual(comparable(expected));
    expect(planned.controller.project).toEqual(local.controller.project);
    return report;
  }
  return { local, planned, same };
}

const place = (
  symbol: string,
  reference: string,
  x: number,
  parameters?: Record<string, string>,
) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
  ...(parameters ? { parameters } : {}),
});
const pin = (instance: string, name: string) => ({
  kind: "pin",
  instance,
  pin: name,
});

describe("an action list planned by the editor matches the client's own plan", () => {
  it("places, wires, edits, labels, moves, deletes and steps history alike", async () => {
    const { local, planned, same } = await pair();
    const steps: unknown[][] = [
      [
        place("resistor", "R1", 100, { value: "1k" }),
        place("resistor", "R2", 300),
        place("nmos", "M1", 500),
      ],
      [{ kind: "connect", from: pin("R1", "2"), to: pin("R2", "1") }],
      [
        { kind: "connect", from: pin("R2", "2"), to: pin("M1", "D") },
        { kind: "connect", from: pin("M1", "S"), to: pin("R1", "1") },
      ],
      [
        {
          kind: "set-reference",
          target: { kind: "instance", reference: "R1" },
          reference: "R9",
        },
        {
          kind: "set-property",
          target: { kind: "instance", reference: "R2" },
          set: { value: "2k" },
        },
        {
          kind: "rotate",
          target: { kind: "instance", reference: "R2" },
          rotation: 90,
        },
      ],
      [{ kind: "add-label", target: pin("R2", "1"), text: "MID" }],
      [{ kind: "annotate", text: "Bias", position: { x: 100, y: 400 } }],
      [
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          position: { x: 700, y: 100 },
        },
      ],
      [{ kind: "delete", target: { kind: "instance", reference: "R9" } }],
      [{ kind: "undo" }],
      [{ kind: "redo" }],
    ];
    for (const actions of steps) {
      const report = await same(actions);
      expect(report.ok, report.message).toBe(true);
    }
    // The editor reads the Document itself: past the first call's revision
    // bootstrap, the client never asks for it.
    const reads = (http: FakeAgentHttp) =>
      http.circuitCalls.filter(
        ({ request }) =>
          request.operation === "snapshot" &&
          request.projection !== "bootstrap",
      ).length;
    expect(reads(local.http)).toBeGreaterThan(0);
    expect(reads(planned.http)).toBe(0);
  });

  it("refuses the same lists in the same words, naming the same action", async () => {
    const { same } = await pair();
    await same([place("resistor", "R1", 100), place("resistor", "R2", 300)]);
    const refusals: [unknown[], Partial<ApplyActionsReport>][] = [
      [
        [{ kind: "explode" }],
        { code: "ACTION_COMPILE_FAILED", actionIndex: 0, actionKind: "schema" },
      ],
      [
        [
          {
            kind: "set-property",
            target: { kind: "instance", reference: "R404" },
            set: { value: "1k" },
          },
        ],
        { code: "ACTION_COMPILE_FAILED", actionIndex: 0 },
      ],
      [
        [
          place("resistor", "R3", 500),
          {
            kind: "set-property",
            target: { kind: "instance", reference: "R1" },
            set: { value: "3k" },
          },
        ],
        { code: "ACTION_BATCH_NOT_ATOMIC" },
      ],
      [
        [place("resistor", "R4", 700), place("resistor", "R5", 755)],
        { stage: "commit", actionIndex: 1, actionKind: "place-component" },
      ],
      [
        [{ kind: "focus", intent: { kind: "fit-document" } }],
        { stage: "commit", code: "PERMISSION_DENIED" },
      ],
    ];
    for (const [actions, expected] of refusals) {
      const report = await same(actions);
      expect(report).toMatchObject({ ok: false, ...expected });
    }
  });

  it("plans on the Document as a person left it, yet refuses a stale undo", async () => {
    const { local, planned, same } = await pair();
    await same([place("resistor", "R1", 100), place("resistor", "R2", 300)]);
    // A person marks a pin of R2 in both editors after the Agent's call.
    const personMarks = (id: string, pinName: string) => {
      for (const { controller } of [local, planned]) {
        const instance = controller.document.instances.find(
          (item) => item.reference === "R2",
        )!;
        expect(
          controller.transact([
            {
              kind: "add_no_connect",
              noConnect: {
                id,
                endpoint: {
                  kind: "terminal",
                  instanceId: instance.id,
                  pinName,
                },
              },
            },
          ]).ok,
        ).toBe(true);
      }
    };
    personMarks("nc-1", "1");
    // The client read the Document again before compiling this list.
    const changed = await same([
      {
        kind: "set-property",
        target: { kind: "instance", reference: "R1" },
        set: { value: "5k" },
      },
    ]);
    expect(changed.ok, changed.message).toBe(true);
    personMarks("nc-2", "2");
    // An undo goes as it is, against the revision the Agent last saw.
    expect(await same([{ kind: "undo" }])).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
    });
  });

  it("leaves the Document alone for a list that changes nothing", async () => {
    const { local, planned, same } = await pair();
    await same([place("resistor", "R1", 100)]);
    const position =
      local.controller.document.instances[0]!.placement!.position;
    const unmoved = [
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position,
      },
    ];
    const revision = planned.controller.document.revision;
    const expected = await local.client.applyActions(unmoved);
    const report = await planned.client.applyActions(unmoved);
    // The editor answers like a command with nothing left to do: one
    // request that applied nothing, where the client sent none.
    for (const item of [expected, report])
      expect(item).toMatchObject({
        ok: true,
        applied: false,
        revision,
        changedObjectIds: [],
        editKinds: [],
      });
    expect(planned.controller.project).toEqual(local.controller.project);
  });
});
