// Node tests for the pure parts: XLSX writer and export shaping.
//   node test/export.test.js [out-dir]
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Xlsx = require("../extension/lib/xlsx.js");
globalThis.WebexXlsx = Xlsx;
const Export = require("../extension/lib/export.js");

const result = {
  meeting: "Demo",
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
const opts = { myName: "SDAIA Academy", date: "2026-10-28" };

const n = Export.normalize(result, opts);
assert.strictEqual(n.messages.length, 6);
assert.deepStrictEqual(n.messages.map((m) => m.no), [1, 2, 3, 4, 5, 6]);
assert.strictEqual(n.messages[0].user, "SDAIA Academy");
assert.strictEqual(n.messages[0].timestamp, "2026-10-28 10:00");
assert.deepStrictEqual(n.messages[1].replyTo, { no: 1, user: "SDAIA Academy" });
assert.deepStrictEqual(n.messages[2].quote, { no: 1, user: "SDAIA Academy", text: "**Welcome** & <hello>" });
assert.strictEqual(n.messages[5].conversation, "Direct: Sara");

const x = Export.buildXlsxFile(result, opts);
assert.strictEqual(x.name, "chat-2026-10-28.xlsx");
assert.strictEqual(x.count, 6);
const j = Export.buildJsonFile(result, opts);
const doc = JSON.parse(Buffer.from(j.bytes).toString("utf8"));
assert.strictEqual(doc.messages.length, 6);
assert.deepStrictEqual(doc.conversations.map((c) => c.messages), [5, 1, 0]);

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
