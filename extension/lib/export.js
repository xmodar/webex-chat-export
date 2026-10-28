/*
 * Scrape result -> export files (one XLSX sheet, or JSON).
 *
 * Messages are numbered across all conversations (column "no") so replies
 * and quotes can point at the message they answer.
 */
(function (root) {
  "use strict";

  var Xlsx = root.WebexXlsx || (typeof require === "function" ? require("./xlsx.js") : null);

  function today(tz, when) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(when ? new Date(when) : new Date()); // en-CA formats as YYYY-MM-DD
    } catch (e) {
      return (when ? new Date(when) : new Date()).toISOString().slice(0, 10);
    }
  }

  function localZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  }

  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  var RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

  // right-to-left when most messages are written in an RTL script
  function mostlyRtl(messages) {
    var rtl = 0, n = 0;
    messages.forEach(function (m) {
      if (m.kind === "system" || !m.text) return;
      n++;
      if (RTL_CHAR.test(m.text)) rtl++;
    });
    return n > 0 && rtl * 2 > n;
  }

  /* Flatten conversations into numbered messages with resolved links.
     "You" becomes opts.myName when set, else the name found in the
     participants list (result.self), else it stays "You". */
  function normalize(result, opts) {
    opts = opts || {};
    var timezone = opts.timezone || localZone();
    var date = opts.date || today(timezone, opts.when); // when: the meeting time, for a capture exported later
    var me = (opts.myName || "").trim() || (result.self || "").trim();
    function who(u) { return me && u === "You" ? me : u; }

    var no = 0, byId = {}, out = [];
    result.conversations.forEach(function (conv) {
      var earlier = [];
      var participant = who(conv.participant);
      var convName = conv.kind === "direct" ? "Direct: " + participant : conv.name;
      conv.messages.forEach(function (m) {
        var row = {
          no: ++no,
          id: m.id,
          conversation: convName,
          kind: m.kind,
          time: m.time,
          user: who(m.user),
          text: m.text,
          plain: m.plain || m.text,
          replyTo: null,
          quote: null,
          reactions: m.reactions || []
        };
        if (m.replyTo && byId[m.replyTo]) {
          row.replyTo = { no: byId[m.replyTo].no, user: byId[m.replyTo].user };
        }
        if (m.quote) {
          var qUser = who(m.quote.user), qText = norm(m.quote.text), hit = null;
          // "Quoted from X" doesn't say which message: match X's earlier messages by text
          for (var i = earlier.length - 1; i >= 0 && !hit; i--) {
            if (earlier[i].user === qUser && norm(earlier[i].text) === qText) hit = earlier[i];
          }
          row.quote = { no: hit ? hit.no : null, user: qUser, text: m.quote.text };
        }
        byId[m.id] = row;
        if (m.kind !== "system") earlier.push(row);
        out.push(row);
      });
    });
    return { date: date, timezone: timezone, self: me, messages: out, who: who };
  }

  // the sheet is named after the date, so the first column only holds the time
  var COLUMNS = [
    { key: "timestamp", header: "timestamp", width: 10 },
    { key: "user", header: "user", width: 26 },
    { key: "text", header: "text", width: 80 },
    { key: "conversation", header: "conversation", width: 22 },
    { key: "no", header: "no", width: 6 },
    { key: "kind", header: "type", width: 9 },
    { key: "reply_to", header: "reply_to", width: 9 },
    { key: "reply_to_user", header: "reply_to_user", width: 22 },
    { key: "quote_of", header: "quote_of", width: 9 },
    { key: "quoted_user", header: "quoted_user", width: 22 },
    { key: "quoted_text", header: "quoted_text", width: 50 },
    { key: "reactions", header: "reactions", width: 18 }
  ];

  function toRow(m) {
    return {
      timestamp: m.time, user: m.user, text: m.text, conversation: m.conversation, no: m.no, kind: m.kind,
      reply_to: m.replyTo ? m.replyTo.no : "", reply_to_user: m.replyTo ? m.replyTo.user : "",
      quote_of: m.quote && m.quote.no ? m.quote.no : "", quoted_user: m.quote ? m.quote.user : "",
      quoted_text: m.quote ? m.quote.text : "",
      reactions: m.reactions.map(function (r) { return r.name + " ×" + r.count; }).join(", ")
    };
  }

  async function buildXlsxFile(result, opts) {
    var n = normalize(result, opts);
    var bytes = await Xlsx.buildXlsx({
      sheetName: n.date,
      rtl: opts && (opts.direction === "rtl" || opts.direction === "ltr")
        ? opts.direction === "rtl" : mostlyRtl(n.messages),
      columns: COLUMNS,
      rows: n.messages.map(function (m) {
        var r = toRow(m);
        return COLUMNS.map(function (c) { return r[c.key]; });
      })
    });
    return { name: "chat-" + n.date + ".xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             bytes: bytes, count: n.messages.length };
  }

  /* Compact JSON: messages nested under their conversation (so the
     conversation name isn't repeated), times without the date (it's given
     once at the top), and fields left out when they hold their default:
     type "message", no reply, no quote, no reactions. */
  function compactMessage(m) {
    var o = { no: m.no, time: m.time, user: m.user, text: m.text };
    if (m.kind !== "message") o.type = m.kind;
    if (m.replyTo) o.replyTo = m.replyTo.no;
    if (m.quote) {
      o.quote = { user: m.quote.user, text: m.quote.text };
      if (m.quote.no) o.quote.no = m.quote.no;
    }
    if (m.reactions.length) {
      o.reactions = {};
      m.reactions.forEach(function (r) { o.reactions[r.name] = r.count; });
    }
    return o;
  }

  function buildJsonFile(result, opts) {
    var n = normalize(result, opts), at = 0;
    var doc = {
      meeting: result.meeting || "",
      date: n.date,
      timezone: n.timezone,
      you: n.self || "You",
      exportedAt: new Date().toISOString(),
      conversations: result.conversations.map(function (c) {
        var conv = { name: c.kind === "direct" ? "Direct: " + n.who(c.participant) : c.name, kind: c.kind };
        if (c.participant) conv.participant = n.who(c.participant);
        conv.messages = n.messages.slice(at, at += c.messages.length).map(compactMessage);
        return conv;
      })
    };
    var bytes = new TextEncoder().encode(JSON.stringify(doc));
    return Promise.resolve({ name: "chat-" + n.date + ".json", type: "application/json", bytes: bytes, count: n.messages.length });
  }

  var api = { normalize: normalize, buildXlsxFile: buildXlsxFile, buildJsonFile: buildJsonFile, mostlyRtl: mostlyRtl, COLUMNS: COLUMNS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WebexExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
