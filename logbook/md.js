/* Entries ⇄ the editor.
   An entry is saved the way the Log writes posts, so either can read the other's:
     # Title
     Paragraphs, ## headings, lists and > quotes, separated by blank lines.
     ![](images/name.jpg)       photos and videos, one per line; lines next to each other make a grid
     <!-- logbook font=serif size=14 -->   this entry's own typeface and size, if it has them (invisible on the Log)
   The editor shows the title as the first line, text as editable blocks, each run of photos as a gallery, and anything
   it can't edit (code, tables, raw HTML, checklists) as a grey block that's kept exactly as written. */
const VIDEO = /\.(mov|mp4|m4v|webm)(?:[?#]|$)/i;
export const isVideo = s => VIDEO.test(s || "");
const PREFS = /\s*<!--\s*logbook\b([^>]*?)-->\s*$/;

/* ---- The settings comment at the end ---- */
export function splitPrefs(md){
  md = (md || "").replace(/\r/g, "");
  const m = md.match(PREFS), prefs = {};
  if(!m) return {body: md, prefs};
  for(const kv of m[1].trim().split(/\s+/)){
    const i = kv.indexOf("=");
    if(i > 0) try { prefs[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch(err) {}
  }
  return {body: md.slice(0, m.index), prefs};
}
export function joinPrefs(body, prefs){
  const s = Object.entries(prefs || {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join(" ");
  body = body.replace(/\s+$/, "");
  return (s ? `${body}\n\n<!-- logbook ${s} -->` : body) + "\n";
}

/* ---- Dates, titles and the rest of what lists need ---- */
export function realDate(s){
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if(!m) return null;
  const d = new Date(+m[1], m[2] - 1, +m[3]);
  return d.getMonth() === m[2] - 1 && d.getDate() === +m[3] ? m[0] : null;
}
// "2026-10-22 after Digger" → the date and "after Digger" (the Log's rule for backdating a post)
export function stripDate(t){
  const m = (t || "").match(/^(\d{4}-\d{2}-\d{2})(?!\d)[\s:–—-]*/);
  return m && realDate(m[1]) ? {date: m[1], title: t.slice(m[0].length).trim()} : {date: null, title: (t || "").trim()};
}

export function meta(md, path){
  const {body, prefs} = splitPrefs(md);
  const base = path ? path.split("/").pop().replace(/\.md$/i, "").trim() : "";
  let date = realDate(base);
  const head = body.match(/^ {0,3}#[ \t]+(.*?)[ \t#]*$/m);
  let title = head ? head[1] : base.replace(/^\d{4}-\d{2}-\d{2}/, "").replace(/^[\s_-]+/, "");
  if(!head && !/\s/.test(title)) title = title.replace(/[-_]+/g, " ");
  const lead = stripDate(title);
  if(lead.date){ date = lead.date; title = lead.title; }
  title = title.replace(/[*_`]/g, "").trim();
  const media = [];
  for(const m of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) media.push(m[1]);
  const code = body.replace(/```[\s\S]*?```|`[^`\n]*`/g, " ");
  const tags = [...new Set([...code.matchAll(/(?:^|\s)#([A-Za-z][\w-]*)/g)].map(m => m[1].toLowerCase()))];
  const excerpt = (head ? body.replace(head[0], "") : body)
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s*/gm, "").replace(/[*_`~\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return {title, date, media, tags, excerpt, prefs};
}

/* ---- Markdown → editor ---- */
const KEEP = new Set(["P", "H2", "H3", "STRONG", "B", "EM", "I", "A", "UL", "OL", "LI", "BLOCKQUOTE", "BR", "CODE", "DEL", "S", "HR"]);
// Only plain text formatting reaches the editor: other tags are unwrapped and attributes dropped (links keep their href)
function clean(node){
  for(const c of [...node.childNodes]){
    if(c.nodeType === 3) continue;
    if(c.nodeType !== 1){ c.remove(); continue; }
    clean(c);
    if(!KEEP.has(c.nodeName)){ c.replaceWith(...c.childNodes); continue; }
    for(const a of [...c.attributes]) if(!(c.nodeName === "A" && a.name === "href")) c.removeAttribute(a.name);
    if(c.nodeName === "A" && /^\s*(javascript|data|vbscript):/i.test(c.getAttribute("href") || "")) c.removeAttribute("href");
  }
}

export function figure(src){
  const f = document.createElement("figure");
  f.className = "m";
  if(src){ f.dataset.src = src; f.dataset.kind = isVideo(src) ? "video" : "img"; }
  return f;
}
export function layout(g){
  const n = g.querySelectorAll("figure").length;
  g.dataset.cols = n <= 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
}
export function gallery(srcs = []){
  const g = document.createElement("div");
  g.className = "gallery";
  g.contentEditable = "false";
  for(const s of srcs) g.append(figure(s));
  layout(g);
  return g;
}
function raw(text){
  const d = document.createElement("div");
  d.className = "raw";
  d.contentEditable = "false";
  d.dataset.raw = text.replace(/\s+$/, "");
  d.textContent = d.dataset.raw;
  return d;
}

export function toEditor(md, fallbackTitle){
  const M = globalThis.marked, {body} = splitPrefs(md), frag = document.createDocumentFragment();
  const html = s => { const t = document.createElement("template"); t.innerHTML = s; clean(t.content); return t.content; };
  let title = null, first = true;
  for(const tok of M.lexer(body)){
    if(tok.type === "space") continue;
    if(first){
      first = false;
      if(tok.type === "heading" && tok.depth === 1){ title = stripDate(tok.text.replace(/[*_`]/g, "")).title; continue; }
    }
    switch(tok.type){
      case "heading": { const n = tok.depth <= 2 ? "h2" : "h3"; frag.append(html(`<${n}>${M.parseInline(tok.text)}</${n}>`)); break; }
      case "paragraph": paragraph(tok, frag, html, M); break;
      case "list": frag.append(tok.items.some(i => i.task) ? raw(tok.raw) : html(M.parser([tok]))); break;
      case "blockquote": frag.append(html(M.parser([tok]))); break;
      case "hr": frag.append(document.createElement("hr")); break;
      default: frag.append(raw(tok.raw));
    }
  }
  return {title: title ?? (fallbackTitle || ""), frag};
}
// A paragraph's photos become galleries; the text around them stays text
function paragraph(tok, frag, html, M){
  let run = "", imgs = [];
  const text = () => { const t = run.trim(); if(t) frag.append(html(`<p>${M.parseInline(t)}</p>`)); run = ""; };
  const photos = () => { if(imgs.length) frag.append(gallery(imgs)); imgs = []; };
  for(const t of tok.tokens || []){
    if(t.type === "image"){ text(); imgs.push(t.href); continue; }
    if(imgs.length && (t.type === "br" || !t.raw.trim())) continue;
    photos();
    run += t.raw;
  }
  text(); photos();
}

/* ---- Editor → Markdown ---- */
const BLOCK = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE|FIGURE|TABLE)$/;
const isBlock = n => n.nodeType === 1 && BLOCK.test(n.nodeName);

export function fromEditor(doc, prefs){
  const kids = [...doc.childNodes], out = [];
  let title = "";
  if(kids[0] && kids[0].nodeName === "H1") title = kids.shift().textContent.replace(/\s+/g, " ").trim();
  for(const n of kids) block(n, out);
  return joinPrefs((title ? `# ${title}\n\n` : "") + out.join("\n\n"), prefs);
}

function block(n, out){
  if(n.nodeType === 3){ const t = n.textContent.replace(/ /g, " ").trim(); if(t) out.push(t); return; }
  if(n.nodeType !== 1) return;
  if(n.classList.contains("gallery")){
    const lines = [...n.querySelectorAll("figure[data-src]")].map(f => `![](${f.dataset.src})`);
    if(lines.length) out.push(lines.join("\n"));
    return;
  }
  if(n.classList.contains("raw")){ out.push(n.dataset.raw); return; }
  switch(n.nodeName){
    case "HR": out.push("---"); return;
    case "H1": case "H2": { const t = oneLine(n); if(t) out.push("## " + t); return; }
    case "H3": case "H4": case "H5": case "H6": { const t = oneLine(n); if(t) out.push("### " + t); return; }
    case "UL": case "OL": { const t = list(n, ""); if(t) out.push(t); return; }
    case "BLOCKQUOTE": {
      const inner = [];
      if([...n.childNodes].some(isBlock)) for(const k of n.childNodes) block(k, inner);
      else { const t = para(n); if(t) inner.push(t); }
      if(inner.length) out.push(inner.join("\n\n").split("\n").map(l => l.trim() ? "> " + l : ">").join("\n"));
      return;
    }
  }
  // A block holding other blocks (Safari nests them now and then): its loose text, then each block, in order
  if([...n.childNodes].some(k => isBlock(k) || (k.classList && k.classList.contains("gallery")))){
    let loose = document.createElement("div");
    const flush = () => { const t = para(loose); if(t) out.push(t); loose = document.createElement("div"); };
    for(const k of n.childNodes){
      if(isBlock(k) || (k.classList && k.classList.contains("gallery"))){ flush(); block(k, out); }
      else loose.append(k.cloneNode(true));
    }
    flush();
    return;
  }
  const t = para(n);
  if(t) out.push(t);
}

const oneLine = n => inline(n).replace(/\s*\n\s*/g, " ").trim();
// Line breaks inside a paragraph are kept as Markdown line breaks (two spaces at the end of the line)
const para = n => inline(n).split("\n").map(l => l.trim()).join("  \n").replace(/^(?:\s*\n)+|(?:\s*\n)+$/g, "").trim();

function list(n, indent){
  const lines = [];
  let i = +(n.getAttribute("start") || 1);
  for(const li of n.children){
    if(li.nodeName === "UL" || li.nodeName === "OL"){ lines.push(list(li, indent + "  ")); continue; }
    if(li.nodeName !== "LI") continue;
    const mark = n.nodeName === "OL" ? `${i++}. ` : "- ", pad = indent + " ".repeat(mark.length);
    const text = inline(li).split("\n").map(l => l.trim()).filter(Boolean).join("  \n" + pad);
    const subs = [...li.children].filter(k => k.nodeName === "UL" || k.nodeName === "OL");
    if(!text && !subs.length) continue;
    lines.push(indent + mark + text);
    for(const sub of subs) lines.push(list(sub, pad));
  }
  return lines.filter(Boolean).join("\n");
}

function wrap(mark, t){
  const core = t.trim();
  if(!core || core.includes("\n")) return t;
  return t.match(/^\s*/)[0] + mark + core + mark + t.match(/\s*$/)[0];
}
function inline(n){
  let s = "";
  for(const k of n.childNodes){
    if(k.nodeType === 3){ s += k.textContent.replace(/ /g, " "); continue; }
    if(k.nodeType !== 1) continue;
    const st = k.style || {};
    switch(k.nodeName){
      case "BR": s += "\n"; break;
      case "B": case "STRONG": s += wrap("**", inline(k)); break;
      case "I": case "EM": s += wrap("*", inline(k)); break;
      case "S": case "DEL": case "STRIKE": s += wrap("~~", inline(k)); break;
      case "CODE": s += "`" + k.textContent + "`"; break;
      case "A": {
        const href = k.getAttribute("href") || "", t = inline(k);
        s += !href ? t : t.trim() === href || "mailto:" + t.trim() === href ? href : `[${t}](${/[\s()]/.test(href) ? `<${href}>` : href})`;
        break;
      }
      case "UL": case "OL": case "IMG": break;
      default:
        if(k.classList.contains("gallery") || k.classList.contains("raw")) break;
        if(isBlock(k)){
          if(s && !s.endsWith("\n")) s += "\n";
          s += inline(k);
          if(!s.endsWith("\n")) s += "\n";
        } else if(/bold|[6-9]00/.test(st.fontWeight || "")) s += wrap("**", inline(k));
        else if(st.fontStyle === "italic") s += wrap("*", inline(k));
        else s += inline(k);
    }
  }
  return s;
}
