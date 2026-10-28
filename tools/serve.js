// Development server: serves fixtures/*.html (DOM snapshots from dump-dom.js)
// with the extension's scraper scripts appended, so the scraper can be tried
// in a normal browser tab.   node tools/serve.js [port]
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const port = +process.argv[2] || 8765;
const SCRIPTS = ["lib/markdown.js", "lib/merge.js", "lib/scrape.js", "lib/xlsx.js", "lib/export.js"]
  .map((s) => `<script src="/extension/${s}"></script>`).join("");

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") {
    const list = fs.readdirSync(path.join(ROOT, "fixtures")).filter((f) => f.endsWith(".html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(list.map((f) => `<p><a href="/fixtures/${f}">${f}</a></p>`).join(""));
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  let body = fs.readFileSync(file);
  const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json" };
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  if (url.startsWith("/fixtures/") && file.endsWith(".html")) body = body.toString().replace(/<\/html>\s*$/, SCRIPTS + "</html>");
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
