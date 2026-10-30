// Node tests for background.js (saved chats), against a fake browser API.
//   node test/background.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "extension");

function area() {
  let data = {};
  return {
    data: () => data,
    async get(keys) {
      if (keys == null) return JSON.parse(JSON.stringify(data));
      if (typeof keys === "string") keys = [keys];
      const out = {};
      if (Array.isArray(keys)) keys.forEach((k) => { if (k in data) out[k] = data[k]; });
      else Object.keys(keys).forEach((k) => { out[k] = k in data ? data[k] : keys[k]; });
      return JSON.parse(JSON.stringify(out));
    },
    async set(o) { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    async remove(keys) { [].concat(keys).forEach((k) => delete data[k]); }
  };
}

function setup() {
  const listeners = { message: [], removed: [], installed: [] };
  const downloads = [];
  const browser = {
    storage: { local: area(), session: area() },
    runtime: {
      onMessage: { addListener: (f) => listeners.message.push(f) },
      onInstalled: { addListener: (f) => listeners.installed.push(f) },
      sendMessage: async () => {},
      getURL: (p) => "ext://" + p
    },
    tabs: { onRemoved: { addListener: (f) => listeners.removed.push(f) }, query: async () => [] },
    scripting: { executeScript: async () => [], getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {} },
    downloads: {
      download: async (o) => { downloads.push(o); return downloads.length; },
      search: async () => [{ state: "complete" }],
      onChanged: { addListener() {}, removeListener() {} }
    }
  };
  const ctx = {
    browser, console, Blob, TextEncoder, CompressionStream, Response, Uint8Array, Intl, Date, Math, JSON, Promise,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    setTimeout: (f) => setImmediate(f), clearTimeout() {}, btoa
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ["lib/xlsx.js", "lib/merge.js", "lib/export.js", "background.js"].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(EXT, f), "utf8"), ctx, { filename: f });
  });
  const send = (msg, tabId) => {
    const r = listeners.message.map((f) => f(msg, tabId == null ? {} : { tab: { id: tabId } })).filter(Boolean);
    return r[0];
  };
  return { ctx, browser, send, downloads, listeners, local: browser.storage.local.data };
}

const msg = (id, user, text, kind = "message") => ({ id, kind, user, time: "10:00", text, plain: text, quote: null, reactions: [] });
const snap = (meeting, ids, extra = {}) => Object.assign({
  meeting, self: "", conversations: [{ name: "Everyone", kind: "everyone", participant: "", messages: ids.map((i) => msg(i, "Sara", "m" + i)) }]
}, extra);
const settle = () => new Promise((r) => setTimeout(r, 30));

(async function () {
  const t = setup();
  const chats = () => Object.keys(t.local()).filter((k) => k.startsWith("chat:")).map((k) => t.local()[k]);

  // messages from a meeting page are saved as one chat
  t.send({ type: "capture", page: "p1", data: snap("Course A", ["a1", "a2"], { self: "Dana" }) }, 1);
  t.send({ type: "capture", page: "p1", data: snap("Course A", ["a2", "a3"]) }, 1);
  await settle();
  assert.strictEqual(chats().length, 1);
  assert.deepStrictEqual(chats()[0].conversations[0].messages.map((m) => m.id), ["a1", "a2", "a3"]);
  assert.strictEqual(chats()[0].self, "Dana", "your name is kept with the chat");
  const id = chats()[0].id;
  assert.deepStrictEqual(t.local().chatIndex[id].conversations, [{ name: "Everyone", count: 3 }]);
  assert.strictEqual(t.local().chatIndex[id].count, 3);

  // a reload of the same meeting goes on with the same chat
  t.send({ type: "capture", page: "p2", data: snap("Course A", ["a3", "a4"]) }, 1);
  await settle();
  assert.strictEqual(chats().length, 1, "reload joins the same chat");
  assert.deepStrictEqual(chats()[0].conversations[0].messages.map((m) => m.id), ["a1", "a2", "a3", "a4"]);

  // another meeting in the same tab is another chat
  t.send({ type: "capture", page: "p3", data: snap("Course B", ["b1"]) }, 1);
  // the same meeting rejoined in another tab joins its chat
  t.send({ type: "capture", page: "p4", data: snap("Course A", ["a5"]) }, 2);
  await settle();
  assert.strictEqual(chats().length, 2);
  assert.deepStrictEqual(t.local()["chat:" + id].conversations[0].messages.map((m) => m.id), ["a1", "a2", "a3", "a4", "a5"]);

  // exporting a saved chat asks where to save and marks it exported
  t.send({ type: "exportChat", id, options: { format: "json", timezone: "UTC" } });
  await settle();
  assert.strictEqual(t.downloads.length, 1);
  assert.strictEqual(t.downloads[0].saveAs, true);
  assert.ok(/^chat-\d{4}-\d{2}-\d{2}\.json$/.test(t.downloads[0].filename));
  assert.ok(t.local().chatIndex[id].exportedAt > 0);

  // the live export reuses the name the chat already knows, and adds what it read
  let given = null;
  t.browser.scripting.executeScript = async (o) => {
    if (!o.func) return [];
    given = o.args[0];
    return [{ result: { found: true, meeting: "Course A", self: o.args[0].myName,
      conversations: [{ name: "Everyone", kind: "everyone", participant: "", messages: [msg("a5", "Sara", "m"), msg("a6", "You", "mine")] },
                      { name: "Direct: Sara", kind: "direct", participant: "Sara", messages: [msg("d1", "Sara", "psst")] }] } }];
  };
  t.send({ type: "export", tabId: 2, options: { format: "json", timezone: "UTC" } });
  await settle(); await settle();
  assert.strictEqual(given.myName, "Dana", "no second name lookup in the same meeting");
  const live = t.local()["chat:" + id];
  assert.deepStrictEqual(live.conversations.map((c) => c.messages.length), [6, 1]);
  assert.strictEqual(t.downloads.length, 2);

  // deleting removes the chat and its index entry
  await t.send({ type: "deleteChats", ids: [id] });
  assert.strictEqual(chats().length, 1);
  assert.ok(!t.local().chatIndex[id]);

  // chats kept by the old close reminder are moved over on update
  const u = setup();
  await u.browser.storage.local.set({ autoCapture: true, captures: {
    s1: { session: "s1", meeting: "Old", startedAt: 1, updatedAt: 2, exportedCount: 0,
          conversations: [{ name: "Everyone", kind: "everyone", participant: "", messages: [msg("o1", "A", "x")] }] } } });
  await u.listeners.installed[0]();
  await settle();
  assert.ok(!("captures" in u.local()) && !("autoCapture" in u.local()));
  assert.strictEqual(Object.values(u.local().chatIndex)[0].meeting, "Old");

  console.log("background tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
