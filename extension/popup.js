/* global browser */
var ORIGINS = ["*://*.webex.com/*"];
var LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
// myName / timezone left empty mean "detect": the participants list and this computer's zone
var DEFAULTS = { format: "xlsx", includeDirect: true, myName: "", timezone: "", direction: "auto" };

var $ = function (id) { return document.getElementById(id); };
var btn = $("export"), out = $("status");

function show(s) {
  if (!s) return;
  out.textContent = s.text;
  out.className = s.state;
  btn.disabled = s.state === "running";
}

function read() {
  return {
    format: document.querySelector('input[name="format"]:checked').value,
    includeDirect: $("includeDirect").checked,
    myName: $("myName").value.trim(),
    timezone: $("timezone").value.trim(),
    direction: $("direction").value
  };
}

browser.storage.local.get(DEFAULTS).then(function (o) {
  document.querySelector('input[name="format"][value="' + o.format + '"]').checked = true;
  $("includeDirect").checked = o.includeDirect;
  $("myName").value = o.myName;
  $("timezone").value = o.timezone;
  $("direction").value = o.direction;
});
$("timezone").placeholder = LOCAL_TZ;

function validZone(tz) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch (e) { return false; }
}

// show an export that is still running (or just finished) from an earlier popup
browser.storage.session.get("status").then(function (o) {
  if (o.status && Date.now() - o.status.at < 10 * 60 * 1000) show(o.status);
});

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "status") show(msg.status);
});

btn.addEventListener("click", async function () {
  var opts = read();
  if (opts.timezone && !validZone(opts.timezone)) {
    return show({ state: "error", text: "Unknown time zone “" + opts.timezone + "”. Use a name like Europe/Berlin." });
  }
  browser.storage.local.set(opts);
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
