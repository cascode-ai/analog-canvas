// The PowerPoint add-in's task pane. It opens the hosted editor as an Office
// dialog (`/editor?office=dialog`) and places what the editor sends on the
// slide: the drawing as an SVG picture, the editable Project in the
// picture's tags. The message protocol is apps/editor/src/app/office-messages.ts.
"use strict";

const FORMAT = "analog-canvas-office-v1";
const CHUNK_CHARACTERS = 30000;
const TAG_CHARACTERS = 30000;
/** A new picture's share of the slide. */
const NEW_PICTURE_SHARE = 0.7;

/**
 * Circuits to start from: Gallery entries saved as Project files in
 * `examples/` beside this page, as [file, name]. A test opens each one.
 */
const EXAMPLES = [
  ["strongarm-latch.icproj.json", "StrongArm v2"],
  ["five-transistor-ota.icproj.json", "5T-OTA"],
  [
    "push-pull-source-follower.icproj.json",
    "Push-pull source follower with cascode",
  ],
  ["cascode-lna.icproj.json", "Cascode LNA"],
];

let dialog = null;
/** The picture this dialog's drawing lives in: { slideId, shapeId }. */
let placed = null;
/** The last placement this pane made, kept in its status line. */
let lastPlaced = "";

const $ = (id) => document.getElementById(id);
function status(text, failed) {
  $("status").textContent = text;
  if (failed) $("status").setAttribute("data-failed", "");
  else $("status").removeAttribute("data-failed");
}

function sendChunked(post, message) {
  const text = JSON.stringify(message);
  const id = crypto.randomUUID();
  const n = Math.max(1, Math.ceil(text.length / CHUNK_CHARACTERS));
  for (let i = 0; i < n; i++)
    post(
      JSON.stringify({
        ac: 1,
        id,
        i,
        n,
        data: text.slice(i * CHUNK_CHARACTERS, (i + 1) * CHUNK_CHARACTERS),
      }),
    );
}
function createChunkReceiver(receive) {
  const pending = new Map();
  return (text) => {
    let chunk;
    try {
      chunk = JSON.parse(text);
    } catch {
      return;
    }
    if (chunk.ac !== 1) return;
    const parts = pending.get(chunk.id) || new Array(chunk.n);
    parts[chunk.i] = chunk.data;
    pending.set(chunk.id, parts);
    if (parts.filter((part) => part !== undefined).length < chunk.n) return;
    pending.delete(chunk.id);
    receive(JSON.parse(parts.join("")));
  };
}

/** The selected Analog Canvas picture, read back from its tags. */
async function selectedCircuit() {
  return PowerPoint.run(async (context) => {
    const shapes = context.presentation.getSelectedShapes();
    const slides = context.presentation.getSelectedSlides();
    shapes.load("items/id");
    slides.load("items/id");
    await context.sync();
    if (shapes.items.length !== 1)
      return { problem: "Select one circuit picture first." };
    const shape = shapes.items[0];
    shape.tags.load("items/key,items/value");
    await context.sync();
    const tags = {};
    for (const tag of shape.tags.items) tags[tag.key.toUpperCase()] = tag.value;
    if (tags.AC_FORMAT !== FORMAT)
      return { problem: "The selected shape is not an Analog Canvas circuit." };
    const count = Number(tags.AC_PROJECT_N);
    let project = "";
    for (let i = 0; i < count; i++) project += tags["AC_PROJECT_" + i] || "";
    return {
      project,
      documentId: tags.AC_DOCUMENT,
      name: tags.AC_NAME,
      slideId: slides.items[0] && slides.items[0].id,
      shapeId: shape.id,
    };
  });
}

function insertSvg(svg) {
  return new Promise((resolve, reject) => {
    Office.context.document.setSelectedDataAsync(
      svg,
      { coercionType: Office.CoercionType.XmlSvg },
      (result) =>
        result.status === Office.AsyncResultStatus.Succeeded
          ? resolve()
          : reject(new Error(result.error.message)),
    );
  });
}

/**
 * Put the drawing on the slide: a new picture, tagged with the Project, then
 * the old one removed, so a failure never loses what the slide had. A new
 * drawing takes most of the slide, centred; an edited one keeps its place
 * and width, its height following the drawing, inside the slide.
 */
async function place(message) {
  await PowerPoint.run(async (context) => {
    let slideId = placed && placed.slideId;
    if (!slideId) {
      const slides = context.presentation.getSelectedSlides();
      slides.load("items/id");
      await context.sync();
      if (!slides.items.length) throw new Error("Select a slide first.");
      slideId = slides.items[0].id;
    }
    const slide = context.presentation.slides.getItem(slideId);
    const old = placed
      ? slide.shapes.getItemOrNullObject(placed.shapeId)
      : null;
    if (old) old.load("left,top,width");
    const before = slide.shapes;
    before.load("items/id");
    context.presentation.setSelectedSlides([slideId]);
    await context.sync();
    const known = new Set(before.items.map((shape) => shape.id));
    // PowerPoint centres a picture inserted at its drawn size, which gives
    // the slide's size too.
    await insertSvg(message.svg);
    const after = slide.shapes;
    after.load("items/id");
    await context.sync();
    const added = after.items.find((shape) => !known.has(shape.id));
    if (!added) throw new Error("PowerPoint did not report the new picture.");
    added.load("left,top,width,height");
    await context.sync();
    const slideWidth = 2 * added.left + added.width;
    const slideHeight = 2 * added.top + added.height;
    const aspect = added.height / added.width;
    let left, top, width;
    if (old && !old.isNullObject) {
      left = old.left;
      top = old.top;
      width = Math.min(old.width, (slideHeight - top) / aspect);
    } else {
      width = Math.min(
        NEW_PICTURE_SHARE * slideWidth,
        (NEW_PICTURE_SHARE * slideHeight) / aspect,
      );
      left = (slideWidth - width) / 2;
      top = (slideHeight - width * aspect) / 2;
    }
    added.left = left;
    added.top = top;
    added.width = width;
    added.height = width * aspect;
    const chunks = [];
    for (let i = 0; i < message.project.length; i += TAG_CHARACTERS)
      chunks.push(message.project.slice(i, i + TAG_CHARACTERS));
    added.tags.add("AC_FORMAT", FORMAT);
    added.tags.add("AC_NAME", message.name);
    added.tags.add("AC_DOCUMENT", message.documentId);
    added.tags.add("AC_PROJECT_N", String(chunks.length));
    chunks.forEach((chunk, i) => added.tags.add("AC_PROJECT_" + i, chunk));
    added.name = "Analog Canvas: " + message.name;
    if (old && !old.isNullObject) old.delete();
    await context.sync();
    placed = { slideId, shapeId: added.id };
  });
  autoShowWithDocument();
}

/**
 * A presentation holding a circuit opens this pane by itself the next time
 * it is opened in a PowerPoint that has the add-in, so its circuits are one
 * click from editing.
 */
function autoShowWithDocument() {
  const settings = Office.context.document.settings;
  if (settings.get("Office.AutoShowTaskpaneWithDocument") === true) return;
  settings.set("Office.AutoShowTaskpaneWithDocument", true);
  settings.saveAsync();
}

/**
 * Open the editor dialog with `opening`: a slide picture's drawing
 * ({ project, documentId, name, slideId, shapeId }), an example
 * ({ project, name }), or nothing for a new drawing.
 */
function openEditor(opening) {
  if (dialog) {
    status("The editor is already open.", true);
    return;
  }
  lastPlaced = "";
  placed =
    opening && opening.shapeId
      ? { slideId: opening.slideId, shapeId: opening.shapeId }
      : null;
  Office.context.ui.displayDialogAsync(
    location.origin + "/editor?office=dialog",
    { height: 85, width: 85, displayInIframe: false },
    (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        status("Could not open the editor: " + result.error.message, true);
        return;
      }
      dialog = result.value;
      let answered = false;
      status(
        "Editing in the Analog Canvas window. Click PowerPoint in its header to place the drawing.",
      );
      const reply = (message) =>
        sendChunked((text) => dialog.messageChild(text), message);
      const receive = createChunkReceiver(async (message) => {
        if (message.type === "ready") {
          // A page change in the editor asks again: keep what it shows.
          if (answered) {
            reply({ type: "open", attach: true });
            return;
          }
          answered = true;
          reply({ type: "open", ...(opening || {}) });
        } else if (message.type === "save") {
          try {
            await place(message);
            reply({ type: "ack", requestId: message.requestId, ok: true });
            lastPlaced =
              "Placed “" +
              message.name +
              "” at " +
              new Date().toLocaleTimeString() +
              ".";
            status(lastPlaced);
          } catch (error) {
            const text = (error && error.message) || String(error);
            reply({
              type: "ack",
              requestId: message.requestId,
              ok: false,
              error: text,
            });
            status("Could not place the drawing: " + text, true);
          }
        }
      });
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (event) =>
        receive(event.message),
      );
      dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
        dialog = null;
        status((lastPlaced ? lastPlaced + "\n" : "") + "The editor closed.");
      });
    },
  );
}

/** An example opens as a new drawing, not yet on any slide. */
async function openExample(file, name) {
  try {
    const response = await fetch("examples/" + file);
    if (!response.ok) throw new Error("HTTP " + response.status);
    openEditor({ project: await response.text(), name });
  } catch (error) {
    status(
      "Could not load the example: " + ((error && error.message) || error),
      true,
    );
  }
}

/** The Edit button names the selected circuit, or asks for one. */
async function showSelection() {
  let name = null;
  try {
    name = await PowerPoint.run(async (context) => {
      const shapes = context.presentation.getSelectedShapes();
      shapes.load("items/id");
      await context.sync();
      if (shapes.items.length !== 1) return null;
      const format = shapes.items[0].tags.getItemOrNullObject("AC_FORMAT");
      const label = shapes.items[0].tags.getItemOrNullObject("AC_NAME");
      format.load("value");
      label.load("value");
      await context.sync();
      return !format.isNullObject && format.value === FORMAT
        ? label.isNullObject
          ? "circuit"
          : label.value
        : null;
    });
  } catch {
    name = null;
  }
  const edit = $("edit");
  edit.textContent = name ? "Edit “" + name + "”" : "Edit selected circuit";
  edit.classList.toggle("primary", Boolean(name));
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.PowerPoint) {
    status("Open this add-in in PowerPoint.", true);
    return;
  }
  const missing = [
    "PowerPointApi 1.5",
    "DialogApi 1.2",
    "ImageCoercion 1.2",
  ].filter((set) => {
    const [name, version] = set.split(" ");
    return !Office.context.requirements.isSetSupported(name, version);
  });
  if (missing.length) {
    status("This PowerPoint lacks " + missing.join(", ") + ".", true);
    return;
  }
  for (const [file, name] of EXAMPLES) {
    const button = document.createElement("button");
    button.textContent = name;
    button.onclick = () => void openExample(file, name);
    $("examples").append(button);
  }
  $("examples").hidden = EXAMPLES.length === 0;
  for (const button of document.querySelectorAll("button"))
    button.disabled = false;
  status("Ready. To edit a circuit, select its picture on the slide.");
  $("new").onclick = () => openEditor(null);
  $("edit").onclick = async () => {
    try {
      const circuit = await selectedCircuit();
      if (circuit.problem) status(circuit.problem, true);
      else openEditor(circuit);
    } catch (error) {
      status((error && error.message) || String(error), true);
    }
  };
  // PowerPoint keeps double-click for its own picture tools; the pane names
  // the selected circuit and offers to edit it instead.
  Office.context.document.addHandlerAsync(
    Office.EventType.DocumentSelectionChanged,
    () => void showSelection(),
  );
  void showSelection();
});
