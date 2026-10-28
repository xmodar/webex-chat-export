/*
 * Rendered Webex message HTML -> Markdown.
 *
 * Webex renders the markdown people type (bold, italics, lists, links, code,
 * headings, block quotes) into HTML; this walks that HTML back into markdown
 * so the export keeps the formatting. Code blocks are taken from the copy
 * button's data-clipboard-text, which holds the source without the syntax
 * highlighter's line numbers.
 */
(function (root) {
  "use strict";

  // UI chrome that lives inside message bodies but is not message content
  var SKIP = /^(BUTTON|MDC-BUTTON|MDC-TOOLTIP|MDC-TOGGLETIP|MDC-POPOVER|MDC-SCREENREADERANNOUNCER|MDC-ICON|MDC-AVATAR|SCRIPT|STYLE|TEMPLATE|SVG)$/;

  function codeFence(code) {
    var ticks = "```";
    while (code.indexOf(ticks) >= 0) ticks += "`";
    return ticks;
  }

  function inlineCode(s) {
    var ticks = "`";
    while (s.indexOf(ticks) >= 0) ticks += "`";
    var pad = /^`|`$/.test(s) ? " " : "";
    return ticks + pad + s + pad + ticks;
  }

  function wrap(mark, s) {
    // keep surrounding whitespace outside the markers: "** bold **" isn't bold
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  }

  function prefixLines(s, first, rest) {
    return s.split("\n").map(function (l, i) { return (i ? rest : first) + l; }).join("\n");
  }

  function codeBlock(el) {
    var copy = el.querySelector("[data-clipboard-text]");
    var codeEl = el.querySelector("code") || el;
    var lang = (/(?:^|\s)language-([\w+#.-]+)/.exec(codeEl.className || "") || [])[1] || "";
    var code;
    if (copy) code = copy.getAttribute("data-clipboard-text");
    else {
      var clone = codeEl.cloneNode(true);
      clone.querySelectorAll(".linenumber, .react-syntax-highlighter-line-number").forEach(function (n) { n.remove(); });
      code = clone.textContent;
    }
    code = code.replace(/\n+$/, "");
    var fence = codeFence(code);
    return "\n\n" + fence + lang + "\n" + code + "\n" + fence + "\n\n";
  }

  function isCodeBlock(el) {
    return el.tagName === "PRE" ||
      (el.tagName === "DIV" && el.querySelector(":scope > pre, :scope > div > pre") && el.querySelector("[data-clipboard-text]"));
  }

  function list(el, depth) {
    var ordered = el.tagName === "OL", n = parseInt(el.getAttribute("start") || "1", 10), out = [];
    Array.prototype.forEach.call(el.children, function (li) {
      if (li.tagName !== "LI") return;
      var marker = ordered ? (n++) + ". " : "- ";
      var body = children(li, depth + 1).replace(/^\n+|\n+$/g, "").replace(/\n{2,}/g, "\n");
      out.push(prefixLines(body, marker, Array(marker.length + 1).join(" ")));
    });
    return "\n\n" + out.join("\n") + "\n\n";
  }

  function children(el, depth) {
    var s = "";
    for (var c = el.firstChild; c; c = c.nextSibling) s += node(c, depth || 0);
    return s;
  }

  function node(n, depth) {
    if (n.nodeType === 3) return n.nodeValue.replace(/ /g, " ");
    if (n.nodeType !== 1) return "";
    var tag = n.tagName.toUpperCase();
    if (SKIP.test(tag)) return "";
    if (n.getAttribute("aria-hidden") === "true" && tag !== "IMG") return "";
    if (isCodeBlock(n)) return codeBlock(n);

    switch (tag) {
      case "BR": return "\n";
      case "P": case "DIV": case "SECTION": return "\n\n" + children(n, depth) + "\n\n";
      case "STRONG": case "B": return wrap("**", children(n, depth));
      case "EM": case "I": return wrap("_", children(n, depth));
      case "DEL": case "S": case "STRIKE": return wrap("~~", children(n, depth));
      case "CODE": return inlineCode(n.textContent);
      case "HR": return "\n\n---\n\n";
      case "UL": case "OL": return list(n, depth);
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        return "\n\n" + Array(+tag[1] + 1).join("#") + " " + children(n, depth).trim() + "\n\n";
      case "BLOCKQUOTE":
        return "\n\n" + prefixLines(tidy(children(n, depth)), "> ", "> ") + "\n\n";
      case "IMG": return n.getAttribute("alt") || "";
      case "A": {
        var href = n.getAttribute("href") || "", text = children(n, depth);
        if (!href || /^javascript:/i.test(href)) return text;
        var bare = text.trim();
        // autolinked URLs stay bare; Webex shows "modar.me" for http://modar.me
        if (bare === href || href.replace(/^https?:\/\//, "").replace(/\/$/, "") === bare.replace(/\/$/, "")) return bare;
        return "[" + bare + "](" + href + ")";
      }
      default: return children(n, depth); // spans, mdc-text and other wrappers
    }
  }

  function tidy(s) {
    return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\s*\n|\n\s*$/g, "").trim();
  }

  function toMarkdown(el) { return tidy(children(el, 0)); }

  var api = { toMarkdown: toMarkdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WebexMarkdown = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
