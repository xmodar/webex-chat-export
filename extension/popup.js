/* global browser, WebexMerge, ExportOptions */
var ORIGINS = ["*://*.webex.com/*"];

var $ = function (id) { return document.getElementById(id); };
var btn = $("export"), out = $("status");

function show(s) {
  if (!s) return;
  out.textContent = s.text;
  out.className = s.state;
  btn.disabled = s.state === "running";
}

ExportOptions.load();

// show an export that is still running (or just finished) from an earlier popup
browser.storage.session.get("status").then(function (o) {
  if (o.status && Date.now() - o.status.at < 10 * 60 * 1000) show(o.status);
});

// chats captured from meetings whose tab closed before they were exported
browser.storage.local.get("captures").then(function (o) {
  var all = o.captures || {};
  var recs = Object.keys(all).map(function (k) { return all[k]; })
    .filter(function (r) { return r.reminded && WebexMerge.count(r) > (r.exportedCount || 0); })
    .sort(function (a, b) { return b.startedAt - a.startedAt; });
  if (!recs.length) return;
  $("unsaved").hidden = false;
  $("unsavedList").replaceChildren.apply($("unsavedList"), recs.map(function (r) {
    var li = document.createElement("li"), a = document.createElement("a");
    a.href = browser.runtime.getURL("reminder.html?session=" + encodeURIComponent(r.session));
    a.target = "_blank";
    a.textContent = (r.meeting || "Webex meeting") + " · " + new Date(r.startedAt).toLocaleString() +
      " · " + WebexMerge.count(r) + " messages";
    li.appendChild(a);
    return li;
  }));
});

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "status" && !msg.status.session) show(msg.status);
});

btn.addEventListener("click", async function () {
  var opts = ExportOptions.read();
  if (opts.error) return show({ state: "error", text: opts.error });
  // Firefox lets people withhold host access; ask while we have the click
  var ok = await browser.permissions.contains({ origins: ORIGINS }) || await browser.permissions.request({ origins: ORIGINS });
  if (!ok) return show({ state: "error", text: "Allow access to webex.com to read the chat." });
  var tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0] || !/^https:\/\/[^/]*webex\.com\//.test(tabs[0].url || "")) {
    return show({ state: "error", text: "Open the Webex meeting tab first." });
  }
  show({ state: "running", text: "Starting…" });
  browser.runtime.sendMessage({ type: "export", tabId: tabs[0].id, options: opts });
});
