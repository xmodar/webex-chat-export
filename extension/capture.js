/*
 * Saves the chat as the meeting goes. Runs in the web.webex.com chat frame
 * of every meeting and sends the background the messages the chat shows,
 * which keeps them in the meeting's saved chat. That way the saved chat has
 * every message, even the ones Webex later drops from a long chat. It never
 * clicks or scrolls.
 *
 * Kept light on purpose: it watches only the side panel (not the whole
 * meeting UI), reads at most once a second after a change, looks only in the
 * normal DOM, and parses and sends only messages it hasn't sent yet. Your
 * name and the meeting title are read once.
 */
/* global browser, WebexChatScraper */
(function () {
  "use strict";
  if (location.hostname !== "web.webex.com") return;
  // a newer copy (extension updated, or injected into an open meeting) takes over
  var prev = globalThis.__webexChatCapture;
  if (prev) prev.stop();

  var SETTLE_MS = 1000, CHECK_MS = 10000;
  var page = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var known = (prev && prev.known) || {}, meeting = (prev && prev.meeting) || "", self = (prev && prev.self) || "";
  var dead = false, observer = null, watched = null, settle = null, check = null;

  function send(type, data) {
    try {
      return browser.runtime.sendMessage({ type: type, page: page, data: data }).catch(function () {});
    } catch (e) {
      stop(); // extension reloaded or removed: this script is orphaned
    }
  }

  function read() {
    settle = null;
    if (dead) return;
    var snap = WebexChatScraper.readVisible({ known: known, skipSelf: !!self, skipMeeting: !!meeting, shallow: true });
    var fresh = 0;
    snap.conversations.forEach(function (c) {
      c.messages.forEach(function (m) { if (!known[m.id]) { known[m.id] = true; fresh++; } });
    });
    var named = (snap.self && !self) || (snap.meeting && !meeting);
    self = self || snap.self;
    meeting = meeting || snap.meeting;
    if (!fresh && !named) return;
    snap.meeting = meeting; // every snapshot says which meeting it is from
    send("capture", snap);
  }

  function changed() {
    if (!settle) settle = setTimeout(read, SETTLE_MS);
  }

  // the side panel comes and goes (closed, switched to participants): re-find it now and then
  function attach() {
    var panel = document.getElementById("meeting-panel-container");
    if (panel === watched) return;
    if (observer) observer.disconnect();
    watched = panel;
    if (panel) {
      observer = observer || new MutationObserver(changed);
      observer.observe(panel, { childList: true, subtree: true });
      changed();
    }
  }

  function stop() {
    dead = true;
    clearInterval(check); check = null;
    clearTimeout(settle); settle = null;
    if (observer) observer.disconnect();
    watched = null;
  }

  globalThis.__webexChatCapture = {
    stop: stop,
    get known() { return known; }, get meeting() { return meeting; }, get self() { return self; }
  };
  // 1.4 kept the chat only in the page: hand it over to be saved
  var mem = globalThis.WebexChatMemory;
  if (mem && mem.conversations && mem.conversations.length) {
    delete globalThis.WebexChatMemory;
    meeting = meeting || mem.meeting || "";
    self = self || mem.self || "";
    mem.conversations.forEach(function (c) { c.messages.forEach(function (m) { known[m.id] = true; }); });
    send("capture", { meeting: meeting, self: self, conversations: mem.conversations });
  }
  attach();
  check = setInterval(attach, CHECK_MS);

  // leaving the meeting tears this frame down: send the last messages
  addEventListener("pagehide", function () {
    if (dead) return;
    read();
    send("pageClosed");
  });
})();
