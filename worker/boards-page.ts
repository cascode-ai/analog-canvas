// The selection board's page (docs/specs/selection-boards.md), served whole by
// worker/boards.ts at /boards. Everything it shows comes from /api/board and is set
// as text, never as markup.

const STYLE = String.raw`
/* The Gallery's tokens (apps/editor/src/styles.css); the Gallery has no dark theme, nor do these pages. */
:root {
  --chrome-bg: #f7f6f3; --surface: #ffffff; --surface-muted: #f1f1ef; --surface-hover: #ebebea;
  --border: #e9e9e7; --border-hover: #cfcfcd; --text: #37352f; --muted: #787774; --disabled: #b4b4b0;
  --accent: #2383e2; --accent-strong: #1b6ec2; --accent-soft: rgb(35 131 226 / 10%);
  --ai: #6a3cbf; --ai-soft: #efe7fb; --error: #eb5757; --warning: #9a6700; --warning-soft: #fdf3d7;
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --control-h: 28px; --menubar-h: 44px;
  --shadow-lg: 0 18px 48px rgb(15 15 15 / 12%);
  color-scheme: light;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--chrome-bg); color: var(--text); -webkit-font-smoothing: antialiased;
       font: 13px/1.35 ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, textarea, select { font: inherit; color: inherit; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: var(--control-h); padding: 0 10px;
         border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); font-size: 12px; font-weight: 500;
         white-space: nowrap; cursor: pointer; }
button:hover:not(:disabled) { background: var(--surface-hover); }
button.primary { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 600; }
button.primary:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); }
button:disabled { color: var(--disabled); cursor: default; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
input, textarea, select { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); padding: 6px 10px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
input::placeholder, textarea::placeholder { color: var(--disabled); }

/* The Gallery's header band: the brand, the soft-blue Editor link, the account at the right. */
.chrome { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px; height: var(--menubar-h); padding: 0 12px;
          border-bottom: 1px solid var(--border); background: var(--surface); }
.brand { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: inherit; }
.brand:hover { text-decoration: none; }
.brand:hover b { color: var(--accent); }
.brand-mark { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 6px; background: #fff url("/icon.svg?v=nmos-4") center / cover no-repeat; }
.brand b { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: var(--control-h); padding: 0 11px 0 9px; border-radius: 999px;
        color: var(--accent); background: var(--accent-soft); font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill:hover { color: #fff; background: var(--accent); text-decoration: none; }
.pill svg { width: 15px; height: 15px; }
.crumb { min-width: 0; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.who { display: flex; align-items: center; gap: 6px; min-width: 0; margin-left: auto; }
.who a { display: inline-flex; align-items: center; height: var(--control-h); padding: 0 10px; border: 1px solid var(--border);
         border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 12px; font-weight: 600; white-space: nowrap; }
.who a:hover { background: var(--surface-hover); text-decoration: none; }
.who a.account { max-width: 240px; overflow: hidden; font-size: 13px; }
.who a.account::before { content: attr(data-initial); display: inline-grid; place-items: center; flex: 0 0 20px; width: 20px; height: 20px;
                         margin-right: 7px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 700; }

/* The board: the map in the Gallery's sidebar at the left, the tiles beside it. */
.layout { display: flex; min-height: calc(100vh - var(--menubar-h)); }
.side-slot { flex: 0 0 220px; width: 220px; border-right: 1px solid var(--border); background: var(--surface); }
.side { position: sticky; top: var(--menubar-h); max-height: calc(100vh - var(--menubar-h)); overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: thin; padding: 20px 10px; }
.side-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 0 8px; margin-bottom: 4px; }
.side h2, .side h3 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.side-note { margin: 0 0 12px; padding: 0 8px; color: var(--muted); font-size: 12px; }
.clear { height: auto; padding: 2px 0; border: 0; background: transparent; color: var(--accent); font-size: 11px; }
.clear:hover:not(:disabled) { background: transparent; text-decoration: underline; }
.group { display: grid; gap: 2px; padding: 12px 0; border-top: 1px solid var(--border); }
.group h3 { padding: 0 8px 6px; }
.bar { justify-content: flex-start; gap: 8px; width: 100%; min-width: 0; height: auto; padding: 4px 8px; border-color: transparent;
       background: transparent; font-weight: 400; text-align: left; }
.bar[aria-pressed="true"], .bar[aria-pressed="true"]:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.bar .lab { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar .track { flex: 0 0 56px; height: 4px; overflow: hidden; border-radius: 2px; background: var(--surface-muted); }
.bar .fill { display: block; height: 100%; border-radius: 2px; background: var(--border-hover); }
.bar:hover .fill, .bar[aria-pressed="true"] .fill { background: var(--accent); }
.bar .num { flex: 0 0 2em; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.main { flex: 1 1 auto; min-width: 0; padding: 16px 22px 48px; }

/* The latest change on top; the whole log opens under it. */
.recent { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 4px 4px 4px 12px; border: 1px solid var(--border);
          border-radius: var(--radius-md); background: var(--surface); color: var(--muted); font-size: 12px; }
.recent:empty { display: none; }
.recent .text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent b { margin-right: 6px; color: var(--text); font-weight: 600; }
.recent button { height: 24px; }
.history { margin: -6px 0 14px; padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.history ol { max-height: 360px; margin: 0; padding: 0; overflow: auto; font-size: 12px; list-style: none; }
.history li { padding: 6px 0; border-bottom: 1px solid var(--border); }
.history li:last-child { border-bottom: 0; }
.history time { margin-right: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }

.head { margin-bottom: 14px; }
h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; overflow-wrap: anywhere; }
.meta { margin-top: 4px; color: var(--muted); font-size: 12px; }
.meta a, .meta .badge, .meta button { margin-left: 10px; white-space: nowrap; }
.meta button { height: 22px; }
.badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge.warn { color: var(--warning); background: var(--warning-soft); }
.editable { border-radius: 4px; cursor: text; }
.editable:hover { background: var(--surface-hover); box-shadow: 0 0 0 3px var(--surface-hover); }
input.inline { padding: 0 4px; border-color: var(--accent); border-radius: 4px; box-shadow: 0 0 0 3px var(--accent-soft); }
h1 input.inline { width: min(100%, 36ch); font-size: 20px; font-weight: 600; }
.meta input.inline { width: 5em; font-size: 12px; }

.add { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-bottom: 8px; padding: 8px; border: 1px solid var(--border);
       border-radius: var(--radius-md); background: var(--surface); }
.add textarea { flex: 2 1 340px; height: 32px; min-height: 32px; padding: 6px 10px; line-height: 1.35; resize: vertical; }
.add input { flex: 1 1 200px; height: 32px; }
.add button { height: 32px; padding: 0 16px; }
.status { min-height: 1.35em; margin: 0 0 10px; color: var(--muted); font-size: 12px; }
.status.bad { color: var(--error); }

/* A tile as the Gallery draws one: the drawing on white, the name, a quiet meta line, its tags as pills. */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 16px; }
.card { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md);
        background: var(--surface); transition: border-color 120ms ease, box-shadow 120ms ease; }
.card:hover { border-color: var(--border-hover); box-shadow: 0 4px 16px rgb(0 0 0 / 8%); }
.thumb { position: relative; display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; padding: 0; border: 0;
         border-bottom: 1px solid var(--border); border-radius: 0; background: #fff; cursor: zoom-in; }
.thumb:hover:not(:disabled) { background: #fff; }
/* Inside a button, height: 100% does not hold a drawing to the box; place it in the padding instead. */
.thumb img { position: absolute; inset: 10px; display: block; width: calc(100% - 20px); height: calc(100% - 20px); object-fit: contain; }
.thumb .gone { position: absolute; inset: 0; display: grid; place-items: center; background: var(--chrome-bg); color: var(--muted); font-size: 12px; }
.thumb .n { position: absolute; left: 8px; top: 8px; display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 6px;
            border: 1px solid var(--border); border-radius: 999px; background: rgb(255 255 255 / 92%); color: var(--muted);
            font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.body { display: flex; flex: 1; flex-direction: column; gap: 2px; padding: 10px 12px 12px; }
.name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.mark { display: inline-block; margin-left: 6px; padding: 2px 5px; border-radius: 4px; font-size: 11px; font-weight: 600; vertical-align: 1px; }
.mark.ai { color: var(--ai); background: var(--ai-soft); }
.small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.note { margin-top: 4px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-muted); font-size: 12px;
        white-space: pre-wrap; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 6px; }
.chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-muted); color: var(--muted); font-size: 11px; }
.chips select { height: 22px; padding: 0 6px; border-radius: 999px; font-size: 11px; cursor: pointer; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: auto; padding-top: 10px; }
.actions .pill { height: 24px; }
/* The edit buttons keep together: beside the link on a wide tile, on their own row at its right on a narrow one. */
.actions .tools { display: flex; gap: 4px; margin-left: auto; }
.actions button { height: 24px; padding: 0 8px; }
.empty { padding: 40px 0; color: var(--muted); text-align: center; }

.lightbox { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 20px;
            background: rgb(15 15 15 / 45%); }
.lightbox .box { display: flex; flex-direction: column; max-width: 96vw; max-height: 94vh; overflow: hidden; border-radius: var(--radius-lg);
                 background: var(--surface); box-shadow: var(--shadow-lg); }
.lightbox .img { flex: 1; min-height: 0; padding: 16px; border-bottom: 1px solid var(--border); background: #fff; }
.lightbox img { display: block; width: auto; height: auto; max-width: 92vw; max-height: 78vh; margin: 0 auto; }
.lightbox .cap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 14px; }
.lightbox .cap b { font-size: 14px; }
.lightbox .cap button { margin-left: auto; }
.lightbox .dialog { gap: 12px; width: min(420px, 92vw); padding: 18px; }
.dialog b { font-size: 14px; font-weight: 600; }
.dialog input, .dialog textarea { width: 100%; }
.dialog .row { display: flex; justify-content: flex-end; gap: 8px; }

/* Narrow, the map sits above the tiles and the header keeps one row. */
@media (max-width: 760px) {
  .layout { display: block; }
  .side-slot { width: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  .side { position: static; max-height: none; padding: 14px 8px 4px; }
  .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: start; column-gap: 12px; }
  .groups .group:first-child { grid-row: span 2; }
  .bar .track { flex-basis: 32px; }
  .main { padding: 14px 16px 40px; }
}
@media (max-width: 620px) {
  .chrome { gap: 8px; padding: 0 8px; }
  .crumb, .chrome .pill span { display: none; }
  .chrome .pill { padding: 0 7px; }
  .who a:nth-child(n+3) { display: none; }
  .who a.account { padding: 0 4px; font-size: 0; }
  .who a.account::before { margin-right: 0; }
}
`;

const CHROME = String.raw`<header class="chrome">
  <a class="brand" href="/" title="Back to the Gallery"><span class="brand-mark" aria-hidden="true"></span><b>Analog Canvas</b></a>
  <a class="pill" href="/editor" title="Open the editor"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.9 2.6 3.5 3.5-6.8 6.8-4.1.7.7-4.1 6.7-6.9Zm-1.6 1.6 3.5 3.5M3.2 12.8l2.5-.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Editor</span></a>
  <span class="crumb">Selection board</span>
  <div class="who" id="who"></div>
</header>`;

const SHARED = String.raw`
var pendingBoardCommands = {};
async function boardCommand(path, body, account) {
  var storageKey = "canvas-board-command:" + account + ":" + path;
  body.accountId = account;
  var input = JSON.stringify(body);
  function intentOf(text) {
    try { var value = JSON.parse(text); delete value.expectedRevision; return JSON.stringify(value); }
    catch (_) { return null; }
  }
  var command = pendingBoardCommands[storageKey];
  if (!command) { try { command = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch (_) {} }
  if (!command || typeof command.key !== "string" || intentOf(command.body) !== intentOf(input)) {
    command = { key: crypto.randomUUID(), body: input };
  }
  pendingBoardCommands[storageKey] = command;
  try { sessionStorage.setItem(storageKey, JSON.stringify(command)); } catch (_) {}
  var response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": command.key }, body: command.body });
  if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) {
    delete pendingBoardCommands[storageKey];
    try { sessionStorage.removeItem(storageKey); } catch (_) {}
  }
  return response;
}
var MESSAGES = {
  "entry-not-public": "No such entry, or it is not public in the Gallery",
  "entry-already-on-board": "Already on the board",
  "board-full": "The board is full",
  "board-locked": "The board is locked",
  "sign-in-required": "Sign in first",
  "blocked": "This account cannot make changes",
  "slots-below-items": "Slots cannot be fewer than the entries on the board",
  "bad-slots": "Slots must be between 1 and 500",
  "bad-changes": "Not a Gallery link or entry ID",
  "bad-entry": "Not a Gallery link or entry ID",
  "missing-title": "Give the board a name",
  "board-changed": "Someone else just changed the board; reload and try again",
  "cross-origin": "Make changes from this site's own page"
};
function message(payload) {
  var text = MESSAGES[payload && payload.error] || (payload && payload.error) || "Something went wrong";
  if (payload && payload.entryId) text += ": " + payload.entryId;
  if (payload && payload.entry) text += ": " + payload.entry;
  return text;
}
function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) for (var key in attrs) {
    if (key === "text") node.textContent = attrs[key];
    else if (key === "class") node.className = attrs[key];
    else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), attrs[key]);
    else if (attrs[key] !== null && attrs[key] !== undefined && attrs[key] !== false) node.setAttribute(key, attrs[key]);
  }
  (children || []).forEach(function (child) { if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child); });
  return node;
}
function signInLinks(path) {
  var back = encodeURIComponent(path);
  return [
    el("a", { href: "/api/auth/github/start?return=" + back, text: "Sign in with GitHub" }),
    el("a", { href: "/api/auth/google/start?return=" + back, text: "Sign in with Google" }),
    el("a", { href: "/", target: "_blank", rel: "noopener", text: "Other ways to sign in" })
  ];
}
function account(name) {
  return el("a", { class: "account", href: "/account", title: "Your account", "data-initial": (name || "?").trim().charAt(0).toUpperCase(), text: name });
}
function splitEntries(text) {
  return text.split(/[\s,，]+/).map(function (part) { return part.trim(); }).filter(Boolean);
}
`;

export const BOARD_PAGE =
  String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Selection board</title>
<style>` +
  STYLE +
  String.raw`</style>
</head>
<body>
` +
  CHROME +
  String.raw`
<div class="layout">
  <aside class="side-slot" id="map" hidden></aside>
  <main class="main">
    <div class="recent" id="recent"></div>
    <div class="history" id="history" hidden><ol id="events"></ol></div>
    <div class="head"><h1 id="title">Selection board</h1><div class="meta" id="meta"></div></div>
    <div class="add" id="add" hidden>
      <textarea id="add-entries" rows="1" placeholder="Paste Gallery links or entry IDs, several at once if you like"></textarea>
      <input id="add-note" placeholder="Note (optional, e.g. why it was picked)">
      <button class="primary" id="add-go">Add</button>
    </div>
    <p class="status" id="status"></p>
    <div class="grid" id="grid"></div>
  </main>
</div>
<script>
` +
  SHARED +
  String.raw`
var api = "/api/board";
var state = null, busy = false, lightbox = null;
// What the map filters the grid by: one value per dimension, or null.
var filter = { type: null, size: null, level: null };
var SIZES = [["≤5", 0, 5], ["6–10", 6, 10], ["11–20", 11, 20], ["21–40", 21, 40], [">40", 41, Infinity]];
function typeOf(item) { return item.type || (item.entry && item.entry.tagType) || null; }
function typeLabel(type) { return type || "Unclassified"; }
function sizeOf(item) {
  var n = item.entry ? item.entry.transistors : null;
  if (n === null || n === undefined) return "Unknown";
  for (var i = 0; i < SIZES.length; i++) if (n >= SIZES[i][1] && n <= SIZES[i][2]) return SIZES[i][0];
  return "Unknown";
}
function levelOf(item) { var l = item.entry && item.entry.levels; return l === "single" ? "Single-level" : l === "multi" ? "Multi-level" : "Unknown"; }
function shown(item) {
  return (filter.type === null || typeLabel(typeOf(item)) === filter.type)
    && (filter.size === null || sizeOf(item) === filter.size)
    && (filter.level === null || levelOf(item) === filter.level);
}
function $(name) { return document.getElementById(name); }
function say(text, bad) { $("status").textContent = text || ""; $("status").className = "status" + (bad ? " bad" : ""); }
function when(iso) {
  var d = new Date(iso);
  function two(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
}
function editable() { return state && state.viewer.canEdit && !state.board.lockedAt; }
function preview(item) { return api + "/preview/" + encodeURIComponent(item.entryId) + "?v=" + encodeURIComponent(item.entry.previewRevision); }
function canvas(entryId) { return "/g/" + encodeURIComponent(entryId); }

async function load() {
  var response = await fetch(api, { cache: "no-store" });
  var payload = await response.json().catch(function () { return {}; });
  if (!response.ok) { say(message(payload), true); $("title").textContent = "Selection board"; return; }
  state = payload;
  render();
}
async function change(changes, done) {
  if (busy) return;
  busy = true; say("Saving …");
  try {
    var response = await boardCommand(api + "/changes", state.board.revision > 0 ? { changes: changes, expectedRevision: state.board.revision } : { changes: changes }, state.viewer.accountId);
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) { say(message(payload), true); return; }
    state = payload; render(); say(done || "Saved");
  } finally { busy = false; }
}

function render() {
  var board = state.board, viewer = state.viewer, items = state.items;
  document.title = board.title + " · Selection board";
  var title = $("title");
  title.textContent = board.title;
  title.className = editable() ? "editable" : "";
  title.title = editable() ? "Click to rename" : "";
  title.onclick = editable() ? function () {
    inlineEdit(title, board.title, {}, function (next) { change([{ kind: "rename", title: next }], "Renamed"); });
  } : null;
  var meta = $("meta"); meta.textContent = "";
  var slots = el("span", { text: String(board.slots) });
  if (editable()) {
    slots.className = "editable";
    slots.title = "Click to change the slots";
    slots.onclick = function () {
      inlineEdit(slots, String(board.slots), { type: "number" }, function (next) { change([{ kind: "slots", slots: Number(next) }], "Slots changed"); });
    };
  }
  meta.append(items.length + " / ", slots, " entries" + (board.createdAt ? " · started by " + board.createdBy + " on " + when(board.createdAt) : ""));
  meta.append(el("a", { href: api + "/export", target: "_blank", rel: "noopener", text: "Export the list (JSON)" }));
  if (board.lockedAt) meta.append(el("span", { class: "badge warn", text: "Locked" }));
  if (board.lockedAt && viewer.canUnlock) meta.append(el("button", { text: "Unlock", onclick: function () { change([{ kind: "unlock" }], "Unlocked"); } }));
  var who = $("who"); who.textContent = "";
  if (viewer.signedIn) who.append(account(viewer.name));
  else signInLinks(location.pathname).forEach(function (a) { a.title = "Sign in to make changes"; who.append(a); });

  var recent = $("recent"); recent.textContent = "";
  var latest = state.events[0];
  if (latest) {
    recent.append(
      el("span", { class: "text", title: sentence(latest) }, [el("b", { text: "Latest change " }), when(latest.at) + " · " + sentence(latest)]),
      el("button", { text: $("history").hidden ? "All changes (" + state.events.length + ")" : "Hide", onclick: function () { $("history").hidden = !$("history").hidden; render(); } })
    );
  }

  $("add").hidden = !editable();

  var events = $("events"); events.textContent = "";
  state.events.forEach(function (event) { events.append(el("li", null, [el("time", { text: when(event.at) }), sentence(event)])); });

  renderMap(items);
  var grid = $("grid"); grid.textContent = "";
  if (!items.length) grid.append(el("div", { class: "empty", text: editable() ? "No entries yet. Paste Gallery links above and click Add." : viewer.signedIn ? "No entries yet." : "No entries yet. Sign in to add some." }));
  items.forEach(function (item, index) { if (shown(item)) grid.append(card(item, index, items.length)); });
}

// The map: the board's entries counted by type, transistor count and levels, from what the board holds now.
function renderMap(items) {
  var map = $("map"); map.textContent = "";
  if (!items.length) { map.hidden = true; return; }
  map.hidden = false;
  function counts(key) { var c = {}; items.forEach(function (item) { var k = key(item); c[k] = (c[k] || 0) + 1; }); return c; }
  function column(title, dimension, c, keys) {
    var max = 1;
    for (var k in c) max = Math.max(max, c[k]);
    return el("section", { class: "group" }, [el("h3", { text: title })].concat(keys.filter(function (k) { return c[k]; }).map(function (k) {
      return el("button", { class: "bar", "aria-pressed": filter[dimension] === k ? "true" : "false", title: k + ": " + c[k] + (c[k] === 1 ? " entry" : " entries"),
        onclick: function () { filter[dimension] = filter[dimension] === k ? null : k; render(); } }, [
        el("span", { class: "lab", text: k }),
        el("span", { class: "track" }, [el("span", { class: "fill", style: "width:" + Math.round(100 * c[k] / max) + "%" })]),
        el("span", { class: "num", text: String(c[k]) })
      ]);
    })));
  }
  var types = counts(function (item) { return typeLabel(typeOf(item)); });
  var typeKeys = Object.keys(types).filter(function (k) { return k !== "Unclassified"; })
    .sort(function (a, b) { return types[b] - types[a] || a.localeCompare(b); }).concat(["Unclassified"]);
  var active = filter.type !== null || filter.size !== null || filter.level !== null;
  var showing = items.filter(shown).length;
  map.append(el("div", { class: "side" }, [
    el("div", { class: "side-head" }, [
      el("h2", { text: "Map" }),
      active ? el("button", { class: "clear", text: "Clear filters", onclick: function () { filter = { type: null, size: null, level: null }; render(); } }) : null
    ]),
    el("p", { class: "side-note", text: active ? "Showing " + showing + " / " + items.length : items.length + (items.length === 1 ? " entry" : " entries") + "; click a bar to show only it" }),
    el("div", { class: "groups" }, [
      column("Circuit type", "type", types, typeKeys),
      column("Transistors", "size", counts(sizeOf), SIZES.map(function (s) { return s[0]; }).concat(["Unknown"])),
      column("Levels", "level", counts(levelOf), ["Single-level", "Multi-level", "Unknown"])
    ])
  ]));
}

function chips(item) {
  var type = typeOf(item), auto = !item.type && type;
  var typeChip;
  if (editable()) {
    typeChip = el("select", { title: auto ? "Taken from the entry's Gallery tags; you can change it" : "Circuit type", onchange: function (e) {
      var next = e.target.value || null;
      change([{ kind: "type", itemId: item.id, type: next }], next ? "Classified as " + typeLabel(next) : "Marked unclassified");
    } }, [el("option", { value: "", text: "Unclassified" })].concat((state.types || []).map(function (t) {
      return el("option", { value: t, text: typeLabel(t) + (auto && t === type ? " (auto)" : "") });
    })));
    typeChip.value = type || "";
  } else typeChip = el("span", { class: "chip", text: typeLabel(type) });
  return el("div", { class: "chips" }, [
    typeChip,
    el("span", { class: "chip", text: item.entry.transistors === null ? "? transistors" : item.entry.transistors + (item.entry.transistors === 1 ? " transistor" : " transistors") }),
    el("span", { class: "chip", text: levelOf(item) })
  ]);
}
function nameOf(entryId) { return (state.entryNames && state.entryNames[entryId]) || entryId; }
function sentence(event) {
  var who = event.actor + " ";
  switch (event.action) {
    case "create": return who + "started the board \u201c" + event.detail + "\u201d";
    case "add": return who + "added \u201c" + nameOf(event.entryId) + "\u201d" + (event.detail ? ", note: " + event.detail : "");
    case "replace": return who + "replaced \u201c" + nameOf(event.previousEntryId) + "\u201d with \u201c" + nameOf(event.entryId) + "\u201d" + (event.detail ? ", note: " + event.detail : "");
    case "remove": return who + "removed \u201c" + nameOf(event.previousEntryId) + "\u201d";
    case "type": return who + (event.detail ? "classified \u201c" + nameOf(event.entryId) + "\u201d as " + typeLabel(event.detail) : "cleared the type of \u201c" + nameOf(event.entryId) + "\u201d");
    case "note": return who + "noted \u201c" + nameOf(event.entryId) + "\u201d: " + (event.detail || "(cleared)");
    case "move": return who + "moved \u201c" + nameOf(event.entryId) + "\u201d from #" + event.detail.replace("→", " to #");
    case "rename": return who + "renamed the board \u201c" + event.detail + "\u201d";
    case "slots": return who + "set the slots to " + event.detail;
    case "lock": return who + "locked the board";
    case "unlock": return who + "unlocked the board";
    default: return who + event.action;
  }
}

function card(item, index, count) {
  var entry = item.entry;
  var thumb = el("button", { class: "thumb", title: entry ? "Enlarge" : "", onclick: function () { if (entry) open(item); } }, [
    entry ? el("img", { src: preview(item), alt: entry.name, loading: "lazy" }) : el("div", { class: "gone", text: "No longer public in the Gallery" }),
    el("span", { class: "n", text: String(index + 1) })
  ]);
  var body = el("div", { class: "body" }, [
    el("div", { class: "name" }, [entry ? entry.name : item.entryId, entry && entry.ai ? el("span", { class: "mark ai", text: "AI" }) : null]),
    entry ? el("div", { class: "small", text: "by " + entry.author + (entry.components ? " · " + entry.components + (entry.components === 1 ? " part" : " parts") : "") }) : null,
    el("div", { class: "small", text: "added by " + item.addedBy + " · " + when(item.addedAt) }),
    entry ? chips(item) : null,
    item.note ? el("div", { class: "note", text: item.note }) : null
  ]);
  var actions = el("div", { class: "actions" }, [el("a", { class: "pill", href: canvas(item.entryId), target: "_blank", rel: "noopener", text: "Open in Canvas ↗" })]);
  if (editable()) {
    var tools = el("div", { class: "tools" });
    tools.append(el("button", { text: "Replace", onclick: function () {
      ask("Replace \u201c" + (entry ? entry.name : item.entryId) + "\u201d with:", { placeholder: "A Gallery link or entry ID" }).then(function (next) {
        if (next && next.trim()) change([{ kind: "replace", itemId: item.id, entry: next.trim() }], "Replaced");
      });
    } }));
    tools.append(el("button", { text: "Note", onclick: function () {
      ask("Note", { value: item.note, multiline: true }).then(function (note) {
        if (note !== null && note !== item.note) change([{ kind: "note", itemId: item.id, note: note }], "Note saved");
      });
    } }));
    tools.append(el("button", { text: "↑", title: "Move up", disabled: index === 0, onclick: function () { change([{ kind: "move", itemId: item.id, to: index - 1 }], "Moved"); } }));
    tools.append(el("button", { text: "↓", title: "Move down", disabled: index === count - 1, onclick: function () { change([{ kind: "move", itemId: item.id, to: index + 1 }], "Moved"); } }));
    tools.append(el("button", { text: "Remove", onclick: function () {
      confirmBox("Remove \u201c" + (entry ? entry.name : item.entryId) + "\u201d from the board?", "Remove").then(function (yes) {
        if (yes) change([{ kind: "remove", itemId: item.id }], "Removed");
      });
    } }));
    actions.append(tools);
  }
  body.append(actions);
  return el("article", { class: "card" }, [thumb, body]);
}

function open(item) {
  close();
  lightbox = el("div", { class: "lightbox", onclick: function (e) { if (e.target === lightbox) close(); } }, [
    el("div", { class: "box" }, [
      el("div", { class: "img" }, [el("img", { src: preview(item), alt: item.entry.name })]),
      el("div", { class: "cap" }, [
        el("b", { text: item.entry.name }),
        el("span", { class: "small", text: "by " + item.entry.author }),
        el("a", { class: "pill", href: canvas(item.entryId), target: "_blank", rel: "noopener", text: "Open in Canvas ↗" }),
        el("button", { text: "Close", onclick: close })
      ])
    ])
  ]);
  document.body.append(lightbox);
}
function close() { if (lightbox) { lightbox.remove(); lightbox = null; } }

// The title and slots are edited where they stand: Enter or leaving the field saves, Escape cancels.
var editing = false;
function inlineEdit(host, value, options, save) {
  if (editing) return;
  editing = true;
  var input = el("input", { class: "inline", type: options.type || "text" });
  input.value = value;
  host.textContent = "";
  host.append(input);
  input.focus();
  input.select();
  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    editing = false;
    var next = input.value.trim();
    render();
    if (commit && next && next !== value) save(next);
  }
  input.addEventListener("click", function (e) { e.stopPropagation(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", function () { finish(true); });
}

// The page asks in its own dialog: a browser may refuse prompt() and confirm() (an embedded one does).
var dialog = null;
function ask(title, options) {
  options = options || {};
  return new Promise(function (resolve) {
    if (dialog) dialog.cancel();
    var field = options.multiline ? el("textarea", { rows: "4" }) : el("input", { type: options.type || "text" });
    field.value = options.value || "";
    if (options.placeholder) field.placeholder = options.placeholder;
    function finish(value) { if (dialog) { dialog.remove(); dialog = null; } resolve(value); }
    var ok = el("button", { class: "primary", text: options.ok || "OK", onclick: function () { finish(options.confirmOnly ? "" : field.value); } });
    dialog = el("div", { class: "lightbox", onclick: function (e) { if (e.target === dialog) finish(null); } }, [
      el("div", { class: "box dialog" }, [
        el("b", { text: title }),
        options.confirmOnly ? null : field,
        el("div", { class: "row" }, [el("button", { text: "Cancel", onclick: function () { finish(null); } }), ok])
      ])
    ]);
    dialog.cancel = function () { finish(null); };
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !options.multiline) { e.preventDefault(); finish(field.value); }
    });
    document.body.append(dialog);
    if (options.confirmOnly) ok.focus(); else { field.focus(); field.select(); }
  });
}
function confirmBox(message, okText) {
  return ask(message, { confirmOnly: true, ok: okText }).then(function (value) { return value !== null; });
}
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (dialog) dialog.cancel(); else close();
});

$("add-go").addEventListener("click", function () {
  var entries = splitEntries($("add-entries").value);
  if (!entries.length) return say("Paste a Gallery link or entry ID first", true);
  var note = $("add-note").value.trim();
  change(entries.map(function (entry) { return { kind: "add", entry: entry, note: note }; }), "Added " + entries.length + (entries.length === 1 ? " entry" : " entries")).then(function () {
    if (!$("status").classList.contains("bad")) { $("add-entries").value = ""; $("add-note").value = ""; }
  });
});

// Collaborators' changes arrive while the page is open.
setInterval(async function () {
  if (document.visibilityState !== "visible" || busy || lightbox || dialog || editing || !state) return;
  var response = await fetch(api, { cache: "no-store" }).catch(function () { return null; });
  if (!response || !response.ok) return;
  var payload = await response.json();
  if (payload.board.revision !== state.board.revision) { state = payload; render(); }
}, 10000);
load();
</script>
</body>
</html>
`;
