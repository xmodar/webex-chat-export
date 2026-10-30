/* global browser, ExportOptions */
/* The saved chats page: lists the chats from the index, exports or deletes them. */
var $ = function (id) { return document.getElementById(id); };
var out = $("status"), index = {};

function show(s) {
  out.textContent = s.text;
  out.className = s.state;
  document.querySelectorAll("button.export").forEach(function (b) { b.disabled = s.state === "running"; });
}

function when(e) {
  var start = new Date(e.startedAt), end = new Date(e.updatedAt);
  var day = start.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  var t = function (d) { return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };
  var same = start.toDateString() === end.toDateString();
  return day + ", " + t(start) + "–" + (same ? "" : end.toLocaleDateString() + " ") + t(end);
}

function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

function render() {
  var q = $("filter").value.trim().toLowerCase();
  var all = Object.keys(index).map(function (k) { return index[k]; })
    .sort(function (a, b) { return b.startedAt - a.startedAt; });
  var shown = all.filter(function (e) { return !q || (e.meeting || "webex meeting").toLowerCase().indexOf(q) >= 0; });
  $("empty").hidden = all.length > 0;
  $("deleteAll").disabled = !all.length;
  $("list").replaceChildren.apply($("list"), shown.map(function (e) {
    var li = $("row").content.firstElementChild.cloneNode(true);
    li.querySelector(".meeting").textContent = e.meeting || "Webex meeting";
    li.querySelector(".when").textContent = when(e) + " · " + plural(e.count, "message");
    var badge = li.querySelector(".badge");
    var since = e.exportedAt && e.updatedAt > e.exportedAt + 10000;
    badge.textContent = !e.exportedAt ? "Not exported" : since ? "New messages since export" : "Exported";
    badge.className = "badge" + (e.exportedAt && !since ? " ok" : "");
    badge.title = e.exportedAt ? "Last exported " + new Date(e.exportedAt).toLocaleString() : "";
    li.querySelector(".convs").replaceChildren.apply(li.querySelector(".convs"), e.conversations.map(function (c) {
      var item = document.createElement("li");
      item.textContent = c.name + " · " + plural(c.count, "message");
      return item;
    }));
    li.querySelector(".export").addEventListener("click", function () {
      var opts = ExportOptions.read();
      if (opts.error) return show({ state: "error", text: opts.error });
      show({ state: "running", text: "Choose where to save the file…" });
      browser.runtime.sendMessage({ type: "exportChat", id: e.id, options: opts });
    });
    li.querySelector(".delete").addEventListener("click", function () {
      if (!confirm("Delete the saved chat of “" + (e.meeting || "Webex meeting") + "”? This can't be undone.")) return;
      browser.runtime.sendMessage({ type: "deleteChats", ids: [e.id] });
    });
    return li;
  }));
}

function load() {
  return browser.storage.local.get("chatIndex").then(function (o) { index = o.chatIndex || {}; render(); });
}

ExportOptions.load();
load();
$("filter").addEventListener("input", render);
browser.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes.chatIndex) { index = changes.chatIndex.newValue || {}; render(); }
});
browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "status" && msg.status.chat) show(msg.status);
});

$("deleteAll").addEventListener("click", function () {
  var ids = Object.keys(index);
  if (!ids.length || !confirm("Delete all " + plural(ids.length, "saved chat") + "? This can't be undone.")) return;
  browser.runtime.sendMessage({ type: "deleteChats", ids: ids });
});
