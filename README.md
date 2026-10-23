# Loggin’ Chung

A personal log. One `index.html`, no build step. Posts are Markdown files in `entries/`.

## Writing a post

Add a file to `entries/` named `YYYY-MM-DD-anything.md`, for example `2026-10-23-a-new-thought.md`.

- The date comes from the filename and decides which day of the calendar the post lands on.
- The title is the first `# Heading` in the file. If there isn’t one, the title comes from the filename.
- Tag a post by typing `#hashtags` anywhere in the text. Hashtags inside code are ignored.

Commit and push. The home page reads the folder each time it loads, so nothing else needs updating.

## Hosting on GitHub Pages

1. Push this folder’s contents to a GitHub repo (`index.html`, `entries/`, `.nojekyll`).
2. In the repo, open Settings → Pages, and publish from the main branch, root folder.
3. Visit `https://<your-username>.github.io/<repo-name>/`.

The page works out the repo name from that address. On a custom domain, or when testing locally, set `REPO` near the top of the script in `index.html`:

```js
const REPO = "your-username/your-repo";
```

If the page can’t read the folder, it shows sample entries and a note saying so.

## Mailing list

The signup form on `context.html` sends addresses to a Google Sheet through a small Apps Script. One-time setup:

1. Create a new Google Sheet. Name it anything.
2. Open Extensions → Apps Script. Delete the starter code, paste in the contents of `mailing-list.gs`, and save.
3. Click Deploy → New deployment. Choose type "Web app". Set "Execute as" to Me and "Who has access" to Anyone. Deploy, and approve the permissions prompt.
4. Copy the web app URL it gives you (it ends in `/exec`).
5. In `context.html`, paste that URL into `SIGNUP_URL` near the bottom of the file, then commit.

Addresses appear in the Sheet with a timestamp. Duplicates are ignored. If you later edit the script, use Deploy → Manage deployments → Edit → New version, or the change won’t go live. The Sheet stays private to your Google account. The URL only lets people add an address, not read the list.

To send to the list, you’ll need a way to send bulk email with an unsubscribe link and a postal address in each message. Don’t send to it from a personal inbox.

## Notes

- The page lists `entries/` through GitHub’s public API, which allows about 60 requests per hour per visitor. That’s plenty for a personal log.
- To test locally, serve the folder (`python3 -m http.server`) and set `REPO` as above.
