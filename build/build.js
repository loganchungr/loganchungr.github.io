/* Builds the site into _site/ for GitHub Pages. GitHub runs this on every push to update-2
   (see .github/workflows/publish.yml), so there's nothing to run by hand.

   It copies the site as is, then adds:
     posts/*.html  each post in entries/, already turned from Markdown into a page
     posts.json    what the calendar needs: every post's date, title, tags and cover photo, plus the newest missives
     search.json   every post's plain text, which the home page loads only when someone uses the search box

   To try it yourself: node build/build.js, then serve _site/ (for example: python3 -m http.server -d _site). */
const fs = require("fs"), path = require("path");
const { Marked } = require("./marked.min.js");

const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "_site");
const ENTRIES = "entries", MISSIVES = "missives", KEEP = 10;  // KEEP: how many missives the ticker shows
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r/g, "");
// Files named by date (2026-10-24-anything.md), oldest first
const dated = dir => fs.readdirSync(path.join(ROOT, dir)).filter(n => /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(n)).sort();

/* ---- Markdown: standard Markdown via marked, plus this site's own rules ---- */
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const qa = s => esc(s).replace(/"/g,"&quot;");
/* Photo paths in a post are read relative to the entries folder, so ![](images/a.jpg) works,
   and so does ![](entries/images/a.jpg). Full web addresses are left alone. */
const imgSrc = s => /^(https?:|data:|\/|entries\/)/i.test(s) ? s : ENTRIES+"/"+s;
const photo = (alt,src) => `<img src="${qa(imgSrc(src))}" alt="${qa(alt)}" loading="lazy">`;
const markdown = new Marked({
  gfm: true,
  renderer: {
    link({href,title,tokens}){  // Site rule: outside links open in a new tab
      const out = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${qa(href)}"${title?` title="${qa(title)}"`:""}${out}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({href,text}){ return photo(text,href); }
  },
  extensions: [{  // Site rule: #hashtags become links that filter the calendar by tag
    name: "hashtag", level: "inline",
    start(src){ const m = src.match(/(^|\s)#[A-Za-z]/); return m ? m.index + m[1].length : undefined; },
    tokenizer(src){ const m = src.match(/^#([A-Za-z][\w-]*)/); if(m) return {type:"hashtag", raw:m[0], tag:m[1]}; },
    renderer({tag}){ return `<a href="#" class="tag" data-tag="${tag.toLowerCase()}">#${tag}</a>`; }
  }]
});
const IMG = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;  // a line that is just a photo
// Site rule: back-to-back photo lines (blank lines between are fine) become one grid of squares; a lone photo stays single.
function photos(src){
  const L = src.split("\n"), out = [];
  let fenced = false;
  for(let i = 0; i < L.length;){
    if(/^```/.test(L[i])) fenced = !fenced;
    if(fenced || !IMG.test(L[i])){ out.push(L[i++]); continue; }
    const run = [];
    while(i<L.length&&(IMG.test(L[i])||!L[i].trim()&&IMG.test(L.slice(i).find(x=>x.trim())||""))){ const m = L[i++].match(IMG); if(m) run.push(photo(m[1],m[2])); }
    out.push("", run.length>1 ? `<div class="photos${run.length===2?" two":""}">${run.join("")}</div>` : run[0], "");
  }
  return out.join("\n");
}
// Site rule: the shortcut writes a quote with a blank ">" line after every line. In a quote written that way, a blank line
// that's just ">" is a new line, and one with extra spaces after the ">" (an empty line in Notes) starts a new stanza.
// Quotes written in standard Markdown, with lines next to each other, are left alone.
function quotes(src){
  const L = src.split("\n"), out = [], blank = l => /^>\s*$/.test(l);
  let fenced = false;
  for(let i = 0; i < L.length;){
    if(/^```/.test(L[i])) fenced = !fenced;
    if(fenced || !/^>/.test(L[i])){ out.push(L[i++]); continue; }
    const block = [];
    while(i<L.length && /^>/.test(L[i])) block.push(L[i++]);
    if(!block.every((l,k)=>!k || blank(l) || blank(block[k-1]))){ out.push(...block); continue; }  // standard Markdown
    const lines = [];
    let gaps = 0, wide = false;  // blank lines since the last line, and whether one had the extra spaces
    for(const l of block){
      if(blank(l)){ gaps++; wide = wide || /^>[ \t]{2,}$/.test(l); continue; }
      let text = l.replace(/[\s\\]+$/,"");
      if(lines.length && !(gaps>1 || wide)){
        lines[lines.length-1] += "\\";  // a line break
        text = text.replace(/^>\s?(\d+)?([-+*.)])(\s)/,"> $1\\$2$3");  // so a line like "- San Francisco" isn't read as a list
      } else if(lines.length) lines.push(">");  // a stanza break
      lines.push(text); gaps = 0; wide = false;
    }
    out.push(...lines);
  }
  return out.join("\n");
}
const md = src => markdown.parse(photos(quotes(src)));
const inline = s => markdown.parseInline(s);
// Plain text of rendered HTML, for search
const plain = html => html.replace(/<[^>]*>/g," ")
  .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|nbsp);/gi,(_,c)=>({amp:"&",lt:"<",gt:">",quot:'"',nbsp:" "})[c.toLowerCase()]||String.fromCodePoint(c[1].toLowerCase()==="x"?parseInt(c.slice(2),16):+c.slice(1)))
  .replace(/\s+/g," ").trim();

/* ---- Posts ---- */
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
const noCode = b => b.replace(/```[\s\S]*?```/g,"").replace(/`[^`]*`/g,"");
// A web-safe page name from the filename: "2026-10-23 3-bourough day!  .md" → "2026-10-23-3-bourough-day"
const slug = name => name.slice(0,-3).normalize("NFKD").replace(/[^\w]+/g,"-").replace(/^-|-$/g,"").toLowerCase();
const longDate = s => {const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})};

// Each post also stands on its own as a plain page; the home page's lightbox shows the <article> part.
const page = (e, html) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="../">
<script src="theme.js"></script>
<title>${esc(e.title)} · Loggin’ Chung</title>
<link rel="stylesheet" href="site.css">
<style>img{display:block;max-width:100%;height:auto;margin:0 auto 1rem}article h2{text-align:center}</style>
</head>
<body>
<main>
<nav class="links"><a href="./">Loggin’ Chung</a></nav>
<p>${longDate(e.date)}</p>
<article>${html}</article>
</main>
</body>
</html>
`;

/* ---- Build ---- */
fs.rmSync(OUT, {recursive:true, force:true});
const skip = new Set([".git",".github","build","_site","node_modules"]);
for(const n of fs.readdirSync(ROOT)) if(!skip.has(n)) fs.cpSync(path.join(ROOT,n), path.join(OUT,n), {recursive:true});
fs.mkdirSync(path.join(OUT,"posts"));

const posts = [], search = {}, taken = new Set();
for(const name of dated(ENTRIES)){
  const e = entryFrom(name, read(ENTRIES, name)), html = md(e.body), body = noCode(e.body);
  const base = "posts/"+slug(name); let url = base, n = 1;
  while(taken.has(url)) url = base+"-"+(++n);  // two filenames that tidy to the same name
  taken.add(url); url += ".html";
  const imgs = [...body.matchAll(/^!\[[^\]]*\]\(([^)\s]+)\)\s*$/gm)].map(m=>imgSrc(m[1]));
  posts.push({id:name, date:e.date, title:e.title, untitled:e.untitled||undefined, url,
    tags:[...new Set([...body.matchAll(/(?:^|\s)#([A-Za-z][\w-]*)/g)].map(m=>m[1].toLowerCase()))],
    photo:imgs[0], photos:imgs.length||undefined});
  search[name] = plain(html.replace(/<h1>[\s\S]*?<\/h1>/,""));
  fs.writeFileSync(path.join(OUT,url), page(e, html));
}
posts.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));

const missives = dated(MISSIVES).reverse().slice(0,KEEP)
  .map(name=>({at:name.slice(0,-3), html:inline(read(MISSIVES,name).replace(/^#+\s*/,"").replace(/\s+/g," ").trim())}));

fs.writeFileSync(path.join(OUT,"posts.json"), JSON.stringify({posts, missives}));
fs.writeFileSync(path.join(OUT,"search.json"), JSON.stringify(search));
console.log(`Built ${posts.length} posts and ${missives.length} missives into _site/`);
