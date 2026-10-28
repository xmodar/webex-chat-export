/*
 * Live capture: runs in the web.webex.com frames for the whole meeting and,
 * every few seconds, hands whatever chat is on screen to the background
 * script. It never clicks or scrolls. If the tab is closed before an export,
 * the background script offers to export what was captured.
 */
/* global browser, WebexChatScraper */
(function () {
  "use strict";
  if (globalThis.__webexChatCapture) return;
  globalThis.__webexChatCapture = true;

  var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var last = "", timer = null;

  function send(type, data) {
    try {
      return browser.runtime.sendMessage({ type: type, session: session, data: data }).catch(function () {});
    } catch (e) {
      clearInterval(timer); // extension reloaded or removed: this script is orphaned
    }
  }

  function tick() {
    var sig = WebexChatScraper.visibleSignature();
    if (sig === last) return;
    last = sig;
    var snap = WebexChatScraper.readVisible();
    if (snap.conversations.length || snap.self) send("capture", snap);
  }

  timer = setInterval(tick, 3000);
  setTimeout(tick, 1000);
  // leaving the meeting tears this frame down; let the background know
  addEventListener("pagehide", function () { tick(); send("captureEnded"); });
})();
