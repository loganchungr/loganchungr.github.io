/* A GitHub repository as Logbook uses it: read the list of files, download one, and save a set of changes as one commit.
   Everything goes through GitHub's API with the token from Settings, so the repository can (and should) be private. */
const API = "https://api.github.com", RAW = "application/vnd.github.raw+json";

export class GitHubError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}

// A Blob as base64, for uploading photos and videos. FileReader does it natively, without copying the file into a string.
const base64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// "https://github.com/you/notes.git" or "you/notes" → "you/notes"
export const repoName = s => (s || "").trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");

export class Repo {
  constructor(token, name, branch){
    this.token = token.trim();
    this.name = repoName(name);
    this.branch = (branch || "main").trim();
    this.base = `/repos/${this.name}`;
  }

  async req(method, path, body, accept){
    let r;
    try {
      r = await fetch(API + path, {
        method, cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept || "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? {"Content-Type": "application/json"} : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch(err) {
      throw new GitHubError(0, "GitHub can’t be reached. You may be offline.");
    }
    if(!r.ok){
      let msg = "";
      try { msg = (await r.json()).message || ""; } catch(err) {}
      if(r.status === 401) msg = "GitHub didn’t accept the token. It may have expired.";
      else if(r.status === 404) msg = `GitHub can’t find ${this.name}, or the token doesn’t have access to it.`;
      else if(r.status === 403 && /rate limit/i.test(msg)) msg = "GitHub’s hourly limit was reached. Try again in a bit.";
      throw new GitHubError(r.status, msg || `GitHub said ${r.status}.`);
    }
    if(accept === RAW) return r;
    return r.status === 204 ? null : r.json();
  }

  info(){ return this.req("GET", this.base); }

  // The newest commit on the branch. A brand-new repository has none, so it gets a README first.
  async head(){
    try {
      return (await this.req("GET", `${this.base}/git/ref/heads/${encodeURI(this.branch)}`)).object.sha;
    } catch(err) {
      if(err.status !== 409) {
        if(err.status === 404) {
          const info = await this.info();  // throws its own 404 if the repository is the problem
          throw new GitHubError(404, `${this.name} has no branch named “${this.branch}”. Its main branch is “${info.default_branch}”.`);
        }
        throw err;
      }
      await this.req("PUT", `${this.base}/contents/README.md`, {
        message: "Start the logbook", branch: this.branch,
        content: btoa("# Logbook\n\nPrivate entries, written with Logbook. Each entry is a Markdown file in entries/, with its photos and videos in images/ beside it.\n"),
      });
      return this.head();
    }
  }

  // Every file in the repository, as {path: sha}
  async snapshot(){
    const head = await this.head();
    const commit = await this.req("GET", `${this.base}/git/commits/${head}`);
    const tree = await this.req("GET", `${this.base}/git/trees/${commit.tree.sha}?recursive=1`);
    const files = {};
    for(const t of tree.tree) if(t.type === "blob") files[t.path] = t.sha;
    return {head, files};
  }

  async raw(sha){ return (await this.req("GET", `${this.base}/git/blobs/${sha}`, null, RAW)).blob(); }
  async text(sha){ return (await this.raw(sha)).text(); }

  // Uploads one file's contents (a string, or a Blob for photos and videos) and returns its sha
  async blob(data){
    const body = typeof data === "string" ? {content: data, encoding: "utf-8"} : {content: await base64(data), encoding: "base64"};
    return (await this.req("POST", `${this.base}/git/blobs`, body)).sha;
  }

  // Saves changes ([{path, sha}], where sha null deletes the file) as one commit on the branch. If the branch moved in the
  // meantime (another device saved), it starts again from the new commit.
  async commit(message, changes){
    for(let attempt = 0; ; attempt++){
      const head = await this.head();
      const parent = await this.req("GET", `${this.base}/git/commits/${head}`);
      const tree = await this.req("POST", `${this.base}/git/trees`, {
        base_tree: parent.tree.sha,
        tree: changes.map(c => ({path: c.path, mode: "100644", type: "blob", sha: c.sha})),
      });
      const commit = await this.req("POST", `${this.base}/git/commits`, {message, tree: tree.sha, parents: [head]});
      try {
        await this.req("PATCH", `${this.base}/git/refs/heads/${encodeURI(this.branch)}`, {sha: commit.sha});
        return commit.sha;
      } catch(err) {
        if(err.status !== 422 || attempt >= 3) throw err;
      }
    }
  }
}
