/*
 * Webex meeting chat scraper. Injected into every frame of the meeting tab;
 * only the web.webex.com frame that hosts the chat answers.
 *
 *   await WebexChatScraper.run({ includeDirect: true, onProgress: fn })
 *     -> { found: true, meeting, self, conversations: [{ name, kind, participant, messages: [...] }] }
 *     -> { found: false } in frames without the chat
 * opts.myName, when set, is used as your name instead of reading the
 * participants list.
 *
 * Every lookup walks open shadow roots too, so it doesn't matter where in the
 * component tree Webex puts the panel.
 */
(function (root) {
  "use strict";

  var md = root.WebexMarkdown;

  /* ---------- shadow-piercing DOM helpers ------------------------------ */

  // Walking every shadow root means visiting the whole meeting UI, so it is
  // the fallback: lookups try the normal DOM first (where Webex keeps the
  // chat today), and the list of shadow roots is reused for a second.
  var rootCache = { at: 0, list: null };

  function roots(start) {
    if (start === document && rootCache.list && Date.now() - rootCache.at < 1000) return rootCache.list;
    var out = [start], stack = [start];
    while (stack.length) {
      var r = stack.pop(), all = r.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) { out.push(all[i].shadowRoot); stack.push(all[i].shadowRoot); }
      }
    }
    if (start === document) rootCache = { at: Date.now(), list: out };
    return out;
  }

  function $(sel, start) {
    start = start || document;
    var hit = start.querySelector(sel);
    if (hit) return hit;
    var rs = roots(start);
    for (var i = 1; i < rs.length; i++) {
      hit = rs[i].querySelector(sel);
      if (hit) return hit;
    }
    return null;
  }

  function $$(sel, start) {
    start = start || document;
    var out = Array.prototype.slice.call(start.querySelectorAll(sel));
    if (out.length) return out;
    roots(start).slice(1).forEach(function (r) {
      out.push.apply(out, r.querySelectorAll(sel));
    });
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function waitFor(fn, timeout) {
    var end = Date.now() + (timeout || 5000), v;
    while (!(v = fn())) {
      if (Date.now() > end) return null;
      await sleep(100);
    }
    return v;
  }

  function text(el) { return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : ""; }

  /* ---------- parsing one list item ------------------------------------ */

  // "Message from NAME, DOMAIN-OR-STATUS, 2:01 PM, TEXT"
  var LABEL = /^Message from (.+?), ([^,]*), (\d{1,2}:\d{2}\s*[AP]M)/i;

  function to24h(t) {
    var m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(t || "");
    if (!m) return "";
    var h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return (h < 10 ? "0" : "") + h + ":" + m[2];
  }

  function reactions(item) {
    return $$('[data-test="reaction-summary"] [data-count]', item).map(function (b) {
      var m = /^(\d+)\s+(.+?)\s+reaction/i.exec(b.getAttribute("aria-label") || "");
      return { name: m ? m[2] : (b.getAttribute("data-test") || "").replace(/^reaction-/, ""),
               count: parseInt(b.getAttribute("data-count"), 10) || (m ? +m[1] : 1) };
    });
  }

  function parseMessage(item) {
    if (item.getAttribute("data-test") === "system-message") {
      var val = item.querySelector(".value"), date = item.querySelector(".system-message-date");
      var t = text(date), all = text(val);
      return { id: item.id, kind: "system", user: "", time: to24h(t),
               text: all.slice(0, all.length - t.length).trim() || all };
    }

    var body = item.querySelector('[data-test="activity-item-message"]');
    if (!body) return null;

    var label = LABEL.exec(item.getAttribute("aria-label") || "") || [];
    var senderEl = item.querySelector(".sender-name");
    var user = text(senderEl) || (label[1] || "").trim();
    var time = to24h(text(item.querySelector(".sent-date")) || label[3]);

    // a "Quote message" puts the quoted message in a blockquote ahead of the new text
    var clone = body.cloneNode(true), quote = null;
    var bq = clone.querySelector("blockquote.messageQuote");
    if (bq) {
      var from = bq.querySelector("mdc-text");
      var qUser = text(from).replace(/^Quoted from\s+/i, "");
      if (from) from.remove();
      bq.querySelectorAll("mdc-linkbutton").forEach(function (b) { b.remove(); });
      quote = { user: qUser, text: md.toMarkdown(bq) };
      bq.remove();
    }

    return {
      id: item.id,
      kind: item.classList.contains("activity--reply") ? "reply" : "message",
      user: user,
      mine: !!(senderEl && senderEl.classList.contains("is-my-message")) || user === "You",
      time: time,
      text: md.toMarkdown(clone),
      plain: (clone.innerText != null ? clone.innerText : clone.textContent).trim(),
      quote: quote,
      reactions: reactions(item)
    };
  }

  /* ---------- reading one conversation --------------------------------- */

  function listItems(panel) {
    var list = panel.querySelector("mdc-list.activity-list-listcomponent") || $("mdc-list.activity-list-listcomponent", panel);
    return list ? Array.prototype.filter.call(list.children, function (c) {
      return c.tagName === "MDC-LISTITEM" && c.id;
    }) : [];
  }

  function scroller(panel) {
    return panel.querySelector(".space-body") || $(".space-body", panel);
  }

  // Webex may virtualize the list, so each pass only sees a window of it
  function merge(order, seen, items) {
    WebexMerge.mergeOrdered(order, seen, items.map(parseMessage));
  }

  async function readConversation(panel) {
    var box = scroller(panel), order = [], seen = {};
    // put the chat back where it was, measured from the bottom (new messages may arrive meanwhile)
    var fromBottom = box ? box.scrollHeight - box.scrollTop : 0;

    if (box) {
      // pull older history in: keep jumping to the top until nothing new loads
      var stable = 0, count = -1;
      for (var i = 0; i < 60 && stable < 3; i++) {
        box.scrollTop = 0;
        await sleep(250);
        var n = listItems(panel).length;
        stable = (n === count && box.scrollTop === 0) ? stable + 1 : 0;
        count = n;
      }
      // then walk down one screen at a time, collecting as we go
      for (var guard = 0; guard < 2000; guard++) {
        merge(order, seen, listItems(panel));
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break;
        box.scrollTop += Math.max(100, box.clientHeight * 0.8);
        await sleep(120);
      }
    }
    merge(order, seen, listItems(panel));
    if (box) box.scrollTop = box.scrollHeight - fromBottom;
    return WebexMerge.linkReplies(order.map(function (id) { return seen[id]; }));
  }

  // the part of a rendered list that `known` hasn't seen yet, starting one
  // message early so the receiver knows where the new ones go
  function unseen(items, known) {
    if (!known) return items;
    for (var i = 0; i < items.length && known[items[i].id]; i++);
    return i === items.length ? [] : items.slice(Math.max(0, i - 1));
  }

  /* What is on screen right now, without clicking or scrolling anything:
     the Everyone list and/or the open direct chat. Used by the live capture.
     opts.known ({ id: true }) limits the parsing to messages not sent before;
     opts.skipSelf leaves the participants list alone; opts.skipMeeting the title. */
  function readVisible(opts) {
    opts = opts || {};
    var out = [], everyone = document.getElementById("everyone-tabpanel") || $("#everyone-tabpanel");
    var direct = document.getElementById("direct-tabpanel") || $("#direct-tabpanel");
    function add(panel, conv) {
      var items = unseen(listItems(panel), opts.known);
      if (!items.length) return;
      conv.messages = WebexMerge.linkReplies(items.map(parseMessage).filter(Boolean));
      out.push(conv);
    }
    if (everyone) add(everyone, { name: "Everyone", kind: "everyone", participant: "" });
    if (direct && direct.querySelector("#direct-chat-back-button")) {
      var who = text(direct.querySelector(".direct-chat-header mdc-text"));
      if (who) add(direct, { name: "Direct: " + who, kind: "direct", participant: who });
    }
    return { meeting: opts.skipMeeting ? "" : meetingName(), self: opts.skipSelf ? "" : selfFromList(), conversations: out };
  }

  /* ---------- driving the chat panel ----------------------------------- */

  async function ensureChatOpen() {
    if ($("#everyone-tab")) return true;
    var toggle = $("#in-meeting-chat-toggle-button");
    if (!toggle) return false;
    toggle.click();
    return !!(await waitFor(function () { return $("#everyone-tab"); }, 5000));
  }

  async function selectTab(name) {
    var tab = $("#" + name + "-tab");
    if (!tab) return null;
    if (tab.getAttribute("aria-selected") !== "true") tab.click();
    return waitFor(function () {
      var p = $("#" + name + "-tabpanel");
      return p && p.isConnected ? p : null;
    }, 5000);
  }

  function directList() {
    var list = $('#direct-tabpanel mdc-list[aria-label="Recent Direct Messages"]');
    return list ? Array.prototype.filter.call(list.children, function (c) { return c.tagName === "MDC-LISTITEM"; }) : [];
  }

  async function backToDirectList() {
    var back = $("#direct-chat-back-button");
    if (back) back.click();
    return waitFor(function () { return !$("#direct-chat-back-button") && $("#direct-tabpanel"); }, 5000);
  }

  // Your own display name: the participants list puts you first, tagged "Me".
  // The panel shares the side bar with the chat, so it is opened just long
  // enough to read it.
  function selfFromList() {
    var items = $$('[data-test="participant-list-item"]');
    if (!items.length) return "";
    var me = items.filter(function (it) {
      var sub = it.querySelector('[id^="participant-secondary-text-"]');
      return sub && /(^|[\s,])Me([\s,]|$)/.test(text(sub));
    })[0] || items[0];
    var name = me.querySelector('[data-test="participant-name-wrapper"]');
    return (name && (name.getAttribute("aria-label") || text(name))) ||
      (me.getAttribute("aria-label") || "").split(",")[0].trim();
  }

  async function selfName() {
    var name = selfFromList();
    if (name) return name;
    var toggle = $('[data-test="participants-toggle-button"]');
    if (!toggle) return "";
    toggle.click();
    name = await waitFor(selfFromList, 4000) || "";
    if ($('[data-test="participant-list-item"]') && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    return name;
  }

  function meetingName() {
    var ed = $('#everyone-tabpanel .ql-editor[aria-label^="Write a message to "]');
    return ed ? ed.getAttribute("aria-label").replace(/^Write a message to\s+/, "") : "";
  }

  async function run(opts) {
    opts = opts || {};
    var progress = opts.onProgress || function () {};
    if (location.hostname !== "web.webex.com" && !$("#everyone-tab") && !$("#in-meeting-chat-toggle-button")) {
      return { found: false };
    }
    var participantsOpen = !!$('[data-test="participant-list-item"]');
    // a name chosen in the options is used as is: no need to open the participants list
    var self = (opts.myName || "").trim();
    if (!self) {
      progress("Looking up your name…");
      self = await selfName();
    }
    if (!(await ensureChatOpen())) return { found: false, error: "Could not open the chat panel." };

    var startedOn = $("#direct-tab[aria-selected='true']") ? "direct" : "everyone";
    var conversations = [];

    progress("Reading Everyone chat…");
    var everyone = await selectTab("everyone");
    if (!everyone) return { found: true, error: "Everyone chat did not open." };
    var meeting = meetingName();
    conversations.push({ name: "Everyone", kind: "everyone", participant: "", messages: await readConversation(everyone) });

    if (opts.includeDirect !== false && await selectTab("direct")) {
      await backToDirectList();
      var people = await waitFor(function () { var l = directList(); return l.length ? l : null; }, 1500) || [];
      for (var i = 0; i < people.length; i++) {
        var entry = directList()[i];
        if (!entry) break;
        var who = entry.getAttribute("label") || text(entry);
        progress("Reading direct chat " + (i + 1) + "/" + people.length + ": " + who + "…");
        entry.click();
        var panel = await waitFor(function () {
          return $("#direct-chat-back-button") && $("#direct-tabpanel");
        }, 5000);
        if (!panel) continue;
        await waitFor(function () { return listItems(panel).length; }, 3000);
        var header = panel.querySelector(".direct-chat-header mdc-text");
        conversations.push({
          name: "Direct: " + (text(header) || who), kind: "direct", participant: text(header) || who,
          messages: await readConversation(panel)
        });
        await backToDirectList();
      }
    }

    await selectTab(startedOn);
    if (participantsOpen && !$('[data-test="participant-list-item"]')) {
      var toggle = $('[data-test="participants-toggle-button"]');
      if (toggle) toggle.click(); // put the side bar back the way it was
    }
    return { found: true, meeting: meeting, self: self, conversations: conversations };
  }

  root.WebexChatScraper = {
    run: run, parseMessage: parseMessage, readConversation: readConversation, selfFromList: selfFromList,
    readVisible: readVisible
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
