/*
 * Background: keeps the saved chats and runs exports.
 *
 * - Saving: capture.js, in every Webex meeting page, sends the chat messages
 *   it sees. They are merged into one saved chat per meeting, in
 *   storage.local on this computer, until the person deletes it. A page
 *   reload in the same meeting goes on with the same saved chat.
 * - Export of an open meeting: injects the scraper into every frame of the
 *   tab, reads the whole chat (scrolling it, opening every direct chat), adds
 *   it to the meeting's saved chat and exports that. The saved chat also has
 *   the messages Webex has dropped from a long chat.
 * - Export of a saved chat: from the "Saved chats" page, any time.
 *
 * Storage: "chat:<id>" holds one chat ({ id, meeting, self, startedAt,
 * updatedAt, exportedAt, conversations }); "chatIndex" holds a short summary
 * of each, so listing them doesn't read every message.
 */
/* global browser, WebexExport, WebexMerge */
// Chrome runs this as a service worker (no manifest script list), Firefox as an event page
if (typeof importScripts === "function") {
  importScripts("vendor/browser-polyfill.min.js", "lib/xlsx.js", "lib/merge.js", "lib/export.js");
}

var busy = false;
var SAME_MEETING_MS = 3 * 3600e3; // a reload this soon after, in a meeting of the same name, is the same meeting
var FLUSH_MS = 5000;
var CAPTURE_FILES = ["vendor/browser-polyfill.min.js", "lib/markdown.js", "lib/merge.js", "lib/scrape.js", "capture.js"];

function status(state, text, extra) {
  var s = Object.assign({ state: state, text: text, at: Date.now() }, extra || {});
  if (!s.chat) browser.storage.session.set({ status: s });
  browser.runtime.sendMessage({ type: "status", status: s }).catch(function () {}); // no page may be open
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

function build(chat, opts) {
  var result = {
    meeting: chat.meeting, self: chat.self,
    conversations: chat.conversations.filter(function (c) { return c.kind === "everyone" || opts.includeDirect !== false; })
  };
  opts = Object.assign({ when: chat.startedAt }, opts);
  return opts.format === "json" ? WebexExport.buildJsonFile(result, opts) : WebexExport.buildXlsxFile(result, opts);
}

function summary(file, chat) {
  var convs = chat.conversations.filter(function (c) { return c.messages.length; }).length;
  return file.count + " messages from " + convs + " conversation" + (convs === 1 ? "" : "s") + " saved as " + file.name;
}

/* ---------- saved chats ------------------------------------------------- */

// one change to the store at a time
var queue = Promise.resolve();
function locked(fn) {
  var run = queue.then(fn);
  queue = run.catch(function () {});
  return run;
}

function key(id) { return "chat:" + id; }

async function getIndex() { return (await browser.storage.local.get("chatIndex")).chatIndex || {}; }

async function getChat(id) { return (await browser.storage.local.get(key(id)))[key(id)] || null; }

function newChat(meeting) {
  var now = Date.now();
  return { id: now.toString(36) + Math.random().toString(36).slice(2, 6), meeting: meeting || "", self: "",
           startedAt: now, updatedAt: now, exportedAt: 0, conversations: [] };
}

function entry(chat) {
  return {
    id: chat.id, meeting: chat.meeting, startedAt: chat.startedAt, updatedAt: chat.updatedAt, exportedAt: chat.exportedAt || 0,
    count: WebexMerge.count(chat),
    conversations: chat.conversations.map(function (c) { return { name: c.name, count: c.messages.length }; })
  };
}

// writes the chats and their index entries together
async function store(chats) {
  var index = await getIndex(), out = { chatIndex: index };
  chats.forEach(function (c) { out[key(c.id)] = c; index[c.id] = entry(c); });
  await browser.storage.local.set(out);
}

/* Which saved chat a meeting page belongs to. Pages (capture sessions) and
   tabs are remembered in storage.session, which outlives a Chrome service
   worker but not the browser. */
async function links() {
  var o = await browser.storage.session.get({ pages: {}, tabs: {} });
  return { pages: o.pages, tabs: o.tabs };
}

async function chatFor(l, page, tabId, meeting) {
  var id = (page && l.pages[page]) || null;
  var chat = id && await getChat(id);
  if (!chat && tabId != null && l.tabs[tabId]) {
    // a reload of the same meeting in the same tab
    var prev = await getChat(l.tabs[tabId]);
    if (prev && (!meeting || !prev.meeting || prev.meeting === meeting) && Date.now() - prev.updatedAt < SAME_MEETING_MS) chat = prev;
  }
  if (!chat && meeting) {
    // the same meeting rejoined (another tab, or after a browser restart)
    var index = await getIndex();
    var hit = Object.keys(index).map(function (k) { return index[k]; }).filter(function (e) {
      return e.meeting === meeting && Date.now() - e.updatedAt < SAME_MEETING_MS;
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0];
    chat = hit && await getChat(hit.id);
  }
  if (!chat) chat = newChat(meeting);
  if (page) l.pages[page] = chat.id;
  if (tabId != null) l.tabs[tabId] = chat.id;
  return chat;
}

/* Messages from capture.js are buffered and written together every few
   seconds, instead of rewriting the store on every message. */
var buffer = {}, flushTimer = null;

function capture(page, tabId, snap) {
  var b = buffer[page] || (buffer[page] = { tabId: tabId, snaps: [] });
  b.snaps.push(snap);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  var pending = buffer;
  buffer = {};
  if (!Object.keys(pending).length) return queue;
  return locked(async function () {
    var l = await links(), chats = {};
    for (var page in pending) {
      var p = pending[page];
      var meeting = p.snaps.map(function (s) { return s.meeting; }).filter(Boolean)[0] || "";
      var chat = await chatFor(l, page, p.tabId, meeting);
      chat = chats[chat.id] || chat;
      p.snaps.forEach(function (s) { WebexMerge.mergeResult(chat, s); });
      chat.updatedAt = Date.now();
      chats[chat.id] = chat;
    }
    await store(Object.keys(chats).map(function (k) { return chats[k]; }));
    await browser.storage.session.set(l);
  });
}

function deleteChats(ids) {
  return flush().then(function () { return locked(async function () {
    var index = await getIndex();
    ids.forEach(function (id) { delete index[id]; });
    await browser.storage.local.remove(ids.map(key));
    await browser.storage.local.set({ chatIndex: index });
  }); });
}

/* ---------- exports ------------------------------------------------------ */

async function runExport(tabId, opts) {
  if (busy) return status("error", "An export is already running.");
  busy = true;
  try {
    status("running", "Looking for the chat…");
    await flush();
    var l = await links();
    var known = l.tabs[tabId] ? await getChat(l.tabs[tabId]) : null;
    var target = { tabId: tabId, allFrames: true };
    await browser.scripting.executeScript({
      target: target, files: ["vendor/browser-polyfill.min.js", "lib/markdown.js", "lib/merge.js", "lib/scrape.js"]
    });
    var results = await browser.scripting.executeScript({
      target: target,
      // your name is looked up once per meeting: a saved chat already knows it
      args: [{ includeDirect: opts.includeDirect, myName: opts.myName || (known && known.self) || "" }],
      func: function (o) {
        if (!globalThis.WebexChatScraper) return { found: false };
        o.onProgress = function (t) { browser.runtime.sendMessage({ type: "progress", text: t }).catch(function () {}); };
        return globalThis.WebexChatScraper.run(o).catch(function (e) { return { found: true, error: String(e && e.message || e) }; });
      }
    });

    var hits = results.map(function (r) { return r.result; }).filter(function (r) { return r && r.found; });
    var got = hits.filter(function (r) { return !r.error; })[0];
    if (!got) throw new Error(hits.length ? hits[0].error : "No Webex meeting chat found in this tab. Join the meeting in the browser first.");
    if (opts.myName) delete got.self; // a chosen name is not the detected one

    // add what was read to the meeting's saved chat, and export all of it
    var chat = await locked(async function () {
      var l2 = await links(), c = await chatFor(l2, null, tabId, got.meeting);
      WebexMerge.mergeResult(c, got);
      c.updatedAt = Date.now();
      await store([c]);
      await browser.storage.session.set(l2);
      return c;
    });
    await exportChat(chat, opts);
  } catch (e) {
    status("error", String(e && e.message || e));
  } finally {
    busy = false;
  }
}

/* Export a saved chat (an object, or its id). */
async function exportChat(chat, opts, extra) {
  if (typeof chat === "string") {
    await flush();
    chat = await getChat(chat);
    if (!chat) throw new Error("This chat is no longer saved.");
  }
  var file = await build(chat, opts);
  if (!file.count) throw new Error("The chat has no messages yet.");
  status("running", "Choose where to save " + file.name + "…", extra);
  if (!(await save(file))) return status("idle", "Export cancelled.", extra);
  await locked(async function () {
    var c = await getChat(chat.id);
    if (!c) return;
    c.exportedAt = Date.now();
    await store([c]);
  });
  status("done", summary(file, chat), extra);
}

function exportSaved(id, opts) {
  var extra = { chat: id };
  return exportChat(id, opts, extra).catch(function (e) { status("error", String(e && e.message || e), extra); });
}

/* ---------- install and update -------------------------------------------- */

async function installed() {
  // up to 1.4 there was a close reminder with its own store: keep its chats
  var old = await browser.storage.local.get({ captures: null });
  if (old.captures) {
    await locked(function () {
      return store(Object.keys(old.captures).map(function (k) {
        var r = old.captures[k];
        return { id: "c" + k, meeting: r.meeting || "", self: r.self || "", startedAt: r.startedAt || Date.now(),
                 updatedAt: r.updatedAt || r.startedAt || Date.now(), exportedAt: r.exportedCount ? r.updatedAt || 1 : 0,
                 conversations: r.conversations || [] };
      }).filter(function (c) { return WebexMerge.count(c); }));
    });
  }
  await browser.storage.local.remove(["captures", "autoCapture"]);
  // 1.3 registered the capture script itself; it is in the manifest now
  var reg = await browser.scripting.getRegisteredContentScripts({ ids: ["capture"] }).catch(function () { return []; });
  if (reg.length) await browser.scripting.unregisterContentScripts({ ids: ["capture"] }).catch(function () {});
  // meetings that were already open: start saving them now
  var tabs = await browser.tabs.query({ url: "https://*.webex.com/*" });
  tabs.forEach(function (t) {
    browser.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: CAPTURE_FILES }).catch(function () {});
  });
}

/* ---------- wiring --------------------------------------------------------- */

browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg) return;
  var tabId = sender && sender.tab ? sender.tab.id : null;
  switch (msg.type) {
    case "progress": status("running", msg.text); break;
    case "export": runExport(msg.tabId, msg.options || {}); break;
    case "capture": if (tabId != null) capture(msg.page, tabId, msg.data); break;
    case "pageClosed": flush(); break;
    case "exportChat": exportSaved(msg.id, msg.options || {}); break;
    case "deleteChats": return deleteChats(msg.ids || []);
    case "getChat": return flush().then(function () { return getChat(msg.id); });
  }
});

browser.tabs.onRemoved.addListener(function (tabId) {
  flush().then(function () { return locked(async function () {
    var l = await links();
    if (l.tabs[tabId] === undefined) return;
    delete l.tabs[tabId];
    await browser.storage.session.set(l);
  }); });
});

browser.runtime.onInstalled.addListener(installed);
