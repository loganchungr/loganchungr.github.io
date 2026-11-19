/* Logbook: a private log for the phone. Entries are written here, kept on the device, and synced as Markdown files to a
   private GitHub repository (github.js). md.js turns entries into the editor and back; store.js keeps them on the device. */
import { idb } from "./store.js";
import { Repo, repoName } from "./github.js";
import { Dropbox, signIn, finishSignIn } from "./dropbox.js";
import * as MD from "./md.js";

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids){
  const el = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs)){
    if(k === "class") el.className = v;
    else if(k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if(v != null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}
const svg = id => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"), u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); return s; };

/* ---------------- Settings ---------------- */
const SKEY = "logbook.settings";
const DEFAULTS = {repo: "", branch: "main", token: "", font: "system", size: 3, theme: "system", ui: "small", accent: "pink", quality: "optimized", pubRepo: "", pubBranch: "", pubToken: "", storage: "github", dbxKey: "", dbxRefresh: "", dbxName: "", passHash: "", passSalt: "", lockAfter: "60"};
const S = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem(SKEY) || "{}"); } catch(err) { return {}; } })());
function saveSettings(){
  try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch(err) {}
  idb.put("kv", {...S}, "settings").catch(() => {});
}
export const FONTS = [
  ["system", "System", "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif"],
  ["serif", "New York", "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif"],
  ["rounded", "Rounded", "ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif"],
  ["mono", "Mono", "ui-monospace, 'SF Mono', Menlo, monospace"],
  ["avenir", "Avenir Next", "'Avenir Next', Avenir, 'Helvetica Neue', sans-serif"],
  ["helvetica", "Helvetica Neue", "'Helvetica Neue', Helvetica, Arial, sans-serif"],
  ["iowan", "Iowan Old Style", "'Iowan Old Style', Palatino, 'Book Antiqua', serif"],
  ["georgia", "Georgia", "Georgia, 'Times New Roman', serif"],
  ["baskerville", "Baskerville", "Baskerville, 'Baskerville Old Face', serif"],
  ["palatino", "Palatino", "Palatino, 'Palatino Linotype', 'Book Antiqua', serif"],
  ["typewriter", "American Typewriter", "'American Typewriter', 'Courier New', monospace"],
  ["courier", "Courier", "'Courier New', Courier, monospace"],
];
const SIZES = [12, 13, 14, 15, 16, 17, 18, 20];
const font = k => FONTS.find(f => f[0] === k) || FONTS[0];
const sizeIndex = px => { const i = SIZES.indexOf(+px); return i < 0 ? S.size : i; };

/* ---------------- Dates ---------------- */
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (s, o) => parseYmd(s).toLocaleDateString(undefined, o);
const monthLabel = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString(undefined, {month: "long", year: "numeric"});
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} hr ago` : new Date(t).toLocaleDateString(); };

/* ---------------- Entries ---------------- */
const entries = new Map();          // id → entry
let remote = {head: null, files: {}}; // the repository as of the last sync: {path: sha}
let repo = null;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const shortId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
/* Where entries sync: a private GitHub repository, or the app's folder in Dropbox. Both take the same calls. */
// The Dropbox app's key (dropbox.com/developers → App Console). It isn't secret; with it built in, nobody needs to make their
// own Dropbox app. Left blank, Settings asks for one.
const DROPBOX_APP_KEY = "";
const dropboxKey = () => DROPBOX_APP_KEY || S.dbxKey;
const hasGitHub = () => !!(S.repo && S.token), hasDropbox = () => !!(dropboxKey() && S.dbxRefresh);
const configured = () => S.storage === "dropbox" ? hasDropbox() : hasGitHub();
const storeFor = kind => kind === "dropbox" ? (hasDropbox() ? new Dropbox(dropboxKey(), S.dbxRefresh) : null) : (hasGitHub() ? new Repo(S.token, S.repo, S.branch || "main") : null);
const makeRepo = () => { repo = storeFor(S.storage); };
const live = () => [...entries.values()].filter(e => !e.deleted);
const newest = list => list.sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0) || (b.path || "").localeCompare(a.path || ""));

function newEntry(date){
  return {id: uid(), path: null, sha: null, md: "", syncedMd: null, date: date || today(), title: "", excerpt: "", media: [], tags: [], prefs: {}, dirty: false, deleted: false, created: Date.now(), updated: Date.now()};
}
function saveEntry(e){ entries.set(e.id, e); return idb.put("entries", e).catch(() => {}); }
function dropEntry(e){ entries.delete(e.id); return idb.del("entries", e.id).catch(() => {}); }

/* Paths in the repository: entries/2026/11/2026-11-19 title.md, photos in entries/2026/11/images/ */
const dirname = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const basename = p => p.slice(p.lastIndexOf("/") + 1);
function joinPath(dir, rel){
  const out = [];
  for(const s of `${dir}/${rel}`.split("/")){ if(!s || s === ".") continue; if(s === "..") out.pop(); else out.push(s); }
  return out.join("/");
}
const safeTitle = t => t.replace(/[*:?"<>|\\/#\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
const wantPath = e => `entries/${e.date.slice(0, 4)}/${e.date.slice(5, 7)}/${e.date}${safeTitle(e.title) ? " " + safeTitle(e.title) : ""}.md`;
function targetPath(e, taken){
  const want = wantPath(e);
  if(e.path && e.path.toLowerCase() === want.toLowerCase()) return e.path;
  let p = want, n = 2;
  while(taken.has(p) && p !== e.path) p = want.replace(/\.md$/, ` ${n++}.md`);
  return p;
}
const isLink = s => /^[a-z][a-z0-9+.-]*:/i.test(s);
function mediaPath(entryPath, rel){
  if(isLink(rel)) return null;
  let r = rel;
  try { r = decodeURI(rel); } catch(err) {}
  if(r.startsWith("/")) return r.slice(1);
  if(r.startsWith("entries/")) return r;
  return entryPath ? joinPath(dirname(entryPath), r) : null;
}
const mediaName = rel => { let n = basename(rel); try { n = decodeURIComponent(n); } catch(err) {} return n; };

/* ---------------- Photos and videos ---------------- */
let active = 0; const waiting = [];
function queue(fn){
  return new Promise((resolve, reject) => {
    const go = () => { active++; fn().then(resolve, reject).finally(() => { active--; if(waiting.length) waiting.shift()(); }); };
    active < 4 ? go() : waiting.push(go);
  });
}
// A photo or video's contents: added here and not yet synced, downloaded before, or downloaded now
async function getBlob(e, rel){
  const local = await idb.get("files", "new:" + mediaName(rel)).catch(() => null);
  if(local) return {blob: local.blob, key: "new:" + mediaName(rel)};
  const p = mediaPath(e.path, rel), sha = p && remote.files[p];
  if(!sha) return null;
  const cached = await idb.get("files", "sha:" + sha).catch(() => null);
  if(cached) return {blob: cached.blob, key: "sha:" + sha};
  if(!repo) return null;
  const blob = await queue(() => repo.raw(sha, p));
  const typed = MD.isVideo(rel) && !blob.type.startsWith("video/") ? new Blob([blob], {type: /\.mov$/i.test(rel) ? "video/quicktime" : "video/mp4"}) : blob;
  idb.put("files", {blob: typed, at: Date.now()}, "sha:" + sha).catch(() => {});
  return {blob: typed, key: "sha:" + sha};
}
const urls = new Map();
function mediaURL(e, rel, thumb){
  if(/^(https?:|data:|blob:)/i.test(rel)) return Promise.resolve(rel);
  const memo = `${thumb ? "t" : "f"}|${e.path || e.id}|${rel}`;
  if(!urls.has(memo)) urls.set(memo, (async () => {
    const got = await getBlob(e, rel);
    if(!got) return null;
    if(!thumb) return URL.createObjectURL(got.blob);
    const tk = "thumb:" + got.key;
    let t = (await idb.get("files", tk).catch(() => null))?.blob;
    if(!t){ t = await makeThumb(got.blob, MD.isVideo(rel)); if(t) idb.put("files", {blob: t, at: Date.now()}, tk).catch(() => {}); }
    return t ? URL.createObjectURL(t) : null;
  })().catch(err => { urls.delete(memo); console.warn(err); return null; }));
  return urls.get(memo);
}
async function decode(blob){
  try { return await createImageBitmap(blob); }
  catch(err) {
    const url = URL.createObjectURL(blob), img = new Image();
    try { img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
}
function draw(src, w, hgt, q = .85){
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hgt));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", q));
}
async function makeThumb(blob, video){
  try {
    if(video) return await poster(blob);
    const img = await decode(blob), s = Math.min(1, 480 / Math.min(img.width, img.height));
    return await draw(img, img.width * s, img.height * s, .8);
  } catch(err) { return null; }
}
function poster(blob){
  return new Promise(resolve => {
    const v = document.createElement("video"), url = URL.createObjectURL(blob);
    let done = false;
    const finish = b => { if(done) return; done = true; URL.revokeObjectURL(url); resolve(b); };
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.onloadeddata = () => { v.currentTime = Math.min(.15, (v.duration || 1) / 2); };
    v.onseeked = async () => { const s = Math.min(1, 480 / Math.min(v.videoWidth, v.videoHeight)); finish(await draw(v, v.videoWidth * s, v.videoHeight * s, .8)); };
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    v.src = url;
  });
}
const MAX_VIDEO = 50 * 1024 * 1024;
async function prepare(file){
  const video = file.type.startsWith("video/") || MD.isVideo(file.name);
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if(video){
    if(file.size > MAX_VIDEO) throw new Error(`That video is ${Math.round(file.size / 1048576)} MB. Videos can be up to 50 MB; try trimming it in Photos first.`);
    return {blob: file, ext: ext && /^(mov|mp4|m4v|webm)$/.test(ext) ? ext : "mp4"};
  }
  if(file.type === "image/gif" || (S.quality === "original" && /^image\/(jpeg|png|webp)$/.test(file.type)))
    return {blob: file, ext: ext === "jpeg" ? "jpg" : ext || "jpg"};
  const img = await decode(file), s = Math.min(1, 2400 / Math.max(img.width, img.height));
  return {blob: await draw(img, img.width * s, img.height * s, .86), ext: "jpg"};
}

/* ---------------- Sync ---------------- */
const sync = {state: "idle", msg: "", at: 0, timer: 0, running: null, again: false};
function scheduleSync(ms = 1200){ clearTimeout(sync.timer); sync.timer = setTimeout(runSync, ms); }
function runSync(){
  if(!configured()) return Promise.resolve();
  if(sync.running){ sync.again = true; return sync.running; }
  sync.state = "syncing"; status();
  sync.running = (async () => {
    try {
      await pull();
      await pushChanges();
      sync.state = "idle"; sync.msg = ""; sync.at = Date.now();
    } catch(err) {
      console.warn(err);
      sync.state = "error"; sync.msg = err.message || String(err);
    } finally {
      sync.running = null; status(); render();
      if(sync.again){ sync.again = false; scheduleSync(300); }
    }
  })();
  return sync.running;
}

async function pull(){
  const snap = await repo.snapshot();
  const byPath = new Map(live().concat([...entries.values()].filter(e => e.deleted)).filter(e => e.path).map(e => [e.path, e]));
  const todo = [];
  for(const [p, sha] of Object.entries(snap.files)){
    if(!/^entries\/.+\.md$/i.test(p)) continue;
    const e = byPath.get(p);
    if(e && (e.sha === sha || e.dirty)) continue;  // unchanged, or changed here too: this device's version wins
    if(cur && e && cur.e.id === e.id) continue;     // open right now; picked up next time
    todo.push([p, sha, e]);
  }
  await Promise.all(todo.map(([p, sha, e]) => queue(async () => {
    const md = await repo.text(sha, p), m = MD.meta(md, p), ent = e || newEntry();
    Object.assign(ent, {path: p, sha, md, syncedMd: md, dirty: false, title: m.title, excerpt: m.excerpt, media: m.media, tags: m.tags, prefs: m.prefs, date: m.date || ent.date});
    await saveEntry(ent);
  })));
  for(const e of [...entries.values()]) if(e.path && !(e.path in snap.files) && !e.dirty && !(cur && cur.e.id === e.id)) await dropEntry(e);
  remote = snap;
  idb.put("kv", remote, "remote").catch(() => {});
}

async function pushChanges(){
  const dirty = [...entries.values()].filter(e => e.dirty && !held.has(e.id));  // not ones that can still be undone
  if(!dirty.length) return;
  const changes = new Map(), taken = new Set(Object.keys(remote.files)), plan = [], drop = new Set();
  for(const e of dirty){
    const md = e.md;
    if(e.deleted){
      if(e.path && remote.files[e.path]) changes.set(e.path, null);
      for(const rel of MD.meta(e.syncedMd || md).media){ const p = mediaPath(e.path, rel); if(p) drop.add(p); }
      plan.push({e, md, path: null});
      continue;
    }
    const target = targetPath(e, taken);
    taken.add(target);
    if(e.path && e.path !== target && remote.files[e.path]) changes.set(e.path, null);
    const now = MD.meta(md).media.filter(r => !isLink(r));
    for(const rel of now){
      const to = mediaPath(target, rel);
      if(!to || remote.files[to] || changes.get(to)) continue;
      const local = await idb.get("files", "new:" + mediaName(rel)).catch(() => null);
      const from = e.path && mediaPath(e.path, rel);
      if(local) changes.set(to, await repo.blob(local.blob));
      else if(from && remote.files[from]){ changes.set(to, remote.files[from]); drop.add(from); }  // the entry moved to another month
    }
    for(const rel of MD.meta(e.syncedMd || "").media){ if(!now.includes(rel)){ const p = mediaPath(e.path, rel); if(p) drop.add(p); } }
    changes.set(target, await repo.blob(md));
    plan.push({e, md, path: target});
  }
  // Photos no longer shown are removed, unless another entry still shows them
  const used = new Set();
  const finalPath = new Map(plan.map(x => [x.e.id, x.path]));
  for(const e of live()){
    const p = finalPath.has(e.id) ? finalPath.get(e.id) : e.path;
    if(p) for(const rel of e.media) { const m = mediaPath(p, rel); if(m) used.add(m); }
  }
  for(const p of drop) if(!used.has(p) && remote.files[p] && !changes.get(p)) changes.set(p, null);
  if(![...changes.values()].length && !changes.size) return;

  const one = plan.length === 1 ? plan[0] : null;
  const label = one ? basename(one.path || one.e.path || "entry").replace(/\.md$/, "") : "";
  const message = one ? `${one.e.deleted ? "Delete" : one.e.path ? "Update" : "Add"} ${label}` : `Update ${plan.length} entries`;
  await repo.commit(message, [...changes].map(([path, sha]) => ({path, sha})));

  for(const [p, sha] of changes) sha ? remote.files[p] = sha : delete remote.files[p];
  idb.put("kv", remote, "remote").catch(() => {});
  for(const {e, md, path} of plan){
    if(e.deleted){ await dropEntry(e); continue; }
    const wasPath = e.path;
    e.path = path; e.sha = changes.get(path); e.syncedMd = md;
    e.dirty = e.md !== md;  // still dirty if it was edited while syncing
    if(cur && cur.e === e && wasPath !== path) urls.clear();
    // Photos added here are now in the repository: keep them as downloaded copies
    for(const rel of MD.meta(md).media){
      const k = "new:" + mediaName(rel), local = await idb.get("files", k).catch(() => null), sha = remote.files[mediaPath(path, rel)];
      if(local && sha){ await idb.put("files", local, "sha:" + sha).catch(() => {}); await idb.del("files", k).catch(() => {}); }
    }
    await saveEntry(e);
  }
}

/* ---------------- Navigation ---------------- */
const stack = [];
let tab = "calendar", ignorePop = false;
const screenOf = i => i < 0 ? $("#tabs") : $("#" + stack[i].id);
function push(id, onClose){
  const el = $("#" + id), under = screenOf(stack.length - 1);
  el.hidden = false;
  el.getBoundingClientRect();
  el.classList.add("in"); under.classList.add("under");
  stack.push({id, onClose});
  history.pushState({logbook: stack.length}, "");
}
function pop(fromHistory){
  const top = stack.pop();
  if(!top) return;
  const el = $("#" + top.id);
  el.classList.remove("in"); screenOf(stack.length - 1).classList.remove("under");
  setTimeout(() => { if(!el.classList.contains("in")) el.hidden = true; }, 450);
  top.onClose?.();
  if(!fromHistory){ ignorePop = true; history.back(); }
}
addEventListener("popstate", () => { if(ignorePop){ ignorePop = false; return; } if(stack.length) pop(true); });
function showTab(name){
  tab = name;
  $("#calendar").hidden = name !== "calendar";
  $("#list").hidden = name !== "list";
  for(const b of $$(".tabbar [data-tab]")) b.classList.toggle("on", b.dataset.tab === name);
  render();
}
// Large titles hand over to the small one in the bar as they scroll away
function watchTitles(){
  for(const scr of $$(".screen")){
    const lt = $(".large-title", scr), bar = $(".bar", scr), sc = $(".scroll", scr);
    if(!sc) continue;
    sc.addEventListener("scroll", () => bar.classList.toggle("scrolled", sc.scrollTop > (lt ? lt.offsetTop + lt.offsetHeight - 8 : 2)), {passive: true});
  }
}
// In the installed app, a swipe from the left edge goes back, as in other iPhone apps
function edgeSwipe(){
  if(!navigator.standalone && !matchMedia("(display-mode: standalone)").matches) return;
  for(const el of $$(".screen.push")){
    let x0 = null, dx = 0;
    el.addEventListener("touchstart", ev => { const t = ev.touches[0]; if(t.clientX < 24 && stack.at(-1)?.id === el.id){ x0 = t.clientX; dx = 0; el.style.transition = "none"; } }, {passive: true});
    el.addEventListener("touchmove", ev => { if(x0 == null) return; dx = Math.max(0, ev.touches[0].clientX - x0); el.style.transform = `translateX(${dx}px)`; }, {passive: true});
    el.addEventListener("touchend", () => { if(x0 == null) return; el.style.transition = ""; el.style.transform = ""; x0 = null; if(dx > 90) pop(); });
  }
}

/* ---------------- Calendar ---------------- */
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(), selDay = today();
function byDay(){
  const m = new Map();
  for(const e of newest(live())){ if(!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); }
  return m;
}
function renderCalendar(){
  const y = calMonth.getFullYear(), mo = calMonth.getMonth(), days = byDay(), now = today();
  $("#cal-month").textContent = calMonth.toLocaleDateString(undefined, {month: "long"});
  $("#cal-year").textContent = y;
  $("#cal-bar-title").textContent = calMonth.toLocaleDateString(undefined, {month: "short", year: "numeric"});
  const grid = $("#cal-grid");
  grid.replaceChildren();
  for(let i = 0, n = new Date(y, mo, 1).getDay(); i < n; i++) grid.append(h("div", {class: "day out"}));
  for(let d = 1, n = new Date(y, mo + 1, 0).getDate(); d <= n; d++){
    const key = ymd(new Date(y, mo, d)), list = days.get(key) || [];
    const cell = h("button", {class: "day" + (key === now ? " today" : "") + (key === selDay ? " sel" : "") + (list.length ? " has" : ""), "data-day": key,
      "aria-label": fmt(key, {weekday: "long", month: "long", day: "numeric"}) + (list.length ? `, ${list.length} ${list.length > 1 ? "entries" : "entry"}` : "")}, h("span", {}, String(d)));
    cell.onclick = () => { selDay = key; for(const c of $$(".day.sel", grid)) c.classList.remove("sel"); cell.classList.add("sel"); renderDay(); };
    const withMedia = list.find(e => e.media.length);
    if(withMedia) mediaURL(withMedia, withMedia.media[0], true).then(u => { if(u){ cell.style.backgroundImage = `url("${u}")`; cell.classList.add("cover"); } });
    grid.append(cell);
  }
  renderDay(days);
}
function renderDay(days = byDay()){
  const list = days.get(selDay) || [];
  $("#day-label").textContent = selDay === today() ? "Today" : fmt(selDay, {weekday: "long", month: "long", day: "numeric", year: selDay.slice(0, 4) === today().slice(0, 4) ? undefined : "numeric"});
  const box = $("#day-list");
  box.replaceChildren();
  if(!configured() && !entries.size) box.append(setupCard());
  if(list.length) box.append(h("div", {class: "group"}, list.map(e => row(e, false))));
  else box.append(h("p", {class: "empty"}, "No entries"));
}
function moveMonth(n){ calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1); renderCalendar(); }

/* ---------------- Entry list ---------------- */
const thumbs = new IntersectionObserver(items => {
  for(const it of items){
    if(!it.isIntersecting) continue;
    thumbs.unobserve(it.target);
    const e = entries.get(it.target.dataset.id), rel = e && e.media[0];
    if(rel) mediaURL(e, rel, true).then(u => { if(u) it.target.style.backgroundImage = `url("${u}")`; });
  }
}, {rootMargin: "200px"});
function row(e, showDate){
  const rel = e.media[0];
  const thumb = rel ? h("div", {class: "thumb" + (MD.isVideo(rel) ? " video" : ""), "data-id": e.id}) : null;
  if(thumb) thumbs.observe(thumb);
  const n = e.media.length, sub = e.excerpt || (n ? `${n} ${n > 1 ? "photos" : "photo"}` : "No additional text");
  const wrap = h("div", {class: "swipe"});
  const del = h("button", {class: "swipe-del", tabindex: -1, onclick: () => removeEntry(e)}, "Delete");
  const btn = h("button", {class: "row", onclick: () => { if(wrap.classList.contains("open") || Date.now() - (+wrap.dataset.swiped || 0) < 400){ closeSwipe(); return; } openEditor(e); }},
    e.dirty ? h("span", {class: "unsynced", title: "Not synced yet"}) : null,
    h("div", {class: "row-main"},
      h("div", {class: "row-title"}, e.title || "New Entry"),
      h("div", {class: "row-sub"}, showDate ? h("span", {class: "row-date"}, fmt(e.date, {month: "short", day: "numeric"})) : null, sub)),
    thumb);
  wrap.append(del, btn);
  swipeable(wrap, btn, e);
  return wrap;
}

/* Swipe left on a row: partway and it stays open on Delete; most of the way and the entry is deleted, with Undo */
const DEL_W = 88;
let openSwipe = null;
function closeSwipe(){
  if(!openSwipe) return;
  openSwipe.classList.remove("open");
  openSwipe.querySelector(".row").style.transform = "";
  openSwipe = null;
}
function swipeable(wrap, row, e){
  let x0 = 0, y0 = 0, dx = 0, base = 0, mode = null;
  row.addEventListener("touchstart", ev => {
    const t = ev.touches[0];
    x0 = t.clientX; y0 = t.clientY; dx = 0; mode = null;
    base = wrap.classList.contains("open") ? -DEL_W : 0;
    if(openSwipe && openSwipe !== wrap) closeSwipe();
  }, {passive: true});
  row.addEventListener("touchmove", ev => {
    const t = ev.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if(!mode){
      if(Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
      if(mode === "x") wrap.classList.add("dragging");
    }
    if(mode !== "x") return;
    ev.preventDefault();
    dx = Math.min(0, base + mx);
    row.style.transform = `translateX(${dx}px)`;
    wrap.classList.toggle("full", -dx > wrap.offsetWidth * .6);
  }, {passive: false});
  const end = () => {
    if(mode !== "x") return;
    mode = null;
    wrap.classList.remove("dragging");
    wrap.dataset.swiped = Date.now();
    if(-dx > wrap.offsetWidth * .6){ row.style.transform = "translateX(-100%)"; setTimeout(() => removeEntry(e), 180); }
    else if(-dx > DEL_W / 2){ row.style.transform = `translateX(${-DEL_W}px)`; wrap.classList.add("open"); openSwipe = wrap; }
    else { wrap.classList.remove("open", "full"); row.style.transform = ""; if(openSwipe === wrap) openSwipe = null; }
  };
  row.addEventListener("touchend", end);
  row.addEventListener("touchcancel", end);
}
// Deletes an entry from the list, with a few seconds to undo before it's deleted from storage
const held = new Set();
function removeEntry(e){
  openSwipe = null;
  const was = {deleted: e.deleted, dirty: e.dirty};
  held.add(e.id);
  if(e.path){ e.deleted = true; e.dirty = true; saveEntry(e); } else dropEntry(e);
  render();
  const release = () => { if(held.delete(e.id)) scheduleSync(300); };
  const timer = setTimeout(release, 5000);
  toast(`Deleted “${e.title || "New Entry"}”`, 5000, {label: "Undo", run: () => {
    clearTimeout(timer); held.delete(e.id);
    Object.assign(e, was); saveEntry(e); render();
  }});
}
function setupCard(){
  return h("div", {class: "card"},
    h("strong", {}, "Keep your entries in sync"),
    "Connect a private GitHub repository or your Dropbox, and entries sync to it as you write. Until then they stay on this device.",
    h("br"), h("button", {onclick: openSettings}, "Set Up"));
}
function renderList(){
  const q = $("#search").value.trim().toLowerCase(), box = $("#list-body");
  let list = newest(live());
  if(q) list = list.filter(e => (e.title + " " + e.md + " " + e.date).toLowerCase().includes(q));
  box.replaceChildren();
  if(!configured() && !entries.size) box.append(setupCard());
  let month = null, group = null;
  for(const e of list){
    if(e.date.slice(0, 7) !== month){
      month = e.date.slice(0, 7);
      box.append(h("h2", {class: "section-head"}, monthLabel(month)));
      box.append(group = h("div", {class: "group"}));
    }
    group.append(row(e, true));
  }
  if(!list.length && (q || entries.size)) box.append(h("p", {class: "empty"}, q ? "No results" : "No entries yet"));
  status();
}
function status(){
  const n = live().length, waiting = [...entries.values()].filter(e => e.dirty).length;
  let s = `${n} ${n === 1 ? "Entry" : "Entries"}`;
  if(!configured()) s += " · On this device";
  else if(sync.state === "syncing") s += " · Syncing…";
  else if(sync.state === "error") s += " · Couldn’t sync. Tap to try again.";
  else if(waiting) s += ` · ${waiting} not synced`;
  else if(sync.at) s += ` · Synced ${ago(sync.at)}`;
  $("#list-foot").textContent = s;
  $("#list-foot").title = sync.msg;
  if(cur){
    const e = cur.e;
    $("#ed-status").textContent = !e.md ? "" : !configured() ? "On this device" : e.dirty ? (sync.state === "syncing" ? "Syncing…" : sync.state === "error" ? "Not synced" : "Saved") : "Synced";
  }
  const foot = $("#data-foot");
  if(foot) foot.textContent = sync.state === "error" ? `Last sync failed: ${sync.msg}` : sync.at ? `Last synced ${ago(sync.at)}.` + (waiting ? ` ${waiting} waiting to sync.` : "") : waiting ? `${waiting} waiting to sync.` : "";
}
function render(){
  if(tab === "calendar") renderCalendar(); else renderList();
  status();
}

/* ---------------- The editor ---------------- */
const doc = $("#doc");
let cur = null, saved = null;
function applyDoc(prefs = {}){
  const f = font(prefs.font || S.font), px = +prefs.size || SIZES[S.size] || 15;
  doc.style.setProperty("--doc-font", f[2]);
  doc.style.setProperty("--doc-size", px + "px");
}
function openEditor(e, focus){
  if(cur) closeEditor();
  cur = {e, timer: 0, idle: 0};
  const {title, titleAlign, frag} = MD.toEditor(e.md, e.title);
  const h1 = h("h1", {}, title);
  if(titleAlign) h1.style.textAlign = titleAlign;
  if(!title) h1.append(h("br"));
  doc.replaceChildren(h1, frag);
  if(!doc.lastChild || doc.lastChild.nodeName === "H1" || doc.lastChild.classList?.contains("gallery") || doc.lastChild.classList?.contains("raw")) doc.append(h("div", {}, h("br")));
  applyDoc(e.prefs);
  dateLine();
  hydrate();
  placeholder();
  $("#ed-back").textContent = tab === "calendar" ? "Calendar" : "Entries";
  $("#ed-scroll").scrollTop = 0;
  $("#formats").hidden = true; $("#t-format").classList.remove("on");
  push("editor", closeEditor);
  if(focus){ doc.focus({preventScroll: true}); caret(h1, false); }
  status();
}
function closeEditor(){
  if(!cur) return;
  const c = cur;
  clearTimeout(c.timer); clearTimeout(c.idle);
  if(!c.gone) persist();
  cur = null;
  doc.blur();
  $("#formats").hidden = true;
  const e = c.e;
  if(!c.gone && entries.has(e.id) && !e.title && !e.excerpt && !e.media.length && !e.path) dropEntry(e);  // an empty new entry isn't kept
  else if(e.dirty) scheduleSync(400);
  render();
}
// Saves the entry, once it has really been changed: opening one and looking around leaves its file as it was
function persist(){
  if(!cur || cur.gone || !cur.changed) return;
  const e = cur.e, md = MD.fromEditor(doc, e.prefs);
  if(md === e.md && entries.has(e.id)) return;
  if(md === e.md && !md.trim()) return;
  const m = MD.meta(md);
  Object.assign(e, {md, title: m.title, excerpt: m.excerpt, media: m.media, tags: m.tags, dirty: true, updated: Date.now()});
  saveEntry(e);
  status();
}
function edited(){
  if(!cur) return;
  cur.changed = true;
  normalize(); placeholder();
  clearTimeout(cur.timer); cur.timer = setTimeout(persist, 400);
  clearTimeout(cur.idle); cur.idle = setTimeout(() => { persist(); scheduleSync(0); }, 20000);  // saved to GitHub after 20 quiet seconds
}
function dateLine(){
  const e = cur.e;
  $("#ed-date").textContent = fmt(e.date, {weekday: "long", month: "long", day: "numeric", year: "numeric"});
  $("#ed-date-input").value = e.date;
}
function placeholder(){
  const t = doc.firstElementChild;
  if(t && t.nodeName === "H1") t.classList.toggle("untitled", !t.textContent.trim());
}
function caret(node, atEnd = true){
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(!atEnd);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
const isBlockEl = n => n.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(n.nodeName);
// The first line is always the title; text typed straight into the page is kept in lines of its own
function normalize(){
  const sel = getSelection(), an = sel.anchorNode, ao = sel.anchorOffset;
  let moved = false;
  let f = doc.firstChild;
  while(f && f.nodeType === 3 && !f.textContent.trim() && f.nextSibling){ const n = f.nextSibling; f.remove(); f = n; }
  if(!f){ const t = h("h1", {}, h("br")); doc.append(t); caret(t); return; }
  if(f.nodeName !== "H1"){
    const t = document.createElement("h1");
    if(f.nodeType === 3 || !isBlockEl(f)){ while(doc.firstChild && !isBlockEl(doc.firstChild) && !doc.firstChild.classList?.contains?.("gallery")) t.append(doc.firstChild); }
    else if(/^(P|DIV|H[2-6])$/.test(f.nodeName) && !f.classList.contains("gallery") && !f.classList.contains("raw")){ t.append(...f.childNodes); f.remove(); }
    if(!t.firstChild) t.append(h("br"));
    doc.prepend(t); moved = true;
  }
  for(const x of $$(":scope > h1:not(:first-child)", doc)){ const n = h("h2"); n.append(...x.childNodes); x.replaceWith(n); moved = true; }
  for(let n = doc.firstChild.nextSibling; n; n = n.nextSibling){
    if(n.nodeType === 3 ? n.textContent.trim() : n.nodeType === 1 && !isBlockEl(n) && !n.classList.contains("gallery") && !n.classList.contains("raw")){
      const d = h("div");
      n.before(d);
      while(d.nextSibling && (d.nextSibling.nodeType === 3 || (d.nextSibling.nodeType === 1 && !isBlockEl(d.nextSibling) && !d.nextSibling.classList.contains("gallery") && !d.nextSibling.classList.contains("raw")))) d.append(d.nextSibling);
      n = d; moved = true;
    }
  }
  if(moved && an && doc.contains(an)) try { sel.collapse(an, Math.min(ao, an.nodeType === 3 ? an.length : an.childNodes.length)); } catch(err) {}
}
function hydrate(root = doc){
  const e = cur && cur.e;
  if(!e) return;
  for(const f of $$("figure.m[data-src]", root)){
    if(f.querySelector("img")) continue;
    const grid = f.parentNode.querySelectorAll("figure").length > 1, img = h("img", {alt: ""});
    f.classList.add("loading");
    f.append(img);
    mediaURL(e, f.dataset.src, grid || f.dataset.kind === "video").then(u => {
      f.classList.remove("loading");
      if(!u) return;
      img.onload = () => img.classList.add("on");
      img.src = u;
    });
  }
}

/* Selection, kept so toolbar buttons and the photo picker act where the caret was */
document.addEventListener("selectionchange", () => {
  const s = getSelection();
  if(s.rangeCount && doc.contains(s.anchorNode)){ saved = s.getRangeAt(0).cloneRange(); formatState(); }
});
function restore(){
  if(document.activeElement !== doc) doc.focus({preventScroll: true});
  if(saved && doc.contains(saved.startContainer)){ const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
}
const keep = el => { el.addEventListener("pointerdown", e => e.preventDefault()); el.addEventListener("mousedown", e => e.preventDefault()); };
function blockAt(){
  let n = saved && saved.startContainer;
  while(n && n.parentNode !== doc) n = n.parentNode;
  return n && doc.contains(n) ? n : null;
}
function formatState(){
  if($("#formats").hidden) return;
  const b = blockAt(), tag = b ? b.nodeName : "";
  for(const x of $$("[data-block]", $("#formats"))) x.classList.toggle("on", x.dataset.block === "p" ? /^(P|DIV)$/.test(tag) : tag === x.dataset.block.toUpperCase());
  for(const x of $$("[data-cmd]", $("#formats"))) { let on = false; try { on = document.queryCommandState(x.dataset.cmd); } catch(err) {} x.classList.toggle("on", on); }
}
function format(btn){
  restore();
  const b = blockAt();
  if(btn.dataset.cmd) document.execCommand(btn.dataset.cmd, false, null);
  else if(b && b.nodeName !== "H1"){
    const want = btn.dataset.block;
    document.execCommand("formatBlock", false, `<${b.nodeName === want.toUpperCase() && want !== "p" ? "p" : want}>`);
  }
  edited(); formatState();
}

/* Adding photos and videos: they go after the line the caret is on (or into the photos just above an empty line) */
function insertionPoint(){
  let b = blockAt() || doc.lastChild;
  if(b && b.classList?.contains("gallery")) return b;
  const empty = b && b !== doc.firstChild && !b.textContent.trim() && !(b.querySelector && b.querySelector("hr"));
  if(empty && b.previousSibling?.classList?.contains("gallery")) return b.previousSibling;
  const g = MD.gallery();
  if(empty) b.replaceWith(g); else if(b) b.after(g); else doc.append(g);
  if(!g.nextSibling || g.nextSibling.classList?.contains("gallery")) g.after(h("div", {}, h("br")));
  return g;
}
async function addFiles(files){
  if(!cur || !files.length) return;
  const e = cur.e, g = insertionPoint(), next = g.nextSibling;
  if(next && document.activeElement === doc){ caret(next, true); saved = getSelection().getRangeAt(0).cloneRange(); }
  for(const file of files){
    const f = MD.figure();
    f.classList.add("loading");
    g.append(f); MD.layout(g);
    try {
      const {blob, ext} = await prepare(file), name = `${e.date}-${shortId()}.${ext}`;
      await idb.put("files", {blob, at: Date.now()}, "new:" + name);
      f.dataset.src = `images/${name}`;
      f.dataset.kind = MD.isVideo(name) ? "video" : "img";
      f.classList.remove("loading");
      hydrate(g);
    } catch(err) {
      f.remove(); MD.layout(g);
      toast(err.message || "That file couldn’t be added.");
    }
  }
  if(!g.querySelector("figure")) g.remove();
  cur.changed = true;
  persist();
}

/* The photo viewer: swipe through every photo and video in the entry */
let viewing = null;
function openViewer(fig){
  const figs = $$("figure.m[data-src]", doc), slides = $("#slides");
  viewing = {figs, i: Math.max(0, figs.indexOf(fig))};
  slides.replaceChildren(...figs.map(f => {
    const s = h("div", {class: "slide"});
    mediaURL(cur.e, f.dataset.src, false).then(u => {
      if(!u) return;
      s.append(f.dataset.kind === "video" ? h("video", {src: u, controls: true, playsinline: true, preload: "metadata"}) : h("img", {src: u, alt: ""}));
    });
    return s;
  }));
  $("#viewer").hidden = false;
  doc.blur();
  requestAnimationFrame(() => { slides.scrollLeft = viewing.i * slides.clientWidth; count(); });
}
function count(){
  const slides = $("#slides");
  if(!viewing) return;
  viewing.i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
  $("#v-count").textContent = viewing.figs.length > 1 ? `${viewing.i + 1} of ${viewing.figs.length}` : "";
  for(const v of $$("video", slides)) if(v.parentNode !== slides.children[viewing.i]) v.pause();
}
function closeViewer(){ $("#viewer").hidden = true; for(const v of $$("#slides video")) v.pause(); $("#slides").replaceChildren(); viewing = null; }
async function shareCurrent(){
  const f = viewing && viewing.figs[viewing.i];
  if(!f) return;
  const got = await getBlob(cur.e, f.dataset.src);
  if(!got) return;
  const file = new File([got.blob], mediaName(f.dataset.src), {type: got.blob.type || (f.dataset.kind === "video" ? "video/mp4" : "image/jpeg")});
  try {
    if(navigator.canShare && navigator.canShare({files: [file]})) await navigator.share({files: [file]});
    else { const a = h("a", {href: URL.createObjectURL(file), download: file.name}); a.click(); }
  } catch(err) {}
}
async function deleteCurrent(){
  const f = viewing && viewing.figs[viewing.i];
  if(!f) return;
  const ok = await sheet(null, [{label: f.dataset.kind === "video" ? "Remove Video" : "Remove Photo", destructive: true}]);
  if(!ok) return;
  const g = f.parentNode;
  f.remove(); MD.layout(g);
  if(!g.querySelector("figure")) g.remove();
  cur.changed = true;
  persist();
  closeViewer();
}

/* ---------------- Sheets, menus and toasts ---------------- */
function overlay(el, onClose){
  const back = h("div", {class: "backdrop"});
  const close = () => { el.classList.remove("in"); back.classList.remove("in"); setTimeout(() => { back.remove(); el.remove(); }, 350); onClose?.(); };
  back.onclick = close;
  $("#overlays").append(back, el);
  el.getBoundingClientRect();
  back.classList.add("in"); el.classList.add("in");
  return close;
}
function sheet(title, items){
  doc.blur();
  return new Promise(resolve => {
    let picked = null;
    const el = h("div", {class: "sheet"},
      h("div", {class: "as-group"}, title ? h("div", {class: "as-title"}, title) : null,
        items.filter(Boolean).map(it => h("button", {class: "as-btn" + (it.destructive ? " destructive" : ""), onclick: () => { picked = it; close(); }}, it.label))),
      h("div", {class: "as-group"}, h("button", {class: "as-btn cancel", onclick: () => close()}, "Cancel")));
    const close = overlay(el, () => setTimeout(() => { resolve(picked); picked?.run?.(); }, 10));
  });
}
let toastTimer = 0;
function toast(msg, ms = 3200, action){
  const t = $("#toast");
  t.replaceChildren(h("span", {}, msg));
  t.classList.toggle("act", !!action);
  if(action) t.append(h("button", {class: "toast-btn", onclick: () => { t.classList.remove("in"); action.run(); }}, action.label));
  t.classList.add("in");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("in"), ms);
}

function entryMenu(){
  if(!cur) return;
  persist();
  const e = cur.e, words = (e.md.replace(/^#.*$/m, "").replace(/!\[[^\]]*\]\([^)]*\)|<!--[\s\S]*?-->/g, "").match(/[\p{L}\p{N}’']+/gu) || []).length, n = e.media.length;
  const info = [`${words} ${words === 1 ? "word" : "words"}`, n ? `${n} ${n === 1 ? "photo or video" : "photos and videos"}` : null, e.prefs.published ? `Published to Log ${fmt(e.prefs.published, {month: "short", day: "numeric"})}` : null].filter(Boolean).join(" · ");
  sheet(info, [
    {label: "Typeface & Size", run: typeSheet},
    S.pubRepo.trim() ? {label: e.prefs.published ? "Publish Again to Log" : "Publish to Log", run: confirmPublish} : null,
    {label: "Delete Entry", destructive: true, run: confirmDelete},
  ]);
}
function typeSheet(){
  const e = cur.e;
  cur.changed = true;
  const chips = h("div", {class: "font-chips"});
  const slider = h("input", {type: "range", min: 0, max: SIZES.length - 1, step: 1, "aria-label": "Text size"});
  const paint = () => {
    for(const c of chips.children) c.classList.toggle("on", c.dataset.font === (e.prefs.font || ""));
    slider.value = sizeIndex(e.prefs.size || SIZES[S.size]);
    applyDoc(e.prefs);
  };
  chips.append(h("button", {class: "chip", "data-font": "", onclick: () => { delete e.prefs.font; paint(); persist(); }},
    h("b", {style: `font-family:${font(S.font)[2]}`}, "Aa"), h("small", {}, "Default")));
  for(const [k, name, stack] of FONTS) chips.append(h("button", {class: "chip", "data-font": k, onclick: () => { e.prefs.font = k; paint(); persist(); }},
    h("b", {style: `font-family:${stack}`}, "Aa"), h("small", {}, name)));
  slider.oninput = () => { e.prefs.size = SIZES[+slider.value]; paint(); };
  slider.onchange = () => persist();
  let close;
  const el = h("div", {class: "sheet"}, h("div", {class: "panel"},
    h("div", {class: "panel-head"}, h("h3", {}, "Typeface & Size"), h("button", {class: "bar-btn strong", onclick: () => close()}, "Done")),
    chips,
    h("div", {class: "cell size"}, h("span", {class: "a-small"}, "A"), slider, h("span", {class: "a-big"}, "A")),
    h("button", {class: "reset", onclick: () => { delete e.prefs.font; delete e.prefs.size; paint(); persist(); }}, "Use Defaults")));
  paint();
  close = overlay(el, () => persist());
  requestAnimationFrame(() => chips.querySelector(".on")?.scrollIntoView({inline: "center", block: "nearest"}));
}
async function confirmDelete(){
  const ok = await sheet("This entry and its photos will be deleted from this device and from GitHub.", [{label: "Delete Entry", destructive: true}]);
  if(!ok || !cur) return;
  const e = cur.e;
  cur.gone = true;
  if(e.path){ e.deleted = true; e.dirty = true; saveEntry(e); }
  else dropEntry(e);
  pop();
  scheduleSync(200);
}
async function confirmPublish(){
  const e = cur.e, n = e.media.length;
  const ok = await sheet(`“${e.title || "This entry"}”${n ? ` and its ${n} ${n === 1 ? "photo" : "photos"}` : ""} will be copied to ${repoName(S.pubRepo)}, and will be public once it’s published there.`, [{label: e.prefs.published ? "Publish Again" : "Publish to Log"}]);
  if(ok) publish(e);
}
async function publish(e){
  const pubToken = S.pubToken || (S.storage === "github" ? S.token : "");
  if(!pubToken){ toast("Add a GitHub token under Publish to Log in Settings first."); return; }
  toast("Publishing…", 60000);
  try {
    const pub = new Repo(pubToken, S.pubRepo, S.pubBranch || "main"), changes = [];
    const body = MD.splitPrefs(e.md).body.replace(/\s+$/, "") + "\n";
    for(const rel of MD.meta(body).media){
      if(isLink(rel)) continue;
      const got = await getBlob(e, rel);
      if(!got) throw new Error(`“${mediaName(rel)}” isn’t on this device or in the repository.`);
      changes.push({path: `entries/images/${mediaName(rel)}`, sha: await pub.blob(got.blob)});
    }
    // The Log reads photos from images/ beside the post, so every photo link points there
    const md = body.replace(/(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (m, a, rel) => isLink(rel) ? m : a + "images/" + encodeURI(mediaName(rel)));
    const name = basename(wantPath(e));
    changes.push({path: `entries/${name}`, sha: await pub.blob(md)});
    await pub.commit(`Add ${name.replace(/\.md$/, "")}`, changes);
    e.prefs.published = today();
    if(cur && cur.e === e){ cur.changed = true; persist(); } else { e.md = MD.joinPrefs(MD.splitPrefs(e.md).body, e.prefs); e.dirty = true; saveEntry(e); }
    scheduleSync();
    toast("Published. It’ll be on the Log in a minute or two.");
  } catch(err) {
    toast(`Couldn’t publish: ${err.message}`, 6000);
  }
}

/* ---------------- Passcode ---------------- */
/* A four-digit code to open Logbook on this device. Only a salted hash of it is kept, with this device's settings, so it
   isn't in the app's (public) code. It keeps out someone holding the phone; the entries themselves stay private because
   they're in a private repository that only the token can read. */
const keypad = {code: "", resolve: null};
let locked = false, hiddenAt = 0, fails = 0, waitUntil = 0;
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
const hashCode = async (code, salt) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + code)));
function padOpen(title, {cancel = false, forgot = false} = {}){
  $("#lock").hidden = false;
  $("#lock-title").textContent = title;
  $("#lock-note").textContent = "";
  $("#lock-cancel").hidden = !cancel;
  $("#lock-forgot").classList.toggle("off", !forgot);
}
function padRead(){ keypad.code = ""; dots(); return new Promise(r => keypad.resolve = r); }
function padClose(){ $("#lock").hidden = true; keypad.resolve = null; }
function dots(){ $$("#lock-dots i").forEach((d, i) => d.classList.toggle("on", i < keypad.code.length)); }
function padKey(k){
  if(!keypad.resolve) return;
  if(k === "cancel"){ const r = keypad.resolve; keypad.resolve = null; r(null); return; }
  if(k === "del"){ keypad.code = keypad.code.slice(0, -1); dots(); return; }
  if(Date.now() < waitUntil || keypad.code.length >= 4) return;
  keypad.code += k; dots();
  if(keypad.code.length === 4){ const r = keypad.resolve, c = keypad.code; keypad.resolve = null; setTimeout(() => r(c), 120); }
}
function padWrong(msg = ""){
  const d = $("#lock-dots");
  d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
  navigator.vibrate?.(80);
  $("#lock-note").textContent = msg;
}
async function lock(){
  if(locked || !S.passHash) return;
  locked = true;
  document.documentElement.classList.add("locked");
  persist(); doc.blur();
  if(viewing) closeViewer();
  padOpen("Enter Passcode", {forgot: true});
  for(;;){
    const c = await padRead();
    if(c && await hashCode(c, S.passSalt) === S.passHash) break;
    fails++;
    if(fails % 5 === 0){
      waitUntil = Date.now() + 30000;
      padWrong("Too many tries. Try again in 30 seconds.");
      setTimeout(() => { if(locked) $("#lock-note").textContent = ""; }, 30000);
    } else padWrong(fails >= 3 ? `${fails} failed attempts` : "");
  }
  fails = 0; locked = false;
  padClose();
  document.documentElement.classList.remove("locked");
}
async function checkCurrent(){
  padOpen("Enter Your Passcode", {cancel: true});
  for(;;){
    const c = await padRead();
    if(c == null){ padClose(); return false; }
    if(await hashCode(c, S.passSalt) === S.passHash){ padClose(); return true; }
    padWrong("Wrong passcode");
  }
}
async function newCode(){
  padOpen("Enter a New Passcode", {cancel: true});
  for(;;){
    const a = await padRead();
    if(a == null){ padClose(); return null; }
    $("#lock-title").textContent = "Enter It Again"; $("#lock-note").textContent = "";
    const b = await padRead();
    if(b == null){ padClose(); return null; }
    if(a === b){ padClose(); return a; }
    $("#lock-title").textContent = "Enter a New Passcode";
    padWrong("The passcodes didn’t match. Try again.");
  }
}
async function setPasscode(){
  if(S.passHash && !(await checkCurrent())) return;
  const c = await newCode();
  if(!c) return;
  S.passSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  S.passHash = await hashCode(c, S.passSalt);
  saveSettings(); paintSettings();
  toast("Passcode set.");
}
async function removePasscode(){
  if(!(await checkCurrent())) return;
  S.passHash = ""; S.passSalt = "";
  saveSettings(); paintSettings();
  toast("Passcode turned off.");
}

/* ---------------- Settings ---------------- */
function openSettings(){
  for(const i of $$("[data-set]")) i.value = S[i.dataset.set] || "";
  paintSettings();
  connectNote();
  storageView(S.storage);
  push("settings", () => { makeRepo(); render(); });
}
// Which storage's settings are showing (choosing one here doesn't switch until it's connected)
function storageView(kind){
  for(const b of $("[data-view=storage]").children) b.classList.toggle("on", b.value === kind);
  $("#st-github").hidden = kind !== "github";
  $("#st-dropbox").hidden = kind !== "dropbox";
  $("#dbx-key-cell").hidden = !!DROPBOX_APP_KEY;
  $("#dbx-help").hidden = !!DROPBOX_APP_KEY;
  $("#dbx-uri").textContent = location.origin + location.pathname;
  const using = S.storage === "dropbox" && hasDropbox();
  $("#dbx-connect").hidden = using;
  $("#dbx-connect").textContent = S.dbxRefresh ? "Sync with Dropbox" : "Connect Dropbox";
  $("#dbx-disconnect").hidden = !S.dbxRefresh;
  $("#connect").textContent = S.storage === "github" ? "Connect" : "Sync with GitHub";
  $("[data-set=pubToken]").placeholder = S.storage === "github" ? "Same as above" : "github_pat_…";
  dropboxNote();
}
function dropboxNote(msg, bad){
  const el = $("#dbx-status");
  el.className = "group-foot" + (bad ? " bad" : "");
  el.textContent = msg || (S.storage === "dropbox" && hasDropbox() ? `Syncing with ${S.dbxName ? S.dbxName + "’s " : "your "}Dropbox, in Apps → the app’s folder. Open it in the Files app to see the entries as files.`
    : S.dbxRefresh ? `Connected${S.dbxName ? " as " + S.dbxName : ""}, but syncing with GitHub. Tap above to switch; your entries are copied over.`
    : "Entries are saved as Markdown files with their photos in a folder of your Dropbox (Apps → the app’s name), so they show up in the Files app too.");
}
// Switches storage. If the new place has no entries yet, this device's are copied there (photos included), so nothing is
// left behind; the old place keeps its copy. If it already has entries, those are what you'll see.
async function adopt(kind){
  const old = repo, oldRemote = remote, changing = S.storage !== kind;
  S.storage = kind; saveSettings(); makeRepo();
  if(changing){
    const snap = await repo.snapshot(), theirs = Object.keys(snap.files).some(p => /^entries\/.+\.md$/i.test(p));
    const mine = live().filter(e => e.path || e.dirty);
    if(old && mine.length && !theirs){
      toast(`Copying ${mine.length} ${mine.length === 1 ? "entry" : "entries"}…`, 120000);
      for(const e of mine){
        for(const rel of e.media){
          if(isLink(rel)) continue;
          const key = "new:" + mediaName(rel);
          if(await idb.get("files", key).catch(() => null)) continue;
          const p = mediaPath(e.path, rel), sha = p && oldRemote.files[p];
          if(!sha) continue;
          const blob = (await idb.get("files", "sha:" + sha).catch(() => null))?.blob || await old.raw(sha, p);
          await idb.put("files", {blob, at: Date.now()}, key);
        }
        Object.assign(e, {path: null, sha: null, syncedMd: null, dirty: true});
        await saveEntry(e);
      }
      for(const e of [...entries.values()]) if(e.deleted) await dropEntry(e);
    }
    remote = {head: null, files: {}}; urls.clear();
  }
  await runSync();
  if(changing && sync.state !== "error") toast(`Syncing with ${kind === "dropbox" ? "Dropbox" : "GitHub"}.`);
  if(stack.at(-1)?.id === "settings") storageView(kind);
}
async function connectDropbox(){
  if(!dropboxKey()){ dropboxNote("Paste the Dropbox app key first.", true); return; }
  if(S.dbxRefresh){
    dropboxNote("Switching…");
    try { await adopt("dropbox"); if(sync.state === "error") throw new Error(sync.msg); } catch(err) { dropboxNote(err.message, true); }
    return;
  }
  dropboxNote("Opening Dropbox…");
  await signIn(dropboxKey(), location.origin + location.pathname);
}
async function disconnectDropbox(){
  const using = S.storage === "dropbox";
  const ok = await sheet(using ? "Logbook stops syncing with Dropbox. Entries stay in your Dropbox and on this device; connect GitHub or Dropbox again to keep syncing." : "Logbook forgets this Dropbox sign-in. Nothing in your Dropbox changes.", [{label: "Disconnect Dropbox", destructive: true}]);
  if(!ok) return;
  S.dbxRefresh = ""; S.dbxName = "";
  if(using) S.storage = "github";
  saveSettings(); repo = null; makeRepo(); storageView(using ? "dropbox" : S.storage); render();
}
// Back from Dropbox's sign-in page
async function dropboxReturn(){
  let refresh;
  try { refresh = await finishSignIn(dropboxKey()); } catch(err) { toast(err.message, 6000); return; }
  if(!refresh) return;
  S.dbxRefresh = refresh; saveSettings();
  try {
    const me = await new Dropbox(dropboxKey(), refresh).info();
    S.dbxName = me.name?.display_name || ""; saveSettings();
    await adopt("dropbox");
    if(sync.state === "error") throw new Error(sync.msg);
  } catch(err) { toast(`Dropbox: ${err.message}`, 6000); }
}
function paintSettings(){
  for(const seg of $$("[data-seg]")) for(const b of seg.children) b.classList.toggle("on", b.value === S[seg.dataset.seg]);
  $("#font-value").textContent = font(S.font)[1];
  $("#pass-set").textContent = S.passHash ? "Change Passcode" : "Turn Passcode On";
  $("#pass-off").hidden = $("#pass-after").hidden = !S.passHash;
  $("[data-size=global]").value = S.size;
  const p = $("#font-preview");
  p.style.setProperty("--doc-font", font(S.font)[2]);
  p.style.setProperty("--doc-size", SIZES[S.size] + "px");
}
function appearance(){
  const r = document.documentElement;
  if(S.theme === "light" || S.theme === "dark") r.dataset.theme = S.theme; else delete r.dataset.theme;
  r.dataset.accent = S.accent;
  r.dataset.ui = S.ui;
  if(cur) applyDoc(cur.e.prefs);
}
function connectNote(msg, bad){
  const el = $("#connect-status");
  el.className = "group-foot" + (bad ? " bad" : "");
  el.textContent = msg || (S.storage === "github" && hasGitHub() ? `Syncing with ${repoName(S.repo)}.` : "Entries are saved as Markdown files in a private GitHub repository you own.");
}
async function connect(){
  if(!hasGitHub()){ connectNote("Fill in the repository and the token first.", true); return; }
  connectNote("Connecting…");
  try {
    const info = await new Repo(S.token, S.repo, S.branch || "main").info();
    if(info.permissions && !info.permissions.push) throw new Error("The token can read this repository but can’t save to it. Give it Contents: Read and write.");
    await adopt("github");
    if(sync.state === "error") throw new Error(sync.msg);
    connectNote(info.private ? `Connected to ${info.full_name}. ${live().length} ${live().length === 1 ? "entry" : "entries"}.` : `Connected to ${info.full_name}, but it’s public: anyone can read these entries. Make it private on GitHub (Settings → Danger Zone → Change visibility).`, !info.private);
  } catch(err) { connectNote(err.message, true); }
}
function fontList(){
  const box = $("#font-list");
  box.replaceChildren(...FONTS.map(([k, name, stack]) => {
    const tick = svg("i-check"); tick.classList.add("tick");
    return h("button", {class: "cell font-row" + (S.font === k ? " on" : ""), style: `font-family:${stack}`, onclick: () => { S.font = k; saveSettings(); paintSettings(); fontList(); appearance(); }}, h("span", {}, name), tick);
  }));
}
async function clearCache(){
  const ok = await sheet("Photos downloaded from GitHub are removed from this device and downloaded again when needed. Nothing that hasn’t synced is touched.", [{label: "Clear Downloaded Copies", destructive: true}]);
  if(!ok) return;
  for(const k of await idb.keys("files").catch(() => [])) if(!String(k).startsWith("new:")) await idb.del("files", k).catch(() => {});
  for(const u of urls.values()) u.then(x => x && x.startsWith("blob:") && URL.revokeObjectURL(x));
  urls.clear();
  toast("Cleared.");
}

/* ---------------- Keyboard: the toolbar rides on top of it ---------------- */
/* While the keyboard is up, the editor is sized to the part of the screen above it (and above the bar iOS puts on top of
   it), so the toolbar, its last row, always sits just above the keyboard. */
function placeTools(){
  const vv = window.visualViewport, ed = $("#editor");
  const open = !!vv && innerHeight - vv.height > 80;
  if(open){ ed.style.top = vv.offsetTop + "px"; ed.style.height = vv.height + "px"; ed.style.bottom = "auto"; }
  else { ed.style.top = ed.style.height = ed.style.bottom = ""; }
  $("#ed-tools").classList.toggle("kb", open);
  $("#formats").style.bottom = ($("#ed-tools").offsetHeight + 8) + "px";
  $("#ed-done").hidden = !(open || document.activeElement === doc);
}

/* ---------------- Start ---------------- */
function bind(){
  for(const b of $$(".tabbar [data-tab]")) b.onclick = () => { if(tab === b.dataset.tab){ $(".scroll", $("#" + tab)).scrollTo({top: 0, behavior: "smooth"}); } showTab(b.dataset.tab); };
  $("#tab-new").onclick = () => openEditor(newEntry(today()), true);
  $("#day-new").onclick = () => openEditor(newEntry(selDay), true);
  $("#cal-prev").onclick = () => moveMonth(-1);
  $("#cal-next").onclick = () => moveMonth(1);
  $("#cal-today").onclick = () => { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); selDay = today(); renderCalendar(); };
  let sx = null, sy = 0;
  $("#cal-grid").addEventListener("touchstart", ev => { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; }, {passive: true});
  $("#cal-grid").addEventListener("touchend", ev => { if(sx == null) return; const t = ev.changedTouches[0], dx = t.clientX - sx; if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(t.clientY - sy) * 1.5) moveMonth(dx < 0 ? 1 : -1); sx = null; });
  for(const b of $$("[data-open=settings]")) b.onclick = openSettings;
  $("[data-open=fonts]").onclick = () => { fontList(); push("fonts"); };
  for(const b of $$("[data-back]")) b.onclick = () => pop();
  $("#search").oninput = renderList;
  $("#list-foot").onclick = () => { if(configured()) runSync(); else openSettings(); };

  // Editor
  doc.addEventListener("input", edited);
  doc.addEventListener("focus", placeTools);
  doc.addEventListener("blur", () => { setTimeout(placeTools, 50); persist(); });
  doc.addEventListener("click", ev => { const f = ev.target.closest("figure.m"); if(f && f.dataset.src) openViewer(f); });
  doc.addEventListener("keydown", ev => {
    // Return in the title goes to the first line of the entry, as in Notes
    const t = doc.firstElementChild, s = getSelection();
    if(ev.key === "Enter" && !ev.shiftKey && t && t.contains(s.anchorNode)){
      ev.preventDefault();
      let next = t.nextSibling;
      if(!next || !isBlockEl(next) || next.nodeName === "HR"){ next = h("div", {}, h("br")); t.after(next); }
      caret(next, false); edited();
    }
  });
  doc.addEventListener("paste", ev => {
    const files = [...(ev.clipboardData?.files || [])].filter(f => /^(image|video)\//.test(f.type));
    ev.preventDefault();
    if(files.length){ saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : saved; addFiles(files); return; }
    document.execCommand("insertText", false, ev.clipboardData.getData("text/plain"));
  });
  $("#ed-date-input").addEventListener("change", ev => {
    if(!cur || !MD.realDate(ev.target.value)) return;
    cur.e.date = ev.target.value; dateLine();
    cur.changed = true; cur.e.dirty = true; persist(); saveEntry(cur.e); status();
  });
  $("#ed-done").onclick = () => { doc.blur(); $("#formats").hidden = true; $("#t-format").classList.remove("on"); };
  $("#ed-more").onclick = entryMenu;
  const fb = $("#t-format");
  keep(fb);
  fb.onclick = () => { const fm = $("#formats"); fm.hidden = !fm.hidden; fb.classList.toggle("on", !fm.hidden); placeTools(); if(!fm.hidden){ if(document.activeElement !== doc) restore(); formatState(); } };
  for(const b of $$("#formats button")){ keep(b); b.onclick = () => format(b); }
  const mb = $("#t-media");
  keep(mb);
  mb.onclick = () => $("#file").click();
  $("#file").onchange = ev => { const files = [...ev.target.files]; ev.target.value = ""; addFiles(files); };
  if(window.visualViewport){ visualViewport.addEventListener("resize", placeTools); visualViewport.addEventListener("scroll", placeTools); }

  // Viewer
  $("#v-close").onclick = closeViewer;
  $("#v-share").onclick = shareCurrent;
  $("#v-delete").onclick = deleteCurrent;
  $("#slides").addEventListener("scroll", count, {passive: true});
  {
    const sl = $("#slides"), vw = $("#viewer");
    let x0 = 0, y0 = 0, dy = 0, mode = null;
    sl.addEventListener("touchstart", ev => { if(ev.touches.length > 1){ mode = "pinch"; return; } x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dy = 0; mode = null; }, {passive: true});
    sl.addEventListener("touchmove", ev => {
      if(mode === "pinch" || ev.touches.length > 1){ mode = "pinch"; return; }
      const mx = ev.touches[0].clientX - x0, my = ev.touches[0].clientY - y0;
      if(!mode){ if(Math.abs(mx) < 8 && Math.abs(my) < 8) return; mode = my > Math.abs(mx) ? "down" : "side"; }
      if(mode !== "down") return;
      dy = Math.max(0, my);
      sl.style.transition = "none";
      sl.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 1600})`;
      vw.style.background = `rgba(0,0,0,${1 - Math.min(dy, 300) / 400})`;
      vw.classList.add("bare");
    }, {passive: true});
    sl.addEventListener("touchend", () => {
      if(mode !== "down") return;
      mode = null;
      sl.style.transition = "transform .25s ease";
      if(dy > 110){ closeViewer(); }
      else vw.classList.remove("bare");
      sl.style.transform = ""; vw.style.background = "";
      setTimeout(() => { sl.style.transition = ""; }, 260);
    });
  }
  $("#slides").addEventListener("click", ev => { if(ev.target.nodeName !== "VIDEO") $("#viewer").classList.toggle("bare"); });
  addEventListener("keydown", ev => { if(ev.key === "Escape" && viewing) closeViewer(); });

  // Settings
  for(const i of $$("[data-set]")) i.addEventListener("input", () => { S[i.dataset.set] = i.value.trim(); saveSettings(); if(/^(repo|branch|token)$/.test(i.dataset.set) && S.storage === "github") makeRepo(); });
  for(const seg of $$("[data-seg]")) for(const b of seg.children) b.onclick = () => { S[seg.dataset.seg] = b.value; saveSettings(); paintSettings(); appearance(); };
  $("[data-size=global]").oninput = ev => { S.size = +ev.target.value; saveSettings(); paintSettings(); appearance(); };
  $("#connect").onclick = connect;
  for(const b of $("[data-view=storage]").children) b.onclick = () => storageView(b.value);
  $("#dbx-connect").onclick = connectDropbox;
  $("#dbx-disconnect").onclick = disconnectDropbox;
  $("#sync-now").onclick = async () => { if(!configured()) return connectNote("Connect a repository first.", true); await runSync(); toast(sync.state === "error" ? `Couldn’t sync: ${sync.msg}` : "Synced."); };
  $("#clear-cache").onclick = clearCache;
  $("#pass-set").onclick = setPasscode;
  $("#pass-off").onclick = removePasscode;

  // Passcode keypad (and the keyboard, on a computer)
  for(const k of $$("#lock [data-k]")) k.onclick = () => padKey(k.dataset.k);
  $("#lock-forgot").onclick = () => { $("#lock-note").textContent = "To start over, delete Logbook from the Home Screen (or clear this site’s data in Settings → Safari) and set it up again. Synced entries come back from GitHub; anything not yet synced is lost."; };
  addEventListener("keydown", ev => {
    if($("#lock").hidden) return;
    if(/^\d$/.test(ev.key)) padKey(ev.key);
    else if(ev.key === "Backspace") padKey("del");
    else if(ev.key === "Escape" && !$("#lock-cancel").hidden) padKey("cancel");
    else return;
    ev.preventDefault();
  });

  // Save when the app goes to the background; check for changes from other devices when it comes back
  document.addEventListener("visibilitychange", () => {
    if(document.hidden){
      hiddenAt = Date.now();
      persist(); if([...entries.values()].some(e => e.dirty)) runSync();
      if(S.passHash && S.lockAfter === "0") lock();  // also keeps the entry out of the app switcher's preview
    } else {
      if(S.passHash && hiddenAt && Date.now() - hiddenAt >= (+S.lockAfter || 0) * 1000) lock();
      if(configured() && Date.now() - sync.at > 60000) runSync();
    }
  });
  addEventListener("online", () => scheduleSync(500));
  watchTitles(); edgeSwipe();
}

async function start(){
  try {
    const kept = await idb.get("kv", "settings");
    if(kept && !localStorage.getItem(SKEY)){ Object.assign(S, kept); saveSettings(); }
  } catch(err) {}
  appearance(); makeRepo(); bind();
  lock();
  try {
    for(const e of await idb.all("entries")) entries.set(e.id, e);
    remote = (await idb.get("kv", "remote")) || remote;
  } catch(err) { toast("This browser isn’t letting Logbook save anything on the device.", 6000); }
  render();
  if(configured()) runSync();
  dropboxReturn();
  navigator.storage?.persist?.().catch(() => {});
  if("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
