// Node tests for the pure parts: XLSX writer, export shaping and merging.
//   node test/export.test.js [out-dir]
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Xlsx = require("../extension/lib/xlsx.js");
globalThis.WebexXlsx = Xlsx;
const Export = require("../extension/lib/export.js");
const Merge = require("../extension/lib/merge.js");

// read a zip back (stored or deflated entries) -> { name: text }
function unzip(bytes) {
  const b = Buffer.from(bytes), out = {};
  for (let p = 0; b.readUInt32LE(p) === 0x04034b50;) {
    const method = b.readUInt16LE(p + 8), size = b.readUInt32LE(p + 18);
    const nameLen = b.readUInt16LE(p + 26), extra = b.readUInt16LE(p + 28);
    const name = b.toString("utf8", p + 30, p + 30 + nameLen), start = p + 30 + nameLen + extra;
    const data = b.subarray(start, start + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    p = start + size;
  }
  return out;
}

const result = {
  meeting: "Demo",
  self: "Dana Host",
  conversations: [
    { name: "Everyone", kind: "everyone", participant: "", messages: [
      { id: "a1", kind: "message", user: "You", time: "10:00", text: "**Welcome** & <hello>", reactions: [{ name: "Like", count: 2 }] },
      { id: "a2", kind: "reply", user: "Sara", time: "10:01", text: "Thanks", replyTo: "a1", reactions: [] },
      { id: "a3", kind: "message", user: "Omar", time: "10:02", text: "ok", quote: { user: "You", text: "**Welcome** & <hello>" }, reactions: [] },
      { id: "a4", kind: "system", user: "", time: "10:03", text: "Omar deleted their own message.", reactions: [] },
      { id: "a5", kind: "message", user: "Nora", time: "10:04", text: "مرحبا\n```python\nprint(1)\n```", reactions: [] }
    ] },
    { name: "Direct: Sara", kind: "direct", participant: "Sara", messages: [
      { id: "d1", kind: "message", user: "Sara", time: "10:05", text: "private q", reactions: [] }
    ] },
    { name: "Direct: Empty", kind: "direct", participant: "Empty", messages: [] }
  ]
};
const opts = { date: "2026-10-28", timezone: "UTC" };

(async () => {
  const n = Export.normalize(result, opts);
  assert.strictEqual(n.messages.length, 6);
  assert.deepStrictEqual(n.messages.map((m) => m.no), [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(n.messages[0].user, "Dana Host");
  assert.strictEqual(n.messages[0].time, "10:00");
  assert.deepStrictEqual(n.messages[1].replyTo, { no: 1, user: "Dana Host" });
  assert.deepStrictEqual(n.messages[2].quote, { no: 1, user: "Dana Host", text: "**Welcome** & <hello>" });
  assert.strictEqual(n.messages[5].conversation, "Direct: Sara");

  // XLSX: sheet named after the date, first column only the time, compressed parts
  const x = await Export.buildXlsxFile(result, opts);
  assert.strictEqual(x.name, "chat-2026-10-28.xlsx");
  assert.strictEqual(x.count, 6);
  const parts = unzip(x.bytes);
  assert.ok(/<sheet name="2026-10-28"/.test(parts["xl/workbook.xml"]));
  const sst = [...parts["xl/sharedStrings.xml"].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
  const a2 = /<c r="A2" s="1" t="s"><v>(\d+)<\/v>/.exec(parts["xl/worksheets/sheet1.xml"]);
  assert.strictEqual(sst[+a2[1]], "10:00");
  assert.strictEqual(sst.filter((s) => s === "Dana Host").length, 1, "names are stored once");
  assert.ok(!/<c r="G2"/.test(parts["xl/worksheets/sheet1.xml"]), "empty cells are left out");

  // JSON: compact, nested by conversation, defaults left out
  const j = await Export.buildJsonFile(result, opts);
  const text = Buffer.from(j.bytes).toString("utf8");
  assert.ok(!/\n/.test(text));
  const doc = JSON.parse(text);
  assert.strictEqual(doc.date, "2026-10-28");
  assert.deepStrictEqual(doc.conversations.map((c) => c.messages.length), [5, 1, 0]);
  assert.deepStrictEqual(doc.conversations[0].messages[0], { no: 1, time: "10:00", user: "Dana Host", text: "**Welcome** & <hello>", reactions: { Like: 2 } });
  assert.deepStrictEqual(doc.conversations[0].messages[1], { no: 2, time: "10:01", user: "Sara", text: "Thanks", type: "reply", replyTo: 1 });
  assert.deepStrictEqual(doc.conversations[0].messages[2].quote, { user: "Dana Host", text: "**Welcome** & <hello>", no: 1 });
  assert.strictEqual(doc.conversations[1].participant, "Sara");

  // the override beats the detected name; with neither, "You" stays
  assert.strictEqual(Export.normalize(result, { myName: "Prof. X", date: "d" }).messages[0].user, "Prof. X");
  assert.strictEqual(Export.normalize(Object.assign({}, result, { self: "" }), { date: "d" }).messages[0].user, "You");
  assert.strictEqual(doc.you, "Dana Host");
  assert.strictEqual(doc.timezone, "UTC");
  // a capture exported later keeps the meeting's date
  assert.strictEqual(Export.normalize(result, { timezone: "UTC", when: Date.UTC(2026, 0, 5, 9) }).date, "2026-01-05");

  // sheet direction follows the script most messages are written in
  assert.strictEqual(Export.mostlyRtl(n.messages), false);
  assert.strictEqual(Export.mostlyRtl([{ kind: "message", text: "مرحبا" }, { kind: "message", text: "hi" }, { kind: "message", text: "שלום" }]), true);
  assert.ok(!/rightToLeft/.test(parts["xl/worksheets/sheet1.xml"]));
  const rtl = unzip((await Export.buildXlsxFile(result, Object.assign({ direction: "rtl" }, opts))).bytes);
  assert.ok(/rightToLeft="1"/.test(rtl["xl/worksheets/sheet1.xml"]));

  // merging windows of a chat keeps display order and links replies
  const rec = { conversations: [] };
  const m = (id, kind) => ({ id, kind: kind || "message", user: "u", text: id, reactions: [] });
  Merge.mergeResult(rec, { meeting: "M", conversations: [{ name: "Everyone", kind: "everyone", messages: [m("b"), m("c", "reply")] }] });
  Merge.mergeResult(rec, { conversations: [{ name: "Everyone", kind: "everyone", messages: [m("a"), m("b"), m("c", "reply"), m("d")] }] });
  Merge.mergeResult(rec, { conversations: [{ name: "Direct: S", kind: "direct", participant: "S", messages: [m("x")] }] });
  assert.deepStrictEqual(rec.conversations[0].messages.map((x) => x.id), ["a", "b", "c", "d"]);
  assert.strictEqual(rec.conversations[0].messages[2].replyTo, "b");
  assert.strictEqual(rec.meeting, "M");
  assert.strictEqual(Merge.count(rec), 5);

  assert.strictEqual(Xlsx.colName(0), "A");
  assert.strictEqual(Xlsx.colName(25), "Z");
  assert.strictEqual(Xlsx.colName(26), "AA");

  const out = process.argv[2];
  if (out) {
    fs.writeFileSync(path.join(out, x.name), x.bytes);
    fs.writeFileSync(path.join(out, j.name), j.bytes);
    console.log("wrote", path.join(out, x.name));
  }
  console.log("export tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
