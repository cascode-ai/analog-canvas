// The pages of selection boards (docs/specs/selection-boards.md), served whole by
// worker/boards.ts: /boards, where an administrator makes a board, and
// /boards/<id>, the board itself. Everything they show comes from /api/boards and
// is set as text, never as markup.

const STYLE = String.raw`
:root {
  --bg: #f6f6f3; --panel: #ffffff; --ink: #1c1c1a; --muted: #6a6a64; --line: #deded8;
  --accent: #1f6f5c; --accent-ink: #ffffff; --soft: #e6f1ec; --warn: #9a3412; --warn-bg: #fdf0e6;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --panel: #1f1f1d; --ink: #ecece8; --muted: #a3a39c; --line: #34342f;
          --accent: #52b596; --accent-ink: #0c1f19; --soft: #1c3830; --warn: #f2b277; --warn-bg: #3a2a18; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink);
       font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif; }
a { color: var(--accent); }
button, input, textarea, select { font: inherit; color: inherit; }
button { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
input, textarea { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 0 16px 40px; }
header { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 16px; padding: 18px 0 12px; }
header .title { flex: 1 1 320px; min-width: 0; }
h1 { font-size: 22px; line-height: 1.3; margin: 0; overflow-wrap: anywhere; }
.meta { color: var(--muted); margin-top: 4px; }
.badge { display: inline-block; font-size: 12px; border-radius: 999px; padding: 1px 8px; background: var(--soft); color: var(--accent); margin-left: 6px; }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.who { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--muted); }
.tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 4px 0 12px; }
.add { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; background: var(--panel); border: 1px solid var(--line);
       border-radius: 10px; padding: 10px; margin-bottom: 12px; }
.add textarea { flex: 2 1 360px; min-height: 38px; resize: vertical; }
.add input { flex: 1 1 200px; }
.status { min-height: 1.5em; color: var(--muted); margin: 0 0 10px; }
.status.bad { color: var(--warn); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
.thumb { position: relative; display: block; background: #fff; aspect-ratio: 4 / 3; cursor: zoom-in; border: 0; padding: 10px; width: 100%; border-radius: 0; }
.thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.thumb .n { position: absolute; left: 8px; top: 8px; background: rgba(0,0,0,.62); color: #fff; font-size: 12px; border-radius: 999px; padding: 0 8px; }
.gone { display: grid; place-items: center; height: 100%; color: #8a8a84; }
.body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.small { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.note { background: var(--bg); border-radius: 6px; padding: 4px 8px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
.actions button, .actions a { font-size: 13px; padding: 3px 8px; }
.actions a { border: 1px solid var(--line); border-radius: 6px; text-decoration: none; }
.history { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; }
.history ol { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; }
.history li { padding: 4px 0; border-bottom: 1px solid var(--line); }
.history li:last-child { border-bottom: 0; }
.history time { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 8px; }
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 10; }
.lightbox .box { background: var(--panel); border-radius: 12px; max-width: 96vw; max-height: 94vh; display: flex; flex-direction: column; overflow: hidden; }
.lightbox .img { background: #fff; flex: 1; min-height: 0; padding: 14px; }
.lightbox img { max-width: 92vw; max-height: 78vh; width: auto; height: auto; display: block; margin: 0 auto; }
.lightbox .cap { padding: 10px 14px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.empty { color: var(--muted); padding: 30px 0; text-align: center; }
form.make { display: grid; gap: 10px; max-width: 640px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
form.make label { display: grid; gap: 4px; }
form.make textarea { min-height: 160px; }
`;

const SHARED = String.raw`
var MESSAGES = {
  "entry-not-public": "找不到这个条目，或它不在公开的 Gallery 上",
  "entry-already-on-board": "这道题已经在板上了",
  "board-full": "名额已满",
  "board-locked": "板已锁定，不能再改",
  "sign-in-required": "请先登录",
  "blocked": "这个账号不能修改",
  "not-allowed": "只有创建者或管理员能解锁",
  "slots-below-items": "名额不能少于已有的题数",
  "bad-slots": "名额要在 1 到 500 之间",
  "bad-changes": "没认出这个链接或编号",
  "bad-entry": "没认出这个链接或编号",
  "missing-title": "请填写名字",
  "admin-only": "只有管理员能新建选题板",
  "board-not-found": "没有这个选题板，链接可能不完整",
  "cross-origin": "请在本站页面上操作"
};
function message(payload) {
  var text = MESSAGES[payload && payload.error] || (payload && payload.error) || "出错了";
  if (payload && payload.entryId) text += "：" + payload.entryId;
  if (payload && payload.entry) text += "：" + payload.entry;
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
    el("a", { href: "/api/auth/github/start?return=" + back, text: "用 GitHub 登录" }),
    el("a", { href: "/api/auth/google/start?return=" + back, text: "用 Google 登录" }),
    el("a", { href: "/", target: "_blank", rel: "noopener", text: "其他方式：去 Canvas 登录" })
  ];
}
function splitEntries(text) {
  return text.split(/[\s,，]+/).map(function (part) { return part.trim(); }).filter(Boolean);
}
`;

export const BOARD_PAGE =
  String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>选题板</title>
<style>` +
  STYLE +
  String.raw`</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="title"><h1 id="title">选题板</h1><div class="meta" id="meta"></div></div>
    <div class="who" id="who"></div>
  </header>
  <div class="tools" id="tools"></div>
  <div class="history" id="history" hidden><ol id="events"></ol></div>
  <div class="add" id="add" hidden>
    <textarea id="add-entries" rows="1" placeholder="粘贴 Gallery 链接或编号，一次可以贴多个"></textarea>
    <input id="add-note" placeholder="备注（选填，比如入选理由）">
    <button class="primary" id="add-go">加入</button>
  </div>
  <p class="status" id="status"></p>
  <div class="grid" id="grid"></div>
</div>
<script>
` +
  SHARED +
  String.raw`
var id = location.pathname.split("/").filter(Boolean)[1];
var api = "/api/boards/" + encodeURIComponent(id);
var state = null, busy = false, lightbox = null;
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
  if (!response.ok) { say(message(payload), true); $("title").textContent = "选题板"; return; }
  state = payload;
  render();
}
async function change(changes, done) {
  if (busy) return;
  busy = true; say("保存中 …");
  try {
    var response = await fetch(api + "/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: changes }) });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) { say(message(payload), true); return; }
    state = payload; render(); say(done || "已保存");
  } finally { busy = false; }
}

function render() {
  var board = state.board, viewer = state.viewer, items = state.items;
  document.title = board.title + " · 选题板";
  $("title").textContent = board.title;
  $("meta").textContent = "";
  $("meta").append(items.length + " / " + board.slots + " 道 · " + board.createdBy + " 创建于 " + when(board.createdAt));
  if (board.lockedAt) $("meta").append(el("span", { class: "badge warn", text: "已锁定" }));
  var who = $("who"); who.textContent = "";
  if (viewer.signedIn) who.append("已登录：" + viewer.name);
  else { who.append("登录后才能修改："); signInLinks(location.pathname).forEach(function (a) { who.append(a); }); }

  var tools = $("tools"); tools.textContent = "";
  tools.append(el("button", { text: $("history").hidden ? "改动记录" : "收起改动记录", onclick: function () { $("history").hidden = !$("history").hidden; render(); } }));
  tools.append(el("a", { href: api + "/export", target: "_blank", rel: "noopener", text: "导出名单（JSON）" }));
  if (editable()) {
    tools.append(el("button", { text: "改名", onclick: function () {
      var title = prompt("新的名字", board.title);
      if (title && title.trim() && title.trim() !== board.title) change([{ kind: "rename", title: title.trim() }], "已改名");
    } }));
    tools.append(el("button", { text: "名额", onclick: function () {
      var slots = prompt("名额（1–500）", String(board.slots));
      if (slots && Number(slots) !== board.slots) change([{ kind: "slots", slots: Number(slots) }], "名额已改");
    } }));
    tools.append(el("button", { text: "锁定", onclick: function () {
      if (confirm("锁定后谁都不能再改，只有创建者或管理员能解锁。确定锁定？")) change([{ kind: "lock" }], "已锁定");
    } }));
  }
  if (board.lockedAt && viewer.canUnlock) tools.append(el("button", { text: "解锁", onclick: function () { change([{ kind: "unlock" }], "已解锁"); } }));

  $("add").hidden = !editable();

  var events = $("events"); events.textContent = "";
  state.events.forEach(function (event) { events.append(el("li", null, [el("time", { text: when(event.at) }), sentence(event)])); });

  var grid = $("grid"); grid.textContent = "";
  if (!items.length) grid.append(el("div", { class: "empty", text: editable() ? "还没有题。把 Gallery 链接贴到上面，点“加入”。" : "还没有题。" }));
  items.forEach(function (item, index) { grid.append(card(item, index, items.length)); });
}

function nameOf(entryId) { return (state.entryNames && state.entryNames[entryId]) || entryId; }
function sentence(event) {
  var who = event.actor + " ";
  switch (event.action) {
    case "create": return who + "创建了这个板「" + event.detail + "」";
    case "add": return who + "加入了「" + nameOf(event.entryId) + "」" + (event.detail ? "，备注：" + event.detail : "");
    case "replace": return who + "把「" + nameOf(event.previousEntryId) + "」换成了「" + nameOf(event.entryId) + "」" + (event.detail ? "，备注：" + event.detail : "");
    case "remove": return who + "移出了「" + nameOf(event.previousEntryId) + "」";
    case "note": return who + "给「" + nameOf(event.entryId) + "」写了备注：" + (event.detail || "（清空）");
    case "move": return who + "把「" + nameOf(event.entryId) + "」从第 " + event.detail.replace("→", " 位挪到第 ") + " 位";
    case "rename": return who + "把板改名为「" + event.detail + "」";
    case "slots": return who + "把名额改成 " + event.detail;
    case "lock": return who + "锁定了这个板";
    case "unlock": return who + "解锁了这个板";
    default: return who + event.action;
  }
}

function card(item, index, count) {
  var entry = item.entry;
  var thumb = el("button", { class: "thumb", title: entry ? "放大看" : "", onclick: function () { if (entry) open(item); } }, [
    entry ? el("img", { src: preview(item), alt: entry.name, loading: "lazy" }) : el("div", { class: "gone", text: "这道题已不在公开的 Gallery 上" }),
    el("span", { class: "n", text: String(index + 1) })
  ]);
  var body = el("div", { class: "body" }, [
    el("div", { class: "name", text: entry ? entry.name : item.entryId }),
    entry ? el("div", { class: "small", text: "作者：" + entry.author + (entry.ai ? "（AI）" : "") + (entry.components ? " · 元件 " + entry.components : "") }) : null,
    el("div", { class: "small", text: "放入：" + item.addedBy + " · " + when(item.addedAt) }),
    item.note ? el("div", { class: "note", text: item.note }) : null
  ]);
  var actions = el("div", { class: "actions" }, [el("a", { href: canvas(item.entryId), target: "_blank", rel: "noopener", text: "在 Canvas 打开 ↗" })]);
  if (editable()) {
    actions.append(el("button", { text: "换", onclick: function () {
      var next = prompt("换成哪道题？贴 Gallery 链接或编号");
      if (next && next.trim()) change([{ kind: "replace", itemId: item.id, entry: next.trim() }], "已换");
    } }));
    actions.append(el("button", { text: "备注", onclick: function () {
      var note = prompt("备注", item.note);
      if (note !== null && note !== item.note) change([{ kind: "note", itemId: item.id, note: note }], "备注已存");
    } }));
    actions.append(el("button", { text: "↑", title: "往前挪", disabled: index === 0, onclick: function () { change([{ kind: "move", itemId: item.id, to: index - 1 }], "已挪动"); } }));
    actions.append(el("button", { text: "↓", title: "往后挪", disabled: index === count - 1, onclick: function () { change([{ kind: "move", itemId: item.id, to: index + 1 }], "已挪动"); } }));
    actions.append(el("button", { text: "移出", onclick: function () {
      if (confirm("把「" + (entry ? entry.name : item.entryId) + "」移出这个板？")) change([{ kind: "remove", itemId: item.id }], "已移出");
    } }));
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
        el("span", { class: "small", text: "作者：" + item.entry.author }),
        el("a", { href: canvas(item.entryId), target: "_blank", rel: "noopener", text: "在 Canvas 打开 ↗" }),
        el("button", { text: "关闭", onclick: close })
      ])
    ])
  ]);
  document.body.append(lightbox);
}
function close() { if (lightbox) { lightbox.remove(); lightbox = null; } }
document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

$("add-go").addEventListener("click", function () {
  var entries = splitEntries($("add-entries").value);
  if (!entries.length) return say("先贴 Gallery 链接或编号", true);
  var note = $("add-note").value.trim();
  change(entries.map(function (entry) { return { kind: "add", entry: entry, note: note }; }), "已加入 " + entries.length + " 道").then(function () {
    if (!$("status").classList.contains("bad")) { $("add-entries").value = ""; $("add-note").value = ""; }
  });
});

// Collaborators' changes arrive while the page is open.
setInterval(async function () {
  if (document.visibilityState !== "visible" || busy || lightbox || !state) return;
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

export const BOARDS_HOME_PAGE =
  String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>选题板</title>
<style>` +
  STYLE +
  String.raw`</style>
</head>
<body>
<div class="wrap">
  <header><div class="title"><h1>选题板</h1><div class="meta">一个选题板是一串 Gallery 电路的有序名单，拿到链接的人都能看；登录后可以加、换、删，每次改动都记下是谁做的。</div></div><div class="who" id="who"></div></header>
  <p class="status" id="status"></p>
  <div id="main"></div>
</div>
<script>
` +
  SHARED +
  String.raw`
function $(name) { return document.getElementById(name); }
(async function () {
  var me = await fetch("/api/auth/me", { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return {}; });
  var user = me && me.user;
  var who = $("who");
  if (user) who.append("已登录：" + user.displayName);
  else signInLinks("/boards").forEach(function (a) { who.append(a); });
  if (!user || !user.isAdmin) {
    $("main").append(el("p", { class: "empty", text: "只有管理员能新建选题板。要看或修改一个板，请向管理员要它的链接。" }));
    return;
  }
  var title = el("input", { required: "required", maxlength: "120", placeholder: "比如：第一赛季评分基准" });
  var slots = el("input", { type: "number", min: "1", max: "500", value: "50" });
  var entries = el("textarea", { placeholder: "可选：一开始就放进去的 Gallery 链接或编号，每行一个" });
  var go = el("button", { class: "primary", type: "submit", text: "新建选题板" });
  var form = el("form", { class: "make" }, [
    el("label", null, ["名字", title]),
    el("label", null, ["名额", slots]),
    el("label", null, ["初始名单", entries]),
    go
  ]);
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    go.disabled = true; $("status").textContent = "新建中 …"; $("status").className = "status";
    var response = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.value.trim(), slots: Number(slots.value), entries: splitEntries(entries.value) }) });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) { $("status").textContent = message(payload); $("status").className = "status bad"; go.disabled = false; return; }
    location.href = "/boards/" + payload.board.id;
  });
  $("main").append(form);
})();
</script>
</body>
</html>
`;
