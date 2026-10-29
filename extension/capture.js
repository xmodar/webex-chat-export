/*
 * Chat memory. Runs in the web.webex.com chat frame for the whole meeting.
 *
 * Webex drops old messages from a long chat: scrolling to the top no longer
 * brings them back. So this keeps every message the chat shows, in memory,
 * for as long as the meeting page is open, and the export adds them to what
 * it reads (see WebexChatScraper.memory). Nothing is stored on disk. It never
 * clicks or scrolls.
 *
 * Kept light on purpose: it watches only the side panel (not the whole
 * meeting UI), waits for changes to settle before reading, looks only in the
 * normal DOM, and parses only messages it hasn't seen yet. Your name and the
 * meeting title are read once.
 *
 * With the close reminder on, new messages are also sent to the background,
 * which keeps a copy so the chat can be exported if the tab closes first.
 */
/* global browser, WebexChatScraper */
(function () {
  "use strict";
  if (location.hostname !== "web.webex.com") return;
  // a newer copy (extension updated, or injected into an open meeting) takes over; the memory stays
  if (globalThis.__webexChatCapture) globalThis.__webexChatCapture.stop();

  var SETTLE_MS = 1000, CHECK_MS = 10000;
  var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var mem = WebexChatScraper.memory();
  var remind = false, dead = false;
  var observer = null, watched = null, settle = null, check = null;

  function send(type, data) {
    try {
      return browser.runtime.sendMessage({ type: type, session: session, data: data }).catch(function () {});
    } catch (e) {
      stop(); // extension reloaded or removed: this script is orphaned
    }
  }

  function read() {
    settle = null;
    if (dead) return;
    var snap = WebexChatScraper.readVisible({ known: mem.known, skipSelf: !!mem.self, skipMeeting: !!mem.meeting, shallow: true });
    var named = (snap.self && !mem.self) || (snap.meeting && !mem.meeting);
    if (!WebexChatScraper.remember(snap) && !named) return;
    if (remind) send("capture", snap);
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

  function apply(s) {
    var on = !!(s && s.enabled);
    // switched on mid-meeting: hand over everything kept so far
    if (on && !remind && mem.conversations.length) {
      send("capture", { meeting: mem.meeting, self: mem.self, conversations: mem.conversations });
    }
    remind = on;
    return Promise.resolve(true);
  }

  globalThis.__webexChatCapture = { stop: stop };
  attach();
  check = setInterval(attach, CHECK_MS);

  browser.runtime.onMessage.addListener(function (msg) {
    if (!dead && msg && msg.type === "captureState") return apply(msg);
  });
  try {
    browser.runtime.sendMessage({ type: "captureState?" }).then(apply, function () {});
  } catch (e) { /* orphaned */ }

  // leaving the meeting tears this frame down; let the background know
  addEventListener("pagehide", function () {
    if (dead || !remind) return;
    read();
    send("captureEnded");
  });
})();
