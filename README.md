# TikTok Live Automation — Chrome Extension

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3) |
| `config.js` | Shared default local config (`loopSize`, `msg`, `sent`, `testMode`) |
| `background.js` | Service worker + default local config initialization |
| `popup.html` + `popup.js` | Extension popup UI |
| `options.html` + `options.js` | Local configuration page |
| `content.js` | Core automation logic injected into TikTok pages |

## How to install

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `tiktok-chrome-extension/` folder

## How to use

### Data preparation

Open **Config** from the popup, or open the extension's options page from `chrome://extensions/`.

Persistent local settings:

| Key | Used by | Meaning |
|-----|---------|---------|
| `loopSize` | getCreator | How many creators to collect |
| `msg` | sendMessage | Message text to send |
| `sent` | sendMessage | Already-sent users, updated after Send Message |
| `testMode` | sendMessage | When enabled, fills the message but does not send or update `sent` |

Temporary pipeline data is also stored inside the extension's own `chrome.storage.local`:

| Key | Written by | Read by |
|-----|------------|---------|
| `users` | Get Creators | Invite |
| `chats` | Invite | Send Message |

### Running tasks

1. Click the extension icon in Chrome toolbar
2. Click one of the three buttons:
   - **Get Creators** — browses TikTok live pages and collects usernames
   - **Invite** — opens TikTok backstage, checks each user, saves matched ones
   - **Send Message** — opens instant message page and sends `msg` to each user in `chats` (or only fills it when Test mode is enabled)
3. The extension will automatically navigate between pages. **Do not close the tab** while running.
4. A green notification will appear when done.

### Stopping

Click **Stop / Reset** in the popup, or refresh the page.

## Architecture

Because the original `.side` script jumps across multiple pages, a simple content-script approach would lose state on every navigation. This extension uses a **persistent state machine**:

- `chrome.storage.local` keeps `{ tkTask, tkStep, tkData }` across page loads
- On every page load, `content.js` checks storage and resumes at the correct step
- `background.js` initializes default local config values on install
- `options.html` edits `loopSize`, `msg`, `sent`, and `testMode`
- Page navigation is done via `window.location.href = ...`
- Runtime data and settings stay in local extension storage

## Important notes

1. **Login required** — You must be logged into `live-backstage.tiktok.com` before running.
2. **Selectors may break** — If TikTok updates their DOM/CSS classes, the CSS/XPath selectors in `content.js` will need updating.
3. **Config required** — Open **Config** and set `loopSize`, `msg`, optional `sent`, and optional Test mode before running.
4. **Heads-up** — The extension requests permission to run only on TikTok domains.
5. **Incremental saves** — task progress is saved incrementally to `chrome.storage.local`, so a page refresh will resume near where it left off.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No users found" | Run **Get Creators** first, then run **Invite** |
| "No chats to send" | Run **Invite** first, or all chats are already listed in local Config `sent` |
| Buttons not responding | Reload the extension at `chrome://extensions/`, then refresh the TikTok tab |
| Stuck on a page | Click **Stop / Reset**, refresh, and start again |
| Elements not found | TikTok may have changed their UI; open DevTools and update selectors in `content.js` |
