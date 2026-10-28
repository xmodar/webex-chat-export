/* global browser, WebexMerge, ExportOptions */
var session = new URLSearchParams(location.search).get("session");
var $ = function (id) { return document.getElementById(id); };
var out = $("status");

function show(s) {
  out.textContent = s.text;
  out.className = s.state;
  $("export").disabled = s.state === "running";
  if (s.state === "done") {
    $("export").textContent = "Export again…";
    $("later").textContent = "Close";
  }
}

async function render() {
  var rec = ((await browser.storage.local.get("captures")).captures || {})[session];
  if (!rec) {
    $("intro").textContent = "This chat is no longer stored.";
    ["export", "discard"].forEach(function (id) { $(id).disabled = true; });
    return;
  }
  $("meeting").textContent = rec.meeting || "Webex meeting";
  $("when").textContent = new Date(rec.startedAt).toLocaleString();
  $("convs").replaceChildren.apply($("convs"), rec.conversations.map(function (c) {
    var li = document.createElement("li");
    li.textContent = c.name + " — " + c.messages.length + " message" + (c.messages.length === 1 ? "" : "s");
    return li;
  }));
  if (rec.exportedCount && !(WebexMerge.count(rec) > rec.exportedCount)) {
    $("intro").textContent = "This chat was already exported.";
  }
}

ExportOptions.load();
render();

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "status" && msg.status.session === session) show(msg.status);
});

$("export").addEventListener("click", function () {
  var opts = ExportOptions.read();
  if (opts.error) return show({ state: "error", text: opts.error });
  show({ state: "running", text: "Choose where to save the file…" });
  browser.runtime.sendMessage({ type: "exportCapture", session: session, options: opts });
});

$("later").addEventListener("click", function () { window.close(); });

$("discard").addEventListener("click", async function () {
  if (!confirm("Delete the captured chat? It can't be exported afterwards.")) return;
  await browser.runtime.sendMessage({ type: "discardCapture", session: session });
  window.close();
});
