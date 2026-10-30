/* global browser, ExportOptions */
var ORIGINS = ["*://*.webex.com/*"];

var $ = function (id) { return document.getElementById(id); };
var btn = $("export"), out = $("status");

function isMeeting(tab) { return !!tab && /^https:\/\/[^/]*webex\.com\//.test(tab.url || ""); }

function show(s) {
  if (!s) return;
  out.textContent = s.text;
  out.className = s.state;
  btn.disabled = s.state === "running";
}

ExportOptions.load();

// the live export needs the meeting tab in front
browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
  if (isMeeting(tabs[0])) return;
  btn.disabled = true;
  btn.textContent = "Open a Webex meeting to export it";
  $("liveHint").hidden = true;
});

// show an export that is still running (or just finished) from an earlier popup
browser.storage.session.get("status").then(function (o) {
  if (o.status && Date.now() - o.status.at < 10 * 60 * 1000) show(o.status);
});

function count() {
  browser.storage.local.get("chatIndex").then(function (o) {
    var n = Object.keys(o.chatIndex || {}).length;
    $("savedCount").textContent = n ? n + " saved chat" + (n === 1 ? "" : "s") : "No saved chats yet";
  });
}
count();
browser.storage.onChanged.addListener(function (changes, area) { if (area === "local" && changes.chatIndex) count(); });

$("manage").addEventListener("click", function () {
  browser.tabs.create({ url: browser.runtime.getURL("chats.html") });
  window.close();
});

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "status" && !msg.status.chat) show(msg.status);
});

btn.addEventListener("click", async function () {
  var opts = ExportOptions.read();
  if (opts.error) return show({ state: "error", text: opts.error });
  // Firefox lets people withhold host access; ask while we have the click
  var ok = await browser.permissions.contains({ origins: ORIGINS }) || await browser.permissions.request({ origins: ORIGINS });
  if (!ok) return show({ state: "error", text: "Allow access to webex.com to read the chat." });
  var tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!isMeeting(tabs[0])) return show({ state: "error", text: "Open the Webex meeting tab first." });
  show({ state: "running", text: "Starting…" });
  browser.runtime.sendMessage({ type: "export", tabId: tabs[0].id, options: opts });
});
