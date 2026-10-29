/*
 * Live capture for the close reminder. Only injected while the reminder is
 * on (see background.js); runs in the web.webex.com chat frame and hands new
 * chat messages to the background script. It never clicks or scrolls.
 *
 * Kept light on purpose: it watches only the side panel (not the whole
 * meeting UI), waits for changes to settle before reading, parses only
 * messages it hasn't sent yet, and sends just those.
 */
/* global browser, WebexChatScraper */
(function () {
  "use strict";
  if (location.hostname !== "web.webex.com" || globalThis.__webexChatCapture) return;
  globalThis.__webexChatCapture = true;

  var SETTLE_MS = 2000, CHECK_MS = 10000;
  var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var state = { enabled: false, skipSelf: false };
  var known = {}, haveMeeting = false, haveSelf = false;
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
    if (!state.enabled) return;
    var snap = WebexChatScraper.readVisible({ known: known, skipSelf: state.skipSelf || haveSelf, skipMeeting: haveMeeting });
    snap.conversations.forEach(function (c) { c.messages.forEach(function (m) { known[m.id] = true; }); });
    haveMeeting = haveMeeting || !!snap.meeting;
    haveSelf = haveSelf || !!snap.self;
    if (snap.conversations.length || snap.meeting || snap.self) send("capture", snap);
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

  function start() {
    if (check) return;
    attach();
    check = setInterval(attach, CHECK_MS);
  }

  function stop() {
    clearInterval(check); check = null;
    clearTimeout(settle); settle = null;
    if (observer) observer.disconnect();
    watched = null;
  }

  function apply(s) {
    state = { enabled: !!(s && s.enabled), skipSelf: !!(s && s.skipSelf) };
    if (state.enabled) start(); else { stop(); known = {}; haveMeeting = haveSelf = false; }
  }

  browser.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "captureState") apply(msg);
  });
  try {
    browser.runtime.sendMessage({ type: "captureState?" }).then(apply, function () {});
  } catch (e) { /* orphaned */ }

  // leaving the meeting tears this frame down; let the background know
  addEventListener("pagehide", function () {
    if (!state.enabled) return;
    read();
    send("captureEnded");
  });
})();
