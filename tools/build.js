// Builds per-browser packages from extension/ (which itself loads unpacked in
// both browsers, with a warning about the other browser's manifest keys).
//   node tools/build.js            -> dist/firefox/, dist/chrome/, and their .zip
// Firefox: background.scripts (event page) + gecko settings.
// Chrome:  background.service_worker, no browser_specific_settings.
const fs = require("fs");
const path = require("path");
const { zip } = require("../extension/lib/xlsx.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");
const base = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));

const targets = {
  firefox(m) {
    m.background = { scripts: base.background.scripts };
    return m;
  },
  chrome(m) {
    m.background = { service_worker: base.background.service_worker };
    delete m.browser_specific_settings;
    return m;
  }
};

function files(dir, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = path.posix.join(rel, e.name);
    return e.isDirectory() ? files(dir, r) : [r];
  });
}

fs.rmSync(DIST, { recursive: true, force: true });
for (const [name, adapt] of Object.entries(targets)) {
  const out = path.join(DIST, name);
  const manifest = adapt(JSON.parse(JSON.stringify(base)));
  const entries = [];
  for (const f of files(SRC)) {
    const data = f === "manifest.json" ? JSON.stringify(manifest, null, 2) + "\n" : fs.readFileSync(path.join(SRC, f));
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), data);
    entries.push({ name: f, data: typeof data === "string" ? data : new Uint8Array(data) });
  }
  const pkg = path.join(DIST, `webex-chat-export-${base.version}-${name}.zip`);
  fs.writeFileSync(pkg, zip(entries));
  console.log(`${name}: ${path.relative(ROOT, out)}  ${path.relative(ROOT, pkg)}`);
}
