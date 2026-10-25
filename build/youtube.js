/* The watch page's video details. build.js calls watch() each time the site publishes. It asks YouTube's data
   service for every video in the watch page's playlists (read from PLAYLISTS in watch.html) and writes watch.json:
   each video's description, view count and upload date, which the page shows in its info box.
   Needs the YOUTUBE_API_KEY secret (Settings → Secrets and variables → Actions); without it, or if YouTube can't be
   reached, the info box just shows titles. */
const fs = require("fs"), path = require("path");
const API = "https://www.googleapis.com/youtube/v3/";

async function get(what, params){
  const r = await fetch(API + what + "?" + new URLSearchParams({...params, key: process.env.YOUTUBE_API_KEY}), {signal: AbortSignal.timeout(20000)});
  const body = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error((body.error && body.error.message) || `YouTube answered ${r.status}`);
  return body;
}

async function watch(OUT){
  if(!process.env.YOUTUBE_API_KEY){ console.log("No YOUTUBE_API_KEY, so the watch page shows titles only"); return; }
  const page = fs.readFileSync(path.join(OUT,"watch.html"), "utf8");
  const block = (page.match(/const PLAYLISTS = \{([\s\S]*?)\};/) || [])[1] || "";
  const lists = [...block.matchAll(/(\w+):\s*"([^"]+)"/g)].map(m => ({kind: m[1], id: m[2]}));
  const info = {};
  for(const list of lists){
    try{
      // Every video in the playlist, 50 at a time
      const ids = [];
      let pageToken = "";
      do{
        const r = await get("playlistItems", {part: "contentDetails", playlistId: list.id, maxResults: 50, ...(pageToken && {pageToken})});
        ids.push(...r.items.map(i => i.contentDetails.videoId));
        pageToken = r.nextPageToken || "";
      }while(pageToken);
      // Their details, 50 at a time
      for(let i = 0; i < ids.length; i += 50){
        const r = await get("videos", {part: "snippet,statistics", id: ids.slice(i, i+50).join(","), maxResults: 50});
        for(const v of r.items) info[v.id] = {
          description: (v.snippet.description || "").trim(),
          views: v.statistics && v.statistics.viewCount !== undefined ? +v.statistics.viewCount : undefined,
          uploaded: (v.snippet.publishedAt || "").slice(0,10)
        };
      }
      console.log(`YouTube playlist "${list.kind}": ${ids.length} videos`);
    }catch(err){ console.log(`::warning title=YouTube::Couldn't read the ${list.kind} playlist's details: ${err.message}`); }
  }
  fs.writeFileSync(path.join(OUT,"watch.json"), JSON.stringify(info));
  console.log(`Watch: details for ${Object.keys(info).length} videos`);
}

module.exports = {watch};
