# Later

Ideas set aside for now. This file stays in the repo only; it isn't published.

## Less JavaScript on the site

Move what the pages draw in the browser into the build, so visitors get plain HTML and CSS:

- **Home:** a built page per month with tiles that link to the post pages, "older"/"newer" links on each post, built tag pages, a day page for days with several posts, and photos that link to the full image.
- **Lookout:** `<details>` for the "i", CSS (`:has()`) for the filters, and every event on the page (or a plain "more" link).
- **Context:** the `popover` attribute for projects, a plain `<form>` for the mailing list.
- **Watch:** keep its script. The shuffled player, controls and per-video notes need it.

Still to decide: keep the remembered light/dark toggle (needs a little JS) or just follow the device setting; what replaces search (tag pages and the archive, a site-limited web search, or a small optional script); and whether last.fm's "now playing" stays live (a little JS) or comes from the build (a few hours old).

## The schedule of automatic updates

The site republishes on every push and at 9am, 3pm and 9pm New York time, to pick up new calendar events (see `schedule` and the `when` job in `.github/workflows/publish.yml`).
