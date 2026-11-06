/* What the build scripts share: what a post is (build.js and tidy.js) and HTML text (build.js and calendar.js). */
const fs = require("fs"), path = require("path");

/* ---- HTML text ---- */
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const qa = s => esc(s).replace(/"/g,"&quot;");  // for inside an attribute
// HTML entities back to the characters they stand for (&amp; → &, &#39; → ')
const entities = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|emsp);/gi, (_,c) =>
  ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",emsp:" "})[c.toLowerCase()] || String.fromCodePoint(c[1].toLowerCase()==="x" ? parseInt(c.slice(2),16) : +c.slice(1)));

/* ---- Posts ---- */

// A post's file is named by its date: "2026-10-24 anything.md"
const isPost = name => /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(name);

// Every post in entries/, wherever it is: just sent (entries/) or filed by month (entries/2026/10/). Paths are from the
// top of the repo, oldest first by filename.
function postFiles(root, dir = "entries"){
  const out = [];
  for(const d of fs.readdirSync(path.join(root, dir), {withFileTypes: true})){
    const p = dir + "/" + d.name;
    if(d.isDirectory()){ if(d.name !== "images") out.push(...postFiles(root, p)); }
    else if(isPost(d.name)) out.push(p);
  }
  return dir === "entries" ? out.sort((a, b) => path.basename(a).localeCompare(path.basename(b))) : out;
}

/* A post's date comes from its filename, unless its title starts with a real date ("# 2026-10-22 after Digger"):
   then that date wins and is trimmed from the title, so a note can be backdated by typing the date as its first line. */
function entryFrom(name, body){
  let date = name.slice(0,10), h = body.match(/^#\s+(.+)$/m), named = name.slice(11,-3).replace(/-/g," ").trim();
  const lead = h && h[1].match(/^(\d{4})-(\d{2})-(\d{2})(?:[\s:–—-]+(.*))?$/);
  if(lead){
    const [,y,m,d,rest=""] = lead, day = new Date(+y,m-1,+d);
    if(day.getMonth()===m-1 && day.getDate()===+d){  // skip impossible dates like 2026-20-10
      date = `${y}-${m}-${d}`; named = "";  // the filename's words are the typed date, not a title
      body = body.replace(h[0], rest.trim() ? "# "+rest.trim() : "");
      h = body.match(/^#\s+(.+)$/m);
    }
  }
  return {id:name, date, title:h?h[1].replace(/[*_`]/g,"").trim():(named||date), body, untitled:!h};
}

// A filename without spaces at the start or before the extension (the shortcut sometimes adds them), or the characters
// Windows can't have in a filename (* : ? " < > | \), which come from *italics* or a colon in a title
const tidyName = name => name.replace(/[*:?"<>|\\]/g, "").replace(/\s+/g, " ").replace(/^ /, "").replace(/ +(\.[A-Za-z0-9]+)?$/, "$1");

// The photos a post links to in Markdown, ![alt](link), as written. Only links to files in the repo, not web addresses.
const photoLinks = body => [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map(m => m[1]).filter(s => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(s));

module.exports = {esc, qa, entities, isPost, postFiles, entryFrom, tidyName, photoLinks};
