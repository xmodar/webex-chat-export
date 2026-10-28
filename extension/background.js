/*
 * Background: runs exports and keeps the live capture.
 *
 * - Export: injects the scraper into every frame of the meeting tab, takes
 *   the answer from the frame that hosts the chat, builds the file and asks
 *   where to save it.
 * - Capture: capture.js sends what the chat shows every few seconds. It is
 *   merged into one record per meeting session, so that when the tab is
 *   closed (or the browser quits) with messages that were never exported, a
 *   reminder window can offer to export them.
 */
/* global browser, WebexExport, WebexMerge */
// Chrome runs this as a service worker (no manifest script list), Firefox as an event page
if (typeof importScripts === "function") {
  importScripts("vendor/browser-polyfill.min.js", "lib/xlsx.js", "lib/merge.js", "lib/export.js");
}

var busy = false;
var KEEP_DAYS = 14;

function status(state, text, extra) {
  var s = Object.assign({ state: state, text: text, at: Date.now() }, extra || {});
  if (!s.session) browser.storage.session.set({ status: s });
  browser.runtime.sendMessage({ type: "status", status: s }).catch(function () {}); // popup may be closed
}

/* ---------- saving files ------------------------------------------------ */

function base64(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function finished(id) {
  return new Promise(function (resolve) {
    function check(d) {
      var state = d && (d.state && d.state.current || d.state);
      if (state === "complete" || state === "interrupted") {
        browser.downloads.onChanged.removeListener(onChanged);
        resolve(state === "complete");
      }
    }
    function onChanged(delta) { if (delta.id === id) check(delta); }
    browser.downloads.onChanged.addListener(onChanged);
    browser.downloads.search({ id: id }).then(function (r) { check(r[0]); });
  });
}

/* Ask where to save. Resolves false when the person cancels the dialog. */
async function save(file) {
  var url, blob = typeof URL.createObjectURL === "function";
  url = blob ? URL.createObjectURL(new Blob([file.bytes], { type: file.type }))
    : "data:" + file.type + ";base64," + base64(file.bytes); // service workers have no blob URLs
  try {
    var id = await browser.downloads.download({ url: url, filename: file.name, saveAs: true, conflictAction: "uniquify" });
    return await finished(id);
  } catch (e) {
    if (/cancel/i.test(String(e && e.message || e))) return false; // Firefox rejects on cancel
    throw e;
  } finally {
    if (blob) setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
}

function build(result, opts) {
  return opts.format === "json" ? WebexExport.buildJsonFile(result, opts) : WebexExport.buildXlsxFile(result, opts);
}

function summary(file, result) {
  var convs = result.conversations.filter(function (c) { return c.messages.length; }).length;
  return file.count + " messages from " + convs + " conversation" + (convs === 1 ? "" : "s") + " saved as " + file.name;
}

/* ---------- capture store ------------------------------------------------ */

// one read-modify-write at a time: capture messages arrive every few seconds
var queue = Promise.resolve();
function withCaptures(fn) {
  var run = queue.then(async function () {
    var all = (await browser.storage.local.get("captures")).captures || {};
    var out = await fn(all);
    await browser.storage.local.set({ captures: all });
    return out;
  });
  queue = run.catch(function () {});
  return run;
}

function unsaved(rec) { return WebexMerge.count(rec) > (rec.exportedCount || 0); }

function capture(session, tabId, snap) {
  return withCaptures(function (all) {
    var rec = all[session] || (all[session] = { session: session, tabId: tabId, startedAt: Date.now(), conversations: [] });
    WebexMerge.mergeResult(rec, snap);
    rec.updatedAt = Date.now();
  });
}

async function openReminder(session) {
  var url = browser.runtime.getURL("reminder.html?session=" + encodeURIComponent(session));
  try {
    await browser.windows.create({ url: url, type: "popup", width: 440, height: 600 });
  } catch (e) {
    await browser.tabs.create({ url: url });
  }
}

function remind(match) {
  return withCaptures(function (all) {
    var due = Object.keys(all).filter(function (k) { return match(all[k]) && !all[k].reminded && unsaved(all[k]); });
    due.forEach(function (k) { all[k].reminded = true; });
    return due;
  }).then(function (due) { return Promise.all(due.map(openReminder)); });
}

/* ---------- exports ------------------------------------------------------ */

async function runExport(tabId, opts) {
  if (busy) return status("error", "An export is already running.");
  busy = true;
  try {
    status("running", "Looking for the chat…");
    var target = { tabId: tabId, allFrames: true };
    await browser.scripting.executeScript({
      target: target, files: ["vendor/browser-polyfill.min.js", "lib/markdown.js", "lib/merge.js", "lib/scrape.js"]
    });
    var results = await browser.scripting.executeScript({
      target: target,
      args: [{ includeDirect: opts.includeDirect }],
      func: function (o) {
        if (!globalThis.WebexChatScraper) return { found: false };
        o.onProgress = function (t) { browser.runtime.sendMessage({ type: "progress", text: t }).catch(function () {}); };
        return globalThis.WebexChatScraper.run(o).catch(function (e) { return { found: true, error: String(e && e.message || e) }; });
      }
    });

    var hits = results.map(function (r) { return r.result; }).filter(function (r) { return r && r.found; });
    var got = hits.filter(function (r) { return !r.error; })[0];
    if (!got) throw new Error(hits.length ? hits[0].error : "No Webex meeting chat found in this tab. Join the meeting in the browser first.");

    var file = await build(got, opts);
    if (!file.count) throw new Error("The chat has no messages yet.");
    status("running", "Choose where to save " + file.name + "…");
    if (!(await save(file))) return status("idle", "Export cancelled.");

    // the full export also completes this meeting's capture, and marks it saved
    await withCaptures(function (all) {
      var rec = Object.keys(all).map(function (k) { return all[k]; })
        .filter(function (r) { return r.tabId === tabId; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0];
      if (!rec) rec = all["export-" + Date.now()] = { session: "export-" + Date.now(), tabId: tabId, startedAt: Date.now(), conversations: [] };
      WebexMerge.mergeResult(rec, got);
      rec.updatedAt = Date.now();
      rec.exportedCount = WebexMerge.count(rec);
    });
    status("done", summary(file, got));
  } catch (e) {
    status("error", String(e && e.message || e));
  } finally {
    busy = false;
  }
}

async function exportCapture(session, opts) {
  try {
    var rec = ((await browser.storage.local.get("captures")).captures || {})[session];
    if (!rec) throw new Error("This chat is no longer stored.");
    var file = await build(rec, Object.assign({ when: rec.startedAt }, opts));
    if (!file.count) throw new Error("Nothing was captured from this chat.");
    if (!(await save(file))) return status("idle", "Export cancelled.", { session: session });
    await withCaptures(function (all) { if (all[session]) all[session].exportedCount = WebexMerge.count(all[session]); });
    status("done", summary(file, rec), { session: session });
  } catch (e) {
    status("error", String(e && e.message || e), { session: session });
  }
}

function discard(session) {
  return withCaptures(function (all) { delete all[session]; });
}

// drop old records; offer the ones a browser quit left unsaved
function startup() {
  return withCaptures(function (all) {
    var cutoff = Date.now() - KEEP_DAYS * 864e5;
    Object.keys(all).forEach(function (k) { if ((all[k].updatedAt || 0) < cutoff) delete all[k]; });
  }).then(function () { return remind(function () { return true; }); });
}

/* ---------- wiring --------------------------------------------------------- */

browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg) return;
  var tabId = sender && sender.tab ? sender.tab.id : null;
  switch (msg.type) {
    case "progress": status("running", msg.text); break;
    case "export": runExport(msg.tabId, msg.options || {}); break;
    case "capture": if (tabId != null) capture(msg.session, tabId, msg.data); break;
    case "captureEnded": remind(function (r) { return r.session === msg.session; }); break;
    case "exportCapture": exportCapture(msg.session, msg.options || {}); break;
    case "discardCapture": return discard(msg.session);
  }
});

browser.tabs.onRemoved.addListener(function (tabId) {
  remind(function (r) { return r.tabId === tabId; });
});

browser.runtime.onStartup.addListener(startup);
