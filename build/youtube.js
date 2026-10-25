/* The watch page's video details. build.js calls watch() each time the site publishes. It asks YouTube's data
   service for every video in the watch page's playlists (read from PLAYLISTS in watch.html) and writes watch.json:
   each video's description, view count and upload date, plus your note on it, which the page shows.

   Your notes live in watch-notes.csv, a table with one row per video: id, playlist, title, note. The build keeps it
   up to date: new videos get a row with an empty note, titles are refreshed, notes are never changed, and rows for
   videos that have left the playlists stay (marked as gone) so no note is lost. The publish workflow saves the
   table back to the repo when it changes.

   Needs the YOUTUBE_API_KEY secret (Settings → Secrets and variables → Actions); without it, or if YouTube can't be
   reached, the page shows titles and notes only, and the table is left as it is. */
const fs = require("fs"), path = require("path");
const API = "https://www.googleapis.com/youtube/v3/";
const ROOT = path.join(__dirname, ".."), TABLE = path.join(ROOT, "watch-notes.csv");
const COLUMNS = ["id", "playlist", "title", "note"], GONE = "(not in a playlist)";

/* ---- The notes table, as CSV (fields with commas, quotes or line breaks are quoted) ---- */
function readTable(){
  if(!fs.existsSync(TABLE)) return [];
  const text = fs.readFileSync(TABLE, "utf8").replace(/^﻿/, ""), rows = [];
  let row = [], field = "", quoted = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(quoted){
      if(c === '"' && text[i+1] === '"'){ field += '"'; i++; }
      else if(c === '"') quoted = false;
      else field += c;
    }
    else if(c === '"') quoted = true;
    else if(c === ","){ row.push(field); field = ""; }
    else if(c === "\n" || c === "\r"){
      if(c === "\r" && text[i+1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    }
    else field += c;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(f => f.trim())).map(r => Object.fromEntries(COLUMNS.map(k => [k, (r[head.indexOf(k)] ?? "").trim()])));
}
const cell = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
const writeTable = rows => fs.writeFileSync(TABLE, [COLUMNS, ...rows.map(r => COLUMNS.map(k => r[k] || ""))].map(r => r.map(cell).join(",")).join("\n") + "\n");

/* ---- YouTube ---- */
async function get(what, params){
  const r = await fetch(API + what + "?" + new URLSearchParams({...params, key: process.env.YOUTUBE_API_KEY}), {signal: AbortSignal.timeout(20000)});
  const body = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error((body.error && body.error.message) || `YouTube answered ${r.status}`);
  return body;
}

async function watch(OUT){
  const old = readTable(), notes = new Map(old.filter(r => r.note).map(r => [r.id, r.note]));
  const info = {}, rows = [];
  let complete = !!process.env.YOUTUBE_API_KEY;
  if(!complete) console.log("No YOUTUBE_API_KEY, so the watch page shows titles and notes only");
  else{
    const page = fs.readFileSync(path.join(OUT,"watch.html"), "utf8");
    const block = (page.match(/const PLAYLISTS = \{([\s\S]*?)\};/) || [])[1] || "";
    for(const [, kind, id] of block.matchAll(/(\w+):\s*"([^"]+)"/g)){
      try{
        // Every video in the playlist, in its order, 50 at a time
        const ids = [];
        let pageToken = "";
        do{
          const r = await get("playlistItems", {part: "contentDetails", playlistId: id, maxResults: 50, ...(pageToken && {pageToken})});
          ids.push(...r.items.map(i => i.contentDetails.videoId));
          pageToken = r.nextPageToken || "";
        }while(pageToken);
        // Their details, 50 at a time
        for(let i = 0; i < ids.length; i += 50){
          const r = await get("videos", {part: "snippet,statistics", id: ids.slice(i, i+50).join(","), maxResults: 50});
          for(const v of r.items) info[v.id] = {
            title: v.snippet.title || "",
            description: (v.snippet.description || "").trim(),
            views: v.statistics && v.statistics.viewCount !== undefined ? +v.statistics.viewCount : undefined,
            uploaded: (v.snippet.publishedAt || "").slice(0,10)
          };
        }
        for(const v of ids) if(!rows.some(r => r.id === v)) rows.push({id: v, playlist: kind, title: (info[v] || {}).title || "(unavailable)"});
        console.log(`YouTube playlist "${kind}": ${ids.length} videos`);
      }catch(err){ complete = false; console.log(`::warning title=YouTube::Couldn't read the ${kind} playlist's details: ${err.message}`); }
    }
  }
  // Keep the notes table in step with the playlists, once both were read in full
  if(complete){
    for(const r of old) if(!rows.some(x => x.id === r.id)) rows.push({...r, playlist: GONE});
    rows.forEach(r => r.note = notes.get(r.id) || "");
    writeTable(rows);
    console.log(`Notes table: ${rows.length} rows, ${notes.size} with notes`);
  }
  // watch.json: each video's details and note
  for(const [id, note] of notes) (info[id] = info[id] || {}).note = note;
  for(const v of Object.values(info)) delete v.title;  // the player knows the title
  fs.writeFileSync(path.join(OUT,"watch.json"), JSON.stringify(info));
  console.log(`Watch: details for ${Object.keys(info).length} videos`);
}

module.exports = {watch, readTable};
