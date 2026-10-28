/*
 * Minimal XLSX writer: one worksheet, deflate-compressed zip, no dependencies.
 * Works in extension pages, service workers, content scripts and Node 18+.
 *
 *   await buildXlsx({ sheetName, columns: [{ header, width }], rows: [[...]], rtl })
 *     -> Uint8Array
 *
 * Kept small on purpose: repeated text (names, conversation labels) goes into
 * one shared-strings table, empty cells are left out, and the zip is deflated
 * (the repeated cell markup compresses to almost nothing).
 */
(function (root) {
  "use strict";

  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") return null;
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* files: [{ name, data: string | Uint8Array }] -> zip bytes (deflated when it helps) */
  async function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      var crc = crc32(data), packed = await deflateRaw(data), method = 8;
      if (!packed || packed.length >= data.length) { packed = data; method = 0; } // store if deflate doesn't pay
      // local file header; bit 11 (0x0800) marks the name as UTF-8
      var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(0), u16(0),
        u32(crc), u32(packed.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, packed);
      central.push(new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(0), u16(0),
        u32(crc), u32(packed.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + packed.length;
    }

    var cdLen = central.reduce(function (n, a) { return n + a.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length), u32(cdLen), u32(offset), u16(0)));

    var all = parts.concat(central, [end]);
    var total = all.reduce(function (n, a) { return n + a.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); // control chars Excel rejects
  }

  function colName(i) {
    var s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  // Excel caps a cell at 32767 characters
  function clip(v) {
    v = String(v == null ? "" : v);
    return v.length > 32767 ? v.slice(0, 32760) + " [...]" : v;
  }

  async function buildXlsx(opts) {
    var cols = opts.columns, rows = opts.rows;
    var last = colName(cols.length - 1), letters = cols.map(function (c, i) { return colName(i); });
    var strings = [], index = new Map();

    function sst(v) {
      var i = index.get(v);
      if (i === undefined) { i = strings.length; strings.push(v); index.set(v, i); }
      return i;
    }

    function row(n, cells, style) {
      var r = '<row r="' + n + '">';
      for (var i = 0; i < cells.length; i++) {
        var v = cells[i];
        if (v === "" || v == null) continue;
        var attrs = ' r="' + letters[i] + n + '" s="' + style + '"';
        r += typeof v === "number" && isFinite(v)
          ? "<c" + attrs + "><v>" + v + "</v></c>"
          : "<c" + attrs + ' t="s"><v>' + sst(clip(v)) + "</v></c>";
      }
      return r + "</row>";
    }

    var body = [row(1, cols.map(function (c) { return c.header; }), 2)];
    for (var i = 0; i < rows.length; i++) body.push(row(i + 2, rows[i], 1));

    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + last + (rows.length + 1) + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"' + (opts.rtl ? ' rightToLeft="1"' : "") + ">" +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews><cols>" +
      cols.map(function (c, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>';
      }).join("") + "</cols><sheetData>" + body.join("") + "</sheetData>" +
      (rows.length ? '<autoFilter ref="A1:' + last + (rows.length + 1) + '"/>' : "") +
      "</worksheet>";

    var shared = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="' + strings.length + '">' +
      strings.map(function (s) {
        return /^\s|\s$/.test(s) ? '<si><t xml:space="preserve">' + esc(s) + "</t></si>" : "<si><t>" + esc(s) + "</t></si>";
      }).join("") + "</sst>";

    // xf 1: wrapped, top-aligned text; xf 2: the bold header
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="3"><xf xfId="0"/>' +
      '<xf xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf xfId="0" fontId="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      "</cellXfs></styleSheet>";

    var CT = "http://schemas.openxmlformats.org/package/2006/content-types";
    var REL = "http://schemas.openxmlformats.org/package/2006/relationships";
    var OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    var SS = "application/vnd.openxmlformats-officedocument.spreadsheetml";
    // sheet names: max 31 chars, none of : \ / ? * [ ]
    var sheetName = String(opts.sheetName || "Sheet1").replace(/[:\\\/?*\[\]]/g, "-").slice(0, 31);

    return zip([
      { name: "[Content_Types].xml", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + CT + '">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="' + SS + '.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + SS + '.worksheet+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="' + SS + '.sharedStrings+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="' + SS + '.styles+xml"/></Types>' },
      { name: "_rels/.rels", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL + '">' +
        '<Relationship Id="rId1" Type="' + OD + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + OD + '">' +
        '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
        (rows.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
          "'" + esc(sheetName).replace(/'/g, "''") + "'!$A$1:$" + last + "$" + (rows.length + 1) +
          "</definedName></definedNames>" : "") +
        "</workbook>" },
      { name: "xl/_rels/workbook.xml.rels", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL + '">' +
        '<Relationship Id="rId1" Type="' + OD + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + OD + '/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId3" Type="' + OD + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/sharedStrings.xml", data: shared },
      { name: "xl/worksheets/sheet1.xml", data: sheet }
    ]);
  }

  var api = { buildXlsx: buildXlsx, colName: colName, zip: zip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WebexXlsx = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
