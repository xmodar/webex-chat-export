/*
 * Merging partial views of a chat into one ordered list.
 *
 * Webex may only render part of a conversation at a time, and the live
 * capture sees the chat in many snapshots, so messages arrive as windows of
 * the list. Each window is in display order; unknown ids are inserted after
 * the last known id that precedes them.
 */
(function (root) {
  "use strict";

  /* order: [id], byId: {id: msg}, msgs: parsed messages in display order */
  function mergeOrdered(order, byId, msgs) {
    var prev = -1;
    msgs.forEach(function (m) {
      if (!m || !m.id) return;
      if (byId[m.id] !== undefined) {
        prev = order.indexOf(m.id);
        byId[m.id] = m; // newer copy (reactions, edits)
        return;
      }
      byId[m.id] = m;
      order.splice(prev + 1, 0, m.id);
      prev++;
    });
  }

  // replies are rendered right under the message that started the thread
  function linkReplies(msgs) {
    var parent = null;
    msgs.forEach(function (m) {
      if (m.kind === "message") parent = m;
      else if (m.kind === "reply" && parent) m.replyTo = parent.id;
    });
    return msgs;
  }

  function convKey(c) { return c.kind === "direct" ? "direct:" + c.participant : c.kind; }

  /* Merge scrape results ({ meeting, self, conversations }) into `into`, in place. */
  function mergeResult(into, add) {
    into.meeting = add.meeting || into.meeting || "";
    into.self = add.self || into.self || "";
    into.conversations = into.conversations || [];
    (add.conversations || []).forEach(function (c) {
      var key = convKey(c), have = null;
      into.conversations.forEach(function (x) { if (convKey(x) === key) have = x; });
      if (!have) {
        have = { name: c.name, kind: c.kind, participant: c.participant || "", messages: [] };
        // Everyone first, then direct chats in the order they were seen
        if (c.kind === "everyone") into.conversations.unshift(have); else into.conversations.push(have);
      }
      var order = have.messages.map(function (m) { return m.id; }), byId = {};
      have.messages.forEach(function (m) { byId[m.id] = m; });
      mergeOrdered(order, byId, c.messages);
      have.messages = linkReplies(order.map(function (id) { return byId[id]; }));
    });
    return into;
  }

  function count(result) {
    return (result.conversations || []).reduce(function (n, c) { return n + c.messages.length; }, 0);
  }

  var api = { mergeOrdered: mergeOrdered, linkReplies: linkReplies, mergeResult: mergeResult, count: count };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WebexMerge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
