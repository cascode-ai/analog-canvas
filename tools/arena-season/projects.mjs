// The two Project sets the Season tool draws itself (#1560): the Grid
// Baseline from the Task netlist alone, and the Check Battle copy from the
// Human Reference. Both are drawn through the editor's own Agent host, as an
// Agent would draw them, so they are ordinary Projects in every respect.
import {
  createLocalEditor,
  exportNetlist,
  gradeNetlists,
  importSpiceSources,
  seededRandom,
  withImportedInstanceDisplays,
  withSeededIds,
} from "./editor.mjs";

/** How far a Grid Baseline's stub reaches out of its pin: two grid steps. */
const STUB_LENGTH = 20;
/**
 * Actions per call. A transaction holds at most 64 edits, and a wire takes
 * two; a pins snapshot reads at most 64 instances.
 */
const ACTIONS_PER_CALL = 32;
const SNAPSHOT_INSTANCES = 64;

function transact(editor, actions, tag) {
  const document = editor.controller.document;
  const answer = editor.circuit({
    apiVersion: "3.0",
    requestId: tag,
    operation: "transact",
    documentId: document.id,
    transactionId: tag,
    expectedRevision: document.revision,
    dryRun: false,
    actions,
  });
  return answer.ok ? null : (answer.error?.message ?? "refused");
}

/**
 * The Grid Baseline for a Task: the editor's structural SPICE import of the
 * Task netlist, which sets the devices on a grid with each Cell Pin beside
 * them, and then a short stub on every drawn device pin carrying a Net Label
 * that names the pin's Net. Nothing else joins the devices.
 *
 * @param {string} taskId
 * @param {string} netlist
 */
export function drawGridBaseline(taskId, netlist) {
  return withSeededIds(`grid-baseline:${taskId}`, async () => {
    const path = `${taskId}.sp`;
    const imported = await importSpiceSources(
      [{ path, bytes: new TextEncoder().encode(netlist) }],
      path,
    );
    if (!imported.successful || !imported.project)
      throw new Error(
        `The structural SPICE import failed: ${
          imported.diagnostics.find((item) => item.severity === "error")
            ?.message ?? "no Project"
        }`,
      );
    const project = withImportedInstanceDisplays(imported.project);
    const document = project.documents.find(
      (candidate) => candidate.id === project.topDocumentId,
    );
    const names = new Map(
      document.importReference.nets.map((net) => [net.id, net.name]),
    );
    const netOfPin = new Map();
    for (const net of document.nets)
      for (const terminal of net.terminals)
        netOfPin.set(`${terminal.instanceId}\u0000${terminal.pinName}`, net.id);
    const editor = createLocalEditor({ project });
    const devices = document.instances
      .filter((instance) => instance.symbolId !== "port")
      .map((instance) => instance.id);
    const wires = [];
    const labels = [];
    for (let start = 0; start < devices.length; start += SNAPSHOT_INSTANCES) {
      const snapshot = editor.circuit({
        apiVersion: "3.0",
        requestId: `pins-${start}`,
        operation: "snapshot",
        documentId: document.id,
        projection: "pins",
        instanceIds: devices.slice(start, start + SNAPSHOT_INSTANCES),
      });
      if (!snapshot.ok)
        throw new Error(
          `The pins could not be read: ${snapshot.error.message}`,
        );
      for (const instance of snapshot.instances) {
        for (const pin of instance.pins) {
          const netId = netOfPin.get(`${instance.id}\u0000${pin.name}`);
          // Hidden pins (a body tied by the Cell's default) stay undrawn.
          if (pin.visibility !== "visible" || !pin.connection || !netId)
            continue;
          const { gridLanding, outward } = pin.connection;
          const ref = {
            kind: "pin",
            instance: { kind: "instance", id: instance.id },
            pin: pin.name,
          };
          wires.push({
            kind: "connect",
            from: ref,
            to: {
              kind: "point",
              x: gridLanding.x + (outward?.x ?? 0) * STUB_LENGTH,
              y: gridLanding.y + (outward?.y ?? 0) * STUB_LENGTH,
            },
          });
          labels.push({
            kind: "add-label",
            target: ref,
            text: names.get(netId),
          });
        }
      }
    }
    let call = 0;
    for (const batch of [wires, labels])
      for (let start = 0; start < batch.length; start += ACTIONS_PER_CALL) {
        const refused = transact(
          editor,
          batch.slice(start, start + ACTIONS_PER_CALL),
          `grid-${(call += 1)}`,
        );
        if (refused)
          throw new Error(`The editor refused a labelled stub: ${refused}`);
      }
    return editor.project;
  });
}

/** Places a Check copy tries for one part before leaving it where it is. */
const SCRAMBLE_ATTEMPTS = 4;

/**
 * The Check Battle copy of a Human Reference: the same drawing with its
 * parts scattered by a generator seeded from `seed`. Each part, in drawing
 * order, is offered a shuffled partner's place, then random places over an
 * area half again as large as the drawing, all on its grid. The editor
 * moves it with its wires following, and a place is kept only when the
 * editor accepts it and the netlist stays equivalent to the Task's under
 * the #1524 rules; a part no place suits stays where it was. Returns the
 * Project and how many parts moved.
 *
 * @param {string} seed
 * @param {import("@icm/model").CircuitProject} reference
 * @param {string} taskNetlist
 */
export function drawCheckCopy(seed, reference, taskNetlist) {
  return withSeededIds(`check-copy:${seed}`, async () => {
    let editor = createLocalEditor({ project: reference });
    const document = editor.controller.document;
    const grid = document.presentation?.grid ?? 10;
    const parts = document.instances
      .filter((instance) => instance.placement)
      .map((instance) => ({
        id: instance.id,
        position: instance.placement.position,
      }));
    const random = seededRandom(`check-copy:${seed}`);
    const order = parts.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    const xs = parts.map((part) => part.position.x);
    const ys = parts.map((part) => part.position.y);
    const span = (values) =>
      Math.max(Math.max(...values) - Math.min(...values), 20 * grid);
    const [width, height] = [span(xs), span(ys)];
    const snap = (value) => Math.round(value / grid) * grid;
    const scatter = () => ({
      x: snap(Math.min(...xs) - width / 4 + random() * width * 1.5),
      y: snap(Math.min(...ys) - height / 4 + random() * height * 1.5),
    });
    let moved = 0;
    for (const [index, part] of parts.entries()) {
      const places = [parts[order[index]].position];
      while (places.length < SCRAMBLE_ATTEMPTS) places.push(scatter());
      for (const [attempt, place] of places.entries()) {
        if (place.x === part.position.x && place.y === part.position.y)
          continue;
        const before = editor.project;
        const refused = transact(
          editor,
          [
            {
              kind: "move",
              target: { kind: "instance", id: part.id },
              position: { x: place.x, y: place.y },
            },
          ],
          `scramble-${index}-${attempt}`,
        );
        if (refused) continue;
        const netlist = exportNetlist(editor.project).text;
        const same =
          netlist !== null &&
          (await gradeNetlists(netlist, taskNetlist, { sourcePolarity: true }))
            .exact;
        if (same) {
          moved += 1;
          break;
        }
        editor = createLocalEditor({ project: before });
      }
    }
    return { project: editor.project, moved, parts: parts.length };
  });
}
