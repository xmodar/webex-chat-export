/*
 * Live capture: runs in the web.webex.com frames for the whole meeting and,
 * every few seconds, hands whatever chat is on screen to the background
 * script. It never clicks or scrolls. If the tab is closed before an export,
 * the background script offers to export what was captured.
 *
 * It only runs while capture is on for this tab: the "remind me" default in
 * the options, or the per-meeting switch in the popup. The background script
 * answers "captureState" and pushes changes.
 */
/* global browser, WebexChatScraper */
(function () {
  "use strict";
  if (globalThis.__webexChatCapture) return;
  globalThis.__webexChatCapture = true;

  var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var last = "", timer = null, state = { enabled: false, skipSelf: false };

  function send(type, data) {
    try {
      return browser.runtime.sendMessage({ type: type, session: session, data: data }).catch(function () {});
    } catch (e) {
      stop(); // extension reloaded or removed: this script is orphaned
    }
  }

  function tick() {
    if (!state.enabled) return;
    var sig = WebexChatScraper.visibleSignature();
    if (sig === last) return;
    last = sig;
    // with a name set in the options there is no need to read the participants list
    var snap = WebexChatScraper.readVisible({ skipSelf: state.skipSelf });
    if (snap.conversations.length || snap.self) send("capture", snap);
  }

  function stop() { clearInterval(timer); timer = null; }

  function apply(s) {
    state = { enabled: !!(s && s.enabled), skipSelf: !!(s && s.skipSelf) };
    if (state.enabled && !timer) { last = ""; timer = setInterval(tick, 3000); setTimeout(tick, 1000); }
    if (!state.enabled) stop();
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
    tick();
    send("captureEnded");
  });
})();
