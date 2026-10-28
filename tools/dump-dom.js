/*
 * Development helper: snapshot the Webex meeting DOM (shadow roots included)
 * into a standalone HTML file, so the scraper can be developed offline.
 *
 * Paste into the DevTools console *in the web.webex.com frame* (pick it in
 * the console's context dropdown), then call:   dump("everyone")
 * Shadow roots are written as declarative <template shadowrootmode="open">,
 * so opening the file in a browser rebuilds the same tree.
 */
(function () {
  "use strict";
  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, NOSCRIPT: 1, META: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1 };
  var VOID = { AREA: 1, BASE: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1, SOURCE: 1, TRACK: 1, WBR: 1 };

  function escText(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }

  function attrs(el) {
    var out = "";
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i], v = a.value;
      if (/^on/i.test(a.name)) continue;
      if ((a.name === "src" || a.name === "href") && /^(blob:|data:)/.test(v)) v = "about:blank";
      if (a.name === "src" && el.tagName === "IFRAME") v = "about:blank";
      out += " " + a.name + '="' + escAttr(v) + '"';
    }
    return out;
  }

  function ser(node) {
    if (node.nodeType === 3) return escText(node.nodeValue);
    if (node.nodeType === 11) return kids(node);
    if (node.nodeType !== 1) return "";
    var tag = node.tagName;
    if (SKIP[tag]) return "";
    var name = node.localName;
    // icons only matter by name, drop the path data
    if (node instanceof SVGElement) return name === "svg" ? "<svg" + attrs(node) + "></svg>" : "";
    var s = "<" + name + attrs(node) + ">";
    if (VOID[tag]) return s;
    if (node.shadowRoot) s += '<template shadowrootmode="open">' + kids(node.shadowRoot) + "</template>";
    if (tag === "TEMPLATE") s += kids(node.content);
    else s += kids(node);
    return s + "</" + name + ">";
  }

  function kids(n) {
    var s = "";
    for (var c = n.firstChild; c; c = c.nextSibling) s += ser(c);
    return s;
  }

  window.dump = function (label) {
    var html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + escText(label || "dump") +
      "</title></head>" + ser(document.body) + "</html>";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = "webex-dom-" + (label || "dump") + ".html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log("%c✔ saved " + a.download + " (" + Math.round(html.length / 1024) + " KB)", "color:#0a0;font-weight:bold");
  };
  console.log("dump() ready — call dump(\"everyone\"), dump(\"direct\"), dump(\"thread\") ...");
})();
