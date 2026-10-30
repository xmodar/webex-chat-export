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
• Saves every meeting's chat on your computer as it goes, so messages Webex drops from long chats are still exported
• Asks where to save the file
• Saved chats page: search, export or delete any saved meeting chat, any time
• Small files: compressed Excel and compact JSON

How to use: join the meeting in your browser, click the toolbar button, pick Excel or JSON, and click Export this meeting. To export later, open Saved chats.

Privacy: everything stays on your computer. The extension collects nothing, sends nothing, and only runs on webex.com. Saved chats stay on your computer until you delete them.

Open source (MIT): https://github.com/xmodar/webex-chat-export

Not affiliated with Cisco or Webex.

## Category

- Chrome Web Store: Productivity → Communication (or Tools)
- AMO: Social & Communication

## Single purpose (Chrome)

Export the chat of a Webex meeting open in the browser to an Excel or JSON file.

## Permission justifications (Chrome)

- **scripting:** to run the chat reader in the Webex meeting tab when you click Export, and to start saving meetings that were already open when the extension was installed.
- **downloads:** to save the exported file where you choose.
- **storage, unlimitedStorage:** to keep your export options and the saved meeting chats on this computer (long meetings add up), so they can be exported any time.
- **activeTab:** to act on the meeting tab you exported from.
- **Host permission `*://*.webex.com/*`:** the meeting chat lives in a `web.webex.com` frame inside the meeting page; the extension only reads it there.

## Data usage (Chrome privacy practices)

- Data handled: **website content** (the chat messages) and **personal communications** (chat content and names), only to save the chat on this computer and build the export files you request.
- Not sold, not transferred, not used for anything unrelated, not used for creditworthiness.
- Remote code: **no**.

## Privacy policy URL

https://github.com/xmodar/webex-chat-export/blob/main/PRIVACY.md

## Homepage / support

https://github.com/xmodar/webex-chat-export

## Screenshots

`store/screenshots/*.png` (1280×800).
