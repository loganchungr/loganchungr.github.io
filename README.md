# Loggin’ Chung

A personal log. Posts are Markdown files in `entries/`; GitHub turns them into pages each time something is pushed.

## Writing a post

Add a file to `entries/` named `YYYY-MM-DD-anything.md`, for example `2026-10-23-a-new-thought.md`.

- The date comes from the filename and decides which day of the calendar the post lands on. To backdate a post, start its title with the date instead: `# 2026-10-22 after a long day` lands on October 22, and the date is trimmed from the title. Impossible dates (like `2026-20-10`) are ignored.
- The title is the first `# Heading` in the file. If there isn’t one, the title comes from the filename.
- Tag a post by typing `#hashtags` anywhere in the text. Hashtags inside code are ignored.
- Everything else is standard Markdown (the same rules GitHub's preview follows), and plain HTML works too. This site adds only a few rules of its own:
  - `## Heading 2`s are centered.
  - Photos on lines next to each other (blank lines between are fine) become a grid of squares; a lone photo stays full width.
  - Outside links open in a new tab.
  - Quotes written the way the shortcut writes them (a blank `>` line after every line) keep their shape: a blank line that's just `>` is a new line, and an empty line in Notes starts a new stanza. Quotes already in standard Markdown are left alone.

Commit and push. The site republishes itself in about a minute, so nothing else needs updating.

## Styles

Every page links `site.css`, which holds what they share: colors for both themes, fonts, links and nav, dotted boxes, round buttons, the lightbox, and the Pale Blue Dot background in dark mode. Each page's own `<style>` block holds only what's unique to it. To change a color or border everywhere, edit `site.css`.

`theme.js` picks light or dark (from the device setting, or the toggle button it adds) and sets `data-theme` on the page; it has no styles of its own. A new page needs both lines in its `<head>`:

```html
<script src="theme.js"></script>
<link rel="stylesheet" href="site.css">
```

## Publishing

Every push to `update-2` runs `.github/workflows/publish.yml`, which runs `build/build.js` and puts the result on GitHub Pages. The build copies the site as is and adds:

- `posts/`: each post as its own page. The lightbox loads these one at a time, and each also works on its own at its own address.
- `posts.json`: the small index the calendar draws from (dates, titles, tags, cover photos) plus the newest missives.
- `search.json`: every post's plain text, loaded only when someone uses the search box.
- `archive.html`: the list of every post by year and month is filled in where the page says `<!-- archive: … -->`. The rest of the page is edited like any other.

So a visitor downloads the page, one small index, and only the posts they open, however many posts there are. Progress and any errors show on the repo's Actions tab, which also has a "Run workflow" button to republish by hand.

Before building, it also removes any spaces at the start of a filename in `entries/` or `missives/` (the shortcut sometimes adds one) and saves the rename, so posts sort by date in the folder. If a post is re-sent with the space, the new copy replaces the old one.

This needs Settings → Pages → Source set to **GitHub Actions** (one time).

To preview locally: `node build/build.js`, then `python3 -m http.server -d _site` and open http://localhost:8000.

## Lookout

`lookout.html` lists every upcoming event from the two Google Calendars, in the site's style, with "music" and "not necessarily music" filters. The build reads the calendars' public feeds (`build/calendar.js`, using `build/ical.min.js`) and writes the list into the page, about 25 events at a time; the rest load as you scroll. Each event can be added to Google Calendar or downloaded as an `.ics` file. The list refreshes whenever the site publishes and at 9am, 3pm and 9pm New York time, so a new event shows up within a few hours without a post. To refresh it right away, use "Run workflow" on the Actions tab. Repeating events with no end date are listed up to a year ahead.

## Watch

`watch.html` plays one of two YouTube playlists, shuffled, starting on a random video. The playlists are set at the top of its script: `PLAYLISTS.tv` and `PLAYLISTS.movie` take the part after `list=` in each playlist's address (public or unlisted). Add or remove videos on YouTube and the page follows along, with no publishing needed. Your notes on the videos live in `watch-notes.csv`, a table with a row per video (`id`, `playlist`, `title`, `note`) that GitHub shows as a searchable table. Fill in the `note` column, on GitHub or in any spreadsheet app, and the note appears beside the "i" while that video plays. Each publish adds rows for new videos, refreshes titles and saves the table back; notes are never changed, and videos that leave the playlists keep their rows, marked as gone. Videos YouTube won't embed are skipped. Each video's description, view count and upload date come from YouTube's data service when the site publishes (`build/youtube.js`, saved as `watch.json`); that needs the `YOUTUBE_API_KEY` repository secret, and without it the info box shows titles only.

## Storage

Photos are nearly all of the site's size; posts are tiny. GitHub Pages allows a published site up to 1 GB, and the repo should ideally stay under 1 GB too. Deleting a photo takes it off the site, but git keeps it in the repo's history.

Each publish logs the site's size on the Actions tab. When the site reaches 75% of the limit, the publish opens an issue titled "STORAGE LIMIT at 75%", and GitHub emails you about it. It does the same at 90%, 95%, 96%, 97%, 98% and 99%, once per level.

When that happens, move a finished year's photos into their own repo (for example `loganchungr/photos-2026`) published with GitHub Pages at `loganchungr.github.io/photos-2026/`, which gets its own 1 GB, and point that year's posts at the new address.

## Mailing list

The signup form on `context.html` sends addresses to a Google Sheet through a small Apps Script. One-time setup:

1. Create a new Google Sheet. Name it anything.
2. Open Extensions → Apps Script. Delete the starter code, paste in the contents of `mailing-list.gs`, and save.
3. Click Deploy → New deployment. Choose type "Web app". Set "Execute as" to Me and "Who has access" to Anyone. Deploy, and approve the permissions prompt.
4. Copy the web app URL it gives you (it ends in `/exec`).
5. In `context.html`, paste that URL into `SIGNUP_URL` near the bottom of the file, then commit.

Addresses appear in the Sheet with a timestamp. Duplicates are ignored. If you later edit the script, use Deploy → Manage deployments → Edit → New version, or the change won’t go live. The Sheet stays private to your Google account. The URL only lets people add an address, not read the list.

To send to the list, you’ll need a way to send bulk email with an unsubscribe link and a postal address in each message. Don’t send to it from a personal inbox.
