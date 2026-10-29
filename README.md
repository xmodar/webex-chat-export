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
message"), and opens the chat panel if it is closed. An optional reminder,
off by default, offers to export the chat if you close the meeting tab
without exporting (see [Reminder](#reminder-when-a-meeting-tab-closes)).

When you aren't exporting, the extension runs nothing in your meetings.

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
2. Click the toolbar icon → choose **Excel** or **JSON** → **Export chat…**.
3. Keep the meeting tab in front while the export runs. The extension scrolls
   the chat and opens each direct chat, then puts the chat back on the tab it
   was showing, scrolled back to where you were.
4. Choose where to save the file. The suggested name is `chat-YYYY-MM-DD.xlsx`
   or `.json`. If you cancel the dialog, nothing is saved and the chat still
   counts as not exported.

The first time, Firefox may ask to allow access to `webex.com`.

Webex labels your own messages "You". The export replaces that with the name
in **Show your messages as**. If that is empty, it reads your display name from
the top entry of the participants list (the one marked "Me"), opening the
participants panel briefly if it is closed.

Options in the popup (all optional):

- **Show your messages as:** a name to use for your messages. When it is set,
  the extension uses it as is and doesn't read the participants list.
- **Time zone:** used for the date. Empty means this computer's time zone.
- **Sheet direction:** automatic (right-to-left when most messages are in
  Arabic, Hebrew, Persian or Urdu), left-to-right, or right-to-left.
- **Include direct (private) chats.**
- **Turn on the close reminder in every new meeting:** off by default. See
  below, including why it can slow Webex down.

### Reminder when a meeting tab closes

**Optional, off by default.** Once a meeting tab is closed, its chat is gone.
With the reminder on, the extension keeps a copy of what the chat panel shows
while the meeting runs: the Everyone list, and any direct chat you have open.
It doesn't click or scroll anything.

> **It can make Webex slower.** Keeping the copy means watching the chat
> panel for the whole meeting. On a slower computer, or in a long or busy
> meeting, Webex can feel slower or less responsive. Turn it on only if you
> need it.

The extension keeps that work small. It watches only the side panel, waits
for changes to settle, reads only messages it hasn't seen yet, and saves them
in batches. While the reminder is off, none of this code is loaded into the
meeting. With the reminder on, if the tab closes, you leave the meeting, or the
browser quits while messages are still unexported, a window opens with the same format and
options. From there you can **Export…**, choose **Not now** (the chat then
appears under **Not exported yet** in the popup), or **Discard** it.

To turn it on for one meeting, use **Remind me to export if this meeting
closes**, which the popup shows on a meeting tab. To turn it on for every new
meeting, use **Turn on the close reminder in every new meeting** under
Options. The per-meeting switch overrides the default for that meeting only. Switching it off stops the capture and deletes
what was already captured for that meeting, so no reminder appears.

What the reminder can export is what the chat panel showed while the meeting
ran: direct chats you never opened aren't included. A normal export opens
every direct chat, and it also marks the meeting as exported. Captured chats
are kept only on this computer, in the extension's storage, and are deleted
after 14 days.

## Output

### Excel: one sheet named after the date

The sheet is named after the meeting's date, so `timestamp` holds only the
time. The first three columns keep the old script's names and order.

| Column | Contents |
| --- | --- |
| `timestamp` | The message time, `HH:mm` (24-hour) |
| `user` | The sender; "You" becomes your detected or chosen name |
| `text` | The message as markdown, with any quote moved to the `quoted_*` columns |
| `conversation` | `Everyone` or `Direct: <name>` |
| `no` | The message number, counting across all conversations |
| `type` | `message`, `reply` or `system` |
| `reply_to` / `reply_to_user` | For a reply, the `no` and sender of the thread's first message |
| `quote_of` / `quoted_user` / `quoted_text` | For a quote, the quoted message's `no` (when it is found), its sender and its markdown |
| `reactions` | For example `Like ×2` |

### JSON

The JSON is written on a single line. Messages are nested under their
conversation, and the date appears once at the top. Fields are left out when
they have their default value: `type` is assumed to be `message`, and there is
no `replyTo`, `quote` or `reactions` unless the message has one. Formatted for
reading:

```jsonc
{
  "meeting": "Course title",
  "date": "2026-10-28",
  "timezone": "Europe/Berlin",
  "you": "Dana Host",
  "exportedAt": "2026-10-28T11:40:00.000Z",
  "conversations": [
    { "name": "Everyone", "kind": "everyone", "messages": [
      { "no": 120, "time": "14:22", "user": "Omar", "text": "**bold** and `code`", "reactions": { "Like": 2 } },
      { "no": 121, "time": "14:23", "user": "Dana Host", "text": "reply", "type": "reply", "replyTo": 120 },
      { "no": 122, "time": "14:25", "user": "Sara", "text": "see above",
        "quote": { "user": "Omar", "text": "**bold** and `code`", "no": 120 } }
    ] },
    { "name": "Direct: Sara", "kind": "direct", "participant": "Sara", "messages": [ … ] }
  ]
}
```

### File size

Both formats are built to stay small. On a real 123-message class chat:

| | Before | Now |
| --- | --- | --- |
| Excel | 118 KB | 8.7 KB |
| JSON | 51 KB | 11.8 KB |

The workbook is deflate-compressed. Repeated text, such as names and
conversation labels, is stored once in a shared-strings table, and empty cells
are left out. The JSON drops per-message fields that repeat (the conversation,
the date, ids, a plain-text copy) or that only hold a default value.

## Limits

- Webex only shows message times, not dates. A normal export uses the day you
  export, so export on the day of the session. A chat exported from the
  reminder uses the day the meeting was captured.
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
  background.js         runs exports (Save As), keeps the capture store, opens reminders
  capture.js            reminder capture (only loaded while it is on): sends new chat messages to the background
  popup.*               the toolbar popup
  reminder.*            the "export the meeting chat?" window
  options.js            export options shared by the popup and the reminder
  lib/scrape.js         finds the chat, scrolls, opens direct chats, parses messages
  lib/markdown.js       rendered message HTML → markdown
  lib/merge.js          merges partial views of a chat in display order
  lib/export.js         numbering, reply/quote links, XLSX rows and JSON
  lib/xlsx.js           dependency-free one-sheet XLSX writer (shared strings, deflate)
  vendor/               webextension-polyfill 0.12.0 (MPL-2.0)
tools/
  build.js              writes dist/firefox and dist/chrome, plus their .zip files
  dump-dom.js           DevTools helper: saves the chat frame's DOM (shadow roots too) as HTML
  serve.js              serves fixtures/ and tests with the scraper scripts added
  make-icons.js         draws the icons
test/
  export.test.js        Node tests for the XLSX and JSON output and merging (npm test)
  scrape.test.html      browser tests for the scraper and markdown converter
```

The extension uses the promise-based `browser.*` API everywhere.
[webextension-polyfill](https://github.com/mozilla/webextension-polyfill)
provides it in Chrome, and it does nothing in Firefox. The popup, the reminder,
the background script and the content scripts all load it.

**Capturing new snapshots of the Webex markup:** in the meeting tab, right-click
a chat message → **Inspect**. In the Console, paste
[`tools/dump-dom.js`](tools/dump-dom.js), then run `dump("everyone")`,
`dump("direct")` and so on. Copy the files into `fixtures/`. Git ignores that
folder because the files contain real messages. Run `npm run serve` and open
`http://127.0.0.1:8765/` to try the scraper on them, or open
`/test/scrape.test.html` to run the browser tests.

## Releasing

Bump `version` in [`extension/manifest.json`](extension/manifest.json), commit,
then tag and push:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

The [ci workflow](.github/workflows/release.yml) runs the tests and lint,
builds both packages, and attaches them to a GitHub release. It then publishes
to each store whose secrets are set:

- **Firefox Add-ons:** set `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from
  [addons.mozilla.org → Developer Hub → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/).
  The listing text comes from
  [`store/amo-metadata.json`](store/amo-metadata.json).
- **Chrome Web Store:** the first version has to be uploaded by hand in the
  [developer dashboard](https://chrome.google.com/webstore/devconsole). That
  creates the item ID. After that, set `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`,
  `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` (see the
  [chrome-webstore-upload key guide](https://github.com/fregante/chrome-webstore-upload-keys)).

Store text, permission justifications and screenshots are in
[`store/`](store/). The screenshots are rendered from
[`store/screenshots.html`](store/screenshots.html).

## Privacy

The extension collects nothing and makes no network requests. Chats stay on
your computer; see [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © 2026 Modar M. Alfadly. The bundled
[webextension-polyfill](https://github.com/mozilla/webextension-polyfill) is
under [MPL-2.0](extension/vendor/browser-polyfill.LICENSE).

Not affiliated with Cisco or Webex.
