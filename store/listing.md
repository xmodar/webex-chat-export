# Store listing

Text to paste into the Chrome Web Store and Firefox Add-ons (AMO) forms. Not
every field exists in both stores.

## Name

Webex Chat Export

## Summary (max 132 characters)

Export a Webex meeting chat (Everyone and direct chats, with markdown, replies and quotes) to one Excel sheet or JSON.

## Description

Save the full chat of a Webex meeting you joined in the browser, in one click.

• Everyone and every direct (private) chat, in one Excel sheet or one JSON file
• Formatting kept as markdown: bold, italics, links, lists, headings, quotes and code blocks with their language
• Replies linked to the message that started the thread; quotes linked to the message they quote
• Reactions and system lines ("… deleted their own message") kept
• Your own messages are shown with your name from the participants list instead of "You"; you can override it
• Loads the whole history: it scrolls the chat to the top, then collects everything
• Asks where to save the file
• Optional reminder (off by default): if you close the meeting tab before exporting, it offers to export the chat it saw. It watches the chat during the meeting, so it can make Webex slower.
• Small files: compressed Excel and compact JSON

How to use: join the meeting in your browser, click the toolbar button, pick Excel or JSON, and click Export.

Privacy: everything stays on your computer. The extension collects nothing, sends nothing, and only runs on webex.com.

Open source (MIT): https://github.com/xmodar/webex-chat-export

Not affiliated with Cisco or Webex.

## Category

- Chrome Web Store: Productivity → Communication (or Tools)
- AMO: Social & Communication

## Single purpose (Chrome)

Export the chat of a Webex meeting open in the browser to an Excel or JSON file.

## Permission justifications (Chrome)

- **scripting:** to run the chat reader in the Webex meeting tab when you click Export, and to load the optional close-reminder capture only while it is switched on.
- **downloads:** to save the exported file where you choose.
- **storage:** to remember your export options and, only if the optional close reminder is on, to keep the chat seen during a meeting so it can be exported if the tab closes first.
- **activeTab:** to act on the meeting tab you exported from.
- **Host permission `*://*.webex.com/*`:** the meeting chat lives in a `web.webex.com` frame inside the meeting page; the extension only reads it there.

## Data usage (Chrome privacy practices)

- Data handled: **website content** (the chat messages) and **personal communications** (chat content and names), only to build the export file you request.
- Not sold, not transferred, not used for anything unrelated, not used for creditworthiness.
- Remote code: **no**.

## Privacy policy URL

https://github.com/xmodar/webex-chat-export/blob/main/PRIVACY.md

## Homepage / support

https://github.com/xmodar/webex-chat-export

## Screenshots

`store/screenshots/*.png` (1280×800).
