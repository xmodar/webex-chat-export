# Webex Chat Export

A browser extension (Firefox and Chrome) that exports a Webex meeting chat to
**one Excel sheet** or **JSON** in a single click. It replaces the old
[DevTools console script](https://gist.github.com/xmodar/8808c7353d63cc56a9e7a1526ef758ac).

What it does that the console script couldn't:

| Problem with the console script | What the extension does |
| --- | --- |
| You had to Inspect a chat message first. The chat lives in a cross-origin `web.webex.com` iframe, and the console starts in the top frame. | Injects into every frame of the tab and answers from the one that hosts the chat. All lookups also walk open shadow roots. |
| Direct (private) chats were missing. | Opens every conversation in **Direct → Recent Direct Messages** in turn and exports it. |
| Markdown was flattened to plain text. | Converts the rendered HTML back into markdown: bold, italics, strike-through, links, inline code, code blocks with their language, headings, lists, block quotes and rules. Code is taken from the copy button, so the highlighter's line numbers are left out. |
| Replies and quotes were lost. | Links each reply to its thread's first message, and splits each quote into who was quoted, the quoted text and the message it quotes. |
| Only what was rendered was saved. | Scrolls each conversation to the top until no older messages load, then walks down, collecting messages as it goes. |

It also keeps reactions and system lines (for example "X deleted their own
message"), and opens the chat panel if it is closed.

## Install

Build the packages first (Node 18 or later, no dependencies):

```bash
npm run build
```

**Firefox:** open `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on…** → pick `dist/firefox/manifest.json`. Temporary add-ons are removed
when Firefox closes. To install it permanently, sign it as an unlisted add-on
with `npx web-ext sign --channel unlisted --source-dir dist/firefox` (this
needs AMO API keys).

**Chrome / Edge:** open `chrome://extensions` → turn on **Developer mode** →
**Load unpacked** → pick `dist/chrome`.

Or run `npm run firefox`, which starts a separate Firefox profile with the
add-on already loaded.

## Use

1. Join the meeting **in the browser**, in the web app on `*.webex.com`.
2. Click the toolbar icon → choose **Excel** or **JSON** → **Export chat**.
3. Keep the meeting tab in front while the export runs. The extension scrolls
   the chat and opens each direct chat, then puts the chat back on the tab it
   was showing. The file goes to your Downloads folder as `chat-YYYY-MM-DD.xlsx`
   or `.json`.

The first time, Firefox may ask to allow access to `webex.com`.

Options in the popup:

- Rename "You" (default `SDAIA Academy`; leave it empty to keep "You").
- The time zone used for the date (default `Asia/Riyadh`).
- Include or skip direct chats.
- Right-to-left sheet.

## Output

### Excel: one sheet named after the date

The first three columns match the old script, so existing workbooks and tools
keep working.

| Column | Contents |
| --- | --- |
| `timestamp` | `YYYY-MM-DD HH:mm`: today's date in the chosen time zone plus the message time |
| `user` | The sender ("You" renamed as configured) |
| `text` | The message as markdown, with any quote moved to the `quoted_*` columns |
| `conversation` | `Everyone` or `Direct: <name>` |
| `no` | The message number, counting across all conversations |
| `type` | `message`, `reply` or `system` |
| `reply_to` / `reply_to_user` | For a reply, the `no` and sender of the thread's first message |
| `quote_of` / `quoted_user` / `quoted_text` | For a quote, the quoted message's `no` (when it is found), its sender and its markdown |
| `reactions` | For example `Like ×2` |

### JSON

```jsonc
{
  "meeting": "Course title",
  "date": "2026-10-28",
  "timezone": "Asia/Riyadh",
  "exportedAt": "2026-10-28T11:40:00.000Z",
  "conversations": [{ "name": "Everyone", "kind": "everyone", "participant": "", "messages": 123 }],
  "messages": [{
    "no": 121, "id": "act-…", "conversation": "Everyone", "kind": "reply",
    "timestamp": "2026-10-28 14:23", "time": "14:23", "user": "SDAIA Academy",
    "text": "markdown", "plain": "plain text",
    "replyTo": { "no": 120, "user": "SDAIA Academy" },
    "quote": null,
    "reactions": [{ "name": "Like", "count": 1 }]
  }]
}
```

## Limits

- Webex only shows message times, not dates, so every message gets the export
  day's date. Export on the day of the session.
- A quote says who was quoted but not which message. `quote_of` is filled in
  only when one earlier message from that person has exactly the quoted text.
- The extension reads the web app's markup (`data-test` attributes, the
  `activity--reply` class, the `messageQuote` block and so on). If a Webex
  update breaks the export, capture new snapshots (see below) and adjust
  [`extension/lib/scrape.js`](extension/lib/scrape.js).

## Development

```
extension/              the extension source (loads unpacked in both browsers)
  manifest.json         Firefox and Chrome keys; tools/build.js splits them per browser
  background.js         injects the scraper, builds the file, downloads it
  popup.*               the toolbar popup
  lib/scrape.js         finds the chat, scrolls, opens direct chats, parses messages
  lib/markdown.js       rendered message HTML → markdown
  lib/export.js         numbering, reply/quote links, XLSX rows and JSON
  lib/xlsx.js           dependency-free one-sheet XLSX and zip writer
  vendor/               webextension-polyfill 0.12.0 (MPL-2.0)
tools/
  build.js              writes dist/firefox and dist/chrome, plus their .zip files
  dump-dom.js           DevTools helper: saves the chat frame's DOM (shadow roots too) as HTML
  serve.js              serves fixtures/ and tests with the scraper scripts added
  make-icons.js         draws the icons
test/
  export.test.js        Node tests for the XLSX and JSON output (npm test)
  scrape.test.html      browser tests for the scraper and markdown converter
```

The extension uses the promise-based `browser.*` API everywhere.
[webextension-polyfill](https://github.com/mozilla/webextension-polyfill)
provides it in Chrome, and it does nothing in Firefox. The popup, the
background script and the injected scraper all load it.

**Capturing new snapshots of the Webex markup:** in the meeting tab, right-click
a chat message → **Inspect**. In the Console, paste
[`tools/dump-dom.js`](tools/dump-dom.js), then run `dump("everyone")`,
`dump("direct")` and so on. Copy the files into `fixtures/`. Git ignores that
folder because the files contain real messages. Run `npm run serve` and open
`http://127.0.0.1:8765/` to try the scraper on them, or open
`/test/scrape.test.html` to run the browser tests.
