/* Files new posts and their photos by month. The publish workflow runs this before each build and saves what it moves.

   The shortcut sends a post to entries/ and its photos to entries/images/. This moves:
     each post            to entries/YEAR/MONTH/, by its date (a backdated post goes by the date in its title)
     each photo it shows  to the images/ folder beside it (entries/YEAR/MONTH/images/), linked as images/NAME
   so every folder stays short, and a post's photos show in GitHub's preview of it. A photo no post shows yet (its post
   hasn't arrived) waits in entries/images/ until one does.

   Newest wins, as in one folder: a post sent again under the same name replaces the copy already filed, and a photo sent
   again under the same name replaces the one beside its post. A post whose date changes moves to its new month.

   It also tidies filenames at the top of entries/ and missives/ (see tidyName in entry.js).

   It only moves files; the workflow commits them. Anything already in place is left alone, so it's safe to run again. */
const fs = require("fs"), path = require("path");
const { postFiles, entryFrom, tidyName, photoLinks } = require("./entry.js");

const ROOT = path.join(__dirname, ".."), INBOX = "entries/images";
const abs = p => path.join(ROOT, p), exists = p => fs.existsSync(abs(p));
const read = p => fs.readFileSync(abs(p), "utf8");
const move = (from, to) => { fs.mkdirSync(path.dirname(abs(to)), {recursive: true}); fs.renameSync(abs(from), abs(to)); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(abs(to)), {recursive: true}); fs.copyFileSync(abs(from), abs(to)); };
const done = [];

/* ---- Tidy filenames at the top of entries/ and missives/ ---- */
for(const dir of ["entries", "missives"]){
  if(!exists(dir)) continue;
  for(const name of fs.readdirSync(abs(dir))){
    const tidy = tidyName(name), from = dir+"/"+name;
    if(!tidy || tidy === name || !fs.statSync(abs(from)).isFile()) continue;
    move(from, dir+"/"+tidy); done.push(`Renamed "${name}" to "${tidy}"`);
  }
}

/* ---- Each post to entries/YEAR/MONTH/ ---- */
const copies = new Map();  // filename → every copy of it in entries/
for(const p of postFiles(ROOT)){ const n = path.basename(p); copies.set(n, [...(copies.get(n) || []), p]); }
const posts = [];  // where each post is filed
for(const [name, all] of copies){
  const sent = all.find(p => path.dirname(p) === "entries");  // just arrived
  const keep = all.find(p => p !== sent) || sent;            // the copy whose history carries on
  const body = read(sent || keep), {date} = entryFrom(name, body);
  const to = `entries/${date.slice(0,4)}/${date.slice(5,7)}/${name}`;
  if(keep !== to){ move(keep, to); if(keep !== sent) done.push(`Moved ${keep} to ${to}`); }
  if(sent && sent !== keep){ fs.writeFileSync(abs(to), body); fs.unlinkSync(abs(sent)); done.push(`Replaced ${to} with the copy just sent`); }
  else if(sent) done.push(`Filed ${to}`);
  posts.push(to);
}

/* ---- Each photo a post shows, into the images/ folder beside it ---- */
const photos = (dir = "entries") => fs.readdirSync(abs(dir), {withFileTypes: true}).flatMap(d =>
  d.isDirectory() ? photos(dir+"/"+d.name) : d.name.endsWith(".md") ? [] : [dir+"/"+d.name]);
const fileOf = link => { const n = path.posix.basename(link.replace(/[?#].*$/, "")); try{ return decodeURIComponent(n); }catch(err){ return n; } };
const shows = (post, photo) => photoLinks(read(post)).some(l => fileOf(l) === path.basename(photo));
for(const post of posts){
  const here = path.posix.dirname(post);
  let body = read(post);
  for(const link of new Set(photoLinks(body))){
    const file = fileOf(link), want = here+"/images/"+file;
    if(exists(INBOX+"/"+file)){ move(INBOX+"/"+file, want); done.push(`Filed ${want}`); }
    else if(!exists(want)){
      // Somewhere else in entries/: beside the post's old month, or beside another post that shows it too
      const from = photos().find(p => path.basename(p) === file);
      if(!from) continue;  // a missing photo: leave the link as it is
      const shared = posts.some(p => p !== post && path.posix.dirname(p)+"/images/"+file === from && shows(p, from));
      shared ? copy(from, want) : move(from, want);
      done.push(`${shared ? "Copied" : "Moved"} ${from} to ${want}`);
    }
    // Link it as images/NAME, keeping anything after the name (like a ?)
    const bare = link.replace(/[?#].*$/, ""), better = "images/" + path.posix.basename(bare) + link.slice(bare.length);
    if(link !== better) body = body.split("("+link+")").join("("+better+")").split("("+link+" ").join("("+better+" ");
  }
  if(body !== read(post)){ fs.writeFileSync(abs(post), body); done.push(`Relinked the photos in ${post}`); }
}

console.log(done.length ? done.join("\n") : "Everything is already filed");
