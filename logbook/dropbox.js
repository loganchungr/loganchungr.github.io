/* Dropbox as Logbook's storage, in place of GitHub. It answers the same calls as github.js (snapshot, raw, text, blob,
   commit), with the same paths, so entries land in the app's Dropbox folder (Apps → the app's name) as
   entries/2026/11/2026-11-19 title.md with photos in images/ beside it, the same as in a repository.
   Sign-in is Dropbox's OAuth with PKCE, which needs only the app key (not a secret); the refresh token it returns is kept
   on the device. */
const API = "https://api.dropboxapi.com/2", CONTENT = "https://content.dropboxapi.com/2", TOKEN = "https://api.dropboxapi.com/oauth2/token";

export class StoreError extends Error {
  constructor(status, message, summary = ""){ super(message); this.status = status; this.summary = summary; }
}
const offline = () => new StoreError(0, "Dropbox can’t be reached. You may be offline.");
const wait = ms => new Promise(r => setTimeout(r, ms));
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// The Dropbox-API-Arg header must be ASCII, so other characters (an em dash in a title) are written as \uXXXX
const argHeader = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// Dropbox's content hash: SHA-256 of each 4 MB block, then SHA-256 of those together. Working it out here means a file
// uploaded from this device is recognized later without downloading it again.
export async function contentHash(blob){
  const BLOCK = 4 * 1024 * 1024, parts = [];
  for(let i = 0; i < blob.size; i += BLOCK) parts.push(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.slice(i, i + BLOCK).arrayBuffer())));
  const all = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => all.set(p, i * 32));
  return hex(await crypto.subtle.digest("SHA-256", all));
}

/* ---- Signing in ---- */
// Sends the page to Dropbox to sign in; Dropbox sends it back to `back` with ?code=…
export async function signIn(key, back){
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem("logbook.dropbox", JSON.stringify({verifier, state, back}));
  location.href = "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({
    client_id: key, response_type: "code", token_access_type: "offline",
    code_challenge: challenge, code_challenge_method: "S256", redirect_uri: back, state,
  });
}
// On the way back: trades the code for a refresh token. Returns null when the page wasn't opened by Dropbox.
export async function finishSignIn(key){
  const q = new URLSearchParams(location.search);
  if(!q.has("code") && !q.has("error")) return null;
  history.replaceState(null, "", location.pathname);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("logbook.dropbox") || "{}"); localStorage.removeItem("logbook.dropbox"); } catch(err) {}
  if(q.has("error")) throw new StoreError(0, q.get("error") === "access_denied" ? "Dropbox wasn’t connected." : `Dropbox said: ${q.get("error_description") || q.get("error")}`);
  if(!saved.state || q.get("state") !== saved.state) throw new StoreError(0, "That Dropbox sign-in didn’t match this device. Try Connect Dropbox again.");
  let r;
  try {
    r = await fetch(TOKEN, {method: "POST", body: new URLSearchParams({code: q.get("code"), grant_type: "authorization_code", client_id: key, code_verifier: saved.verifier, redirect_uri: saved.back})});
  } catch(err) { throw offline(); }
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.refresh_token) throw new StoreError(r.status, `Dropbox didn’t finish signing in: ${j.error_description || j.error || r.status}`);
  return j.refresh_token;
}

export class Dropbox {
  constructor(key, refresh){
    this.key = key; this.refresh = refresh;
    this.access = null; this.expires = 0;
    this.pending = new Map();  // content hash → contents, uploaded by commit()
    this.byHash = new Map();   // content hash → a path that has it, for copying files that moved
  }

  async token(){
    if(this.access && Date.now() < this.expires - 60000) return this.access;
    let r;
    try { r = await fetch(TOKEN, {method: "POST", body: new URLSearchParams({grant_type: "refresh_token", refresh_token: this.refresh, client_id: this.key})}); }
    catch(err) { throw offline(); }
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new StoreError(r.status, j.error === "invalid_grant" ? "Dropbox signed Logbook out. Connect Dropbox again in Settings." : `Dropbox didn’t accept the sign-in: ${j.error_description || r.status}`);
    this.access = j.access_token;
    this.expires = Date.now() + (j.expires_in || 3600) * 1000;
    return this.access;
  }

  async call(url, {json, arg, body, raw} = {}){
    for(let attempt = 0; ; attempt++){
      const headers = {Authorization: `Bearer ${await this.token()}`};
      if(arg) headers["Dropbox-API-Arg"] = argHeader(arg);
      if(json !== undefined) headers["Content-Type"] = "application/json";
      else if(body) headers["Content-Type"] = "application/octet-stream";
      let r;
      try { r = await fetch(url, {method: "POST", headers, body: json !== undefined ? JSON.stringify(json) : body}); }
      catch(err) { throw offline(); }
      if(r.status === 401 && attempt === 0){ this.access = null; continue; }
      if((r.status === 429 || r.status >= 500) && attempt < 3){ await wait(1500 * (attempt + 1)); continue; }
      if(!r.ok){
        const t = await r.text().catch(() => "");
        let j = null;
        try { j = JSON.parse(t); } catch(err) {}
        const summary = (j && j.error_summary) || t;
        const msg = /insufficient_space/.test(summary) ? "Your Dropbox is full." : /missing_scope/.test(summary) ? "The Dropbox app is missing a permission. Give it files.content.read and files.content.write, then connect again." : `Dropbox said: ${summary || r.status}`;
        throw new StoreError(r.status, msg, summary);
      }
      return raw ? r : r.json();
    }
  }

  info(){ return this.call(API + "/users/get_current_account", {json: null}); }

  // Every file in the app's folder, as {path: content hash}
  async snapshot(){
    const files = {};
    this.byHash.clear();
    let res = await this.call(API + "/files/list_folder", {json: {path: "", recursive: true, limit: 2000}});
    for(;;){
      for(const x of res.entries) if(x[".tag"] === "file"){ files[x.path_display.slice(1)] = x.content_hash; this.byHash.set(x.content_hash, x.path_lower); }
      if(!res.has_more) break;
      res = await this.call(API + "/files/list_folder/continue", {json: {cursor: res.cursor}});
    }
    return {head: null, files};
  }

  async raw(sha, path){ return (await this.call(CONTENT + "/files/download", {arg: {path: "/" + path}, raw: true})).blob(); }
  async text(sha, path){ return (await this.raw(sha, path)).text(); }

  async blob(data){
    const b = typeof data === "string" ? new Blob([data], {type: "text/markdown"}) : data, hash = await contentHash(b);
    this.pending.set(hash, b);
    return hash;
  }

  // Applies the changes: new files are uploaded, files that moved are copied, then removed files are deleted
  async commit(message, changes){
    for(const c of changes.filter(c => c.sha)){
      const data = this.pending.get(c.sha), to = "/" + c.path;
      if(data) await this.call(CONTENT + "/files/upload", {arg: {path: to, mode: "overwrite", mute: true}, body: data});
      else {
        const from = this.byHash.get(c.sha);
        if(!from) throw new StoreError(0, `Couldn’t find the file to copy to ${c.path}.`);
        await this.call(API + "/files/copy_v2", {json: {from_path: from, to_path: to}}).catch(err => { if(!/to\/conflict/.test(err.summary)) throw err; });
      }
    }
    for(const c of changes.filter(c => !c.sha))
      await this.call(API + "/files/delete_v2", {json: {path: "/" + c.path}}).catch(err => { if(!/not_found/.test(err.summary)) throw err; });
    this.pending.clear();
  }
}
