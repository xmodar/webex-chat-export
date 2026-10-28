/*
 * Runs the export: injects the scraper into every frame of the meeting tab,
 * takes the answer from the frame that hosts the chat, builds the file and
 * hands it to the downloads API.
 */
/* global WebexExport */
if (typeof importScripts === "function") importScripts("lib/xlsx.js", "lib/export.js"); // Chrome service worker

var ext = globalThis.browser || globalThis.chrome;
var busy = false;

function status(state, text, extra) {
  var s = Object.assign({ state: state, text: text, at: Date.now() }, extra || {});
  ext.storage.session ? ext.storage.session.set({ status: s }) : ext.storage.local.set({ status: s });
  ext.runtime.sendMessage({ type: "status", status: s }).catch(function () {}); // popup may be closed
}

function base64(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function download(file) {
  var url, revoke = null;
  if (typeof URL.createObjectURL === "function") {
    url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
    revoke = url;
  } else {
    url = "data:" + file.type + ";base64," + base64(file.bytes); // service workers have no blob URLs
  }
  try {
    await ext.downloads.download({ url: url, filename: file.name, saveAs: false, conflictAction: "uniquify" });
  } finally {
    if (revoke) setTimeout(function () { URL.revokeObjectURL(revoke); }, 60000);
  }
}

async function runExport(tabId, opts) {
  if (busy) throw new Error("An export is already running.");
  busy = true;
  try {
    status("running", "Looking for the chat…");
    var target = { tabId: tabId, allFrames: true };
    await ext.scripting.executeScript({ target: target, files: ["lib/markdown.js", "lib/scrape.js"] });
    var results = await ext.scripting.executeScript({
      target: target,
      args: [{ includeDirect: opts.includeDirect }],
      func: function (o) {
        if (!globalThis.WebexChatScraper) return { found: false };
        var ext = globalThis.browser || globalThis.chrome;
        o.onProgress = function (t) { ext.runtime.sendMessage({ type: "progress", text: t }).catch(function () {}); };
        return globalThis.WebexChatScraper.run(o).catch(function (e) { return { found: true, error: String(e && e.message || e) }; });
      }
    });

    var hits = results.map(function (r) { return r.result; }).filter(function (r) { return r && r.found; });
    var got = hits.filter(function (r) { return !r.error; })[0];
    if (!got) throw new Error(hits.length ? hits[0].error : "No Webex meeting chat found in this tab. Join the meeting in the browser first.");

    var file = opts.format === "json" ? WebexExport.buildJsonFile(got, opts) : WebexExport.buildXlsxFile(got, opts);
    if (!file.count) throw new Error("The chat has no messages yet.");
    await download(file);
    var convs = got.conversations.length;
    status("done", file.count + " messages from " + convs + " conversation" + (convs === 1 ? "" : "s") + " → " + file.name);
  } catch (e) {
    status("error", String(e && e.message || e));
  } finally {
    busy = false;
  }
}

ext.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "progress") status("running", msg.text);
  if (msg && msg.type === "export") runExport(msg.tabId, msg.options || {});
});
