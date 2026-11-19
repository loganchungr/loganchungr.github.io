# Logbook

A private log for the phone: text, photos and videos, written like a note in Notes and kept as Markdown files in a private GitHub repository. It lives at `loganchungr.github.io/logbook/` (unlinked from the site, and marked for search engines to skip). Only the app is public; the entries are in the private repository and the app reads them with your token.

## Setting it up (once per phone)

1. On GitHub, make a new **private** repository, for example `notebook`.
2. Make a fine-grained token at https://github.com/settings/personal-access-tokens/new. Under **Repository access** choose **Only select repositories** and pick that repository, plus `loganchungr.github.io` if you want to publish to the Log. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**.
3. Open `loganchungr.github.io/logbook/` in Safari, tap Share → **Add to Home Screen**, and open it from the Home Screen. Installed this way it runs full screen, works offline, and iOS doesn't clear its storage.
4. In Settings (the sliders button), type the repository as `you/notebook`, paste the token, and tap **Connect**.

### Or sync with Dropbox

Settings → Storage → **Sync With: Dropbox** saves entries to a folder in your Dropbox instead (Apps → the Dropbox app's name), in the same files and folders, so they show up in the Files app too. It needs a Dropbox app key once:

1. At https://www.dropbox.com/developers/apps, **Create app**: Scoped access, App folder, any name (it becomes the folder's name).
2. **Permissions** tab: tick `files.content.read` and `files.content.write`, then Submit. (Do this before connecting; Dropbox grants permissions at sign-in.)
3. **Settings** tab → OAuth 2 → Redirect URIs: add `https://loganchungr.github.io/logbook/`.
4. Copy the **App key** into Logbook's Settings and tap **Connect Dropbox**. Dropbox asks you to sign in and allow it, then sends you back.

The key isn't secret. Put it in `DROPBOX_APP_KEY` near the top of `app.js` and nobody has to make their own app (a new Dropbox app allows 500 people to connect until Dropbox approves it for more). Switching between GitHub and Dropbox copies this device's entries and photos to the new place if it's empty, and leaves the old copy where it was. Publish to Log still uses a GitHub token: with Dropbox, put one in the Token field under Publish to Log.

To publish entries to the Log, fill in **Publish to Log** with `loganchungr/loganchungr.github.io` and branch `update-2`. Each entry's ••• menu then has **Publish to Log**, which asks first and copies the entry to `entries/` and its photos to `entries/images/`, as the Shortcut does. Leave it blank and the option doesn't appear.

## How it works

- **Tabs:** Calendar (each day shows its first photo), New, and Entries (a list by month, with search). Settings are behind the sliders button at the top right.
- **Writing:** the first line is the title. **Aa** above the keyboard has headings, bold, italic, strikethrough, lists and quotes. The photo button adds photos and videos from the library or camera, after the line you're on; photos added together make a grid. Tap one to see them all full screen, share or save one, or remove it. Tap the date under the top bar to change the entry's date.
- **Passcode:** Settings → Passcode sets a four-digit code, asked for when Logbook opens and when you come back after 1 minute (or immediately, or after 15). Only a salted hash of it is kept, on that device; it isn't in the code. Forgot it? Delete Logbook from the Home Screen and set it up again; synced entries come back from GitHub.
- **Typefaces and sizes:** a default in Settings (12 typefaces built into iOS, sizes 12–20 pt), and any entry can have its own in its ••• menu.
- **Saving:** everything is saved on the phone as you type. It syncs to GitHub when you leave an entry, after 20 quiet seconds, when the app goes to the background, and when it comes back online. Each sync is one commit. An orange dot in the list marks an entry that hasn't synced yet.
- **Files:** `entries/2026/11/2026-11-19 title.md`, with photos in `entries/2026/11/images/`, in the same Markdown the Log uses. A Log post copied into the private repository shows up in Logbook, and the Shortcut could send there too. An entry's own typeface is saved as a comment at the end (`<!-- logbook font=serif -->`), which nothing displays.
- **Photos** are resized to 2,400 pixels on the long side (about half a megabyte, with no location data) unless Settings says Original. Videos are kept as they are, up to 50 MB each. GitHub suggests keeping a repository under 1 GB.
- Blocks the editor can't edit (code, tables, raw HTML, checklists) show as grey boxes and are kept exactly as written.
- If the same entry is changed on two devices before either syncs, the one that syncs last wins.

## Files

`index.html` (the screens), `app.css`, `app.js` (the app), `md.js` (Markdown ⇄ editor), `github.js` and `dropbox.js` (the two places entries can be stored, with the same calls), `store.js` (storage on the device), `sw.js` (keeps the app's files for offline use), `marked.min.js` (a copy of `build/marked.min.js`). There's no build step. The site's build copies this folder as it is, except this README.

Installed copies fetch each file fresh whenever they're online, so a change here reaches the phone the next time the app opens; the saved copies are only used offline.
