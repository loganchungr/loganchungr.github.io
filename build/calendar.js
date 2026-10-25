/* The lookout page's list of events. build.js calls lookout() each time the site publishes (hourly, too, so new events
   show up without a post). It reads the Google Calendars' public feeds with ical.js (build/ical.min.js, MPL-2.0),
   lists the next three months of events in lookout.html, and writes an .ics file for each, so visitors can add one
   to Apple's Calendar or anything else. */
const fs = require("fs"), path = require("path");
const ICAL = require("./ical.min.js");

/* The calendars: "concert" or "other" sets the colour of an event's marker on the page */
const CALENDARS = [
  {id:"ddd7087ca46c0ed6a1093e107a0533299cabb504c3723cdc64848ac2f0db43fa@group.calendar.google.com", kind:"concert"},  // 🎶 Show Cal: Music
  {id:"775c94df85e59d08e12d84b6bf7a3a9da8e3848e132e991e08d9a21f3d7b2571@group.calendar.google.com", kind:"other"},    // 📸 Show Cal: Screenings, Readings, Art, & Other
];
const DAYS = 92;                     // how far ahead to list: about three months
const ZONE = "America/New_York";     // times are shown in New York time
const GOOGLE = "https://calendar.google.com/calendar/embed?ctz=America%2FNew_York&mode=AGENDA" +
  CALENDARS.map(c => "&src="+encodeURIComponent(c.id)).join("");  // the calendars on Google, if the list can't be built
const feed = id => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const qa = s => esc(s).replace(/"/g,"&quot;");
const entities = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,(_,c)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "})[c.toLowerCase()]||String.fromCodePoint(c[1].toLowerCase()==="x"?parseInt(c.slice(2),16):+c.slice(1)));
const out = ' target="_blank" rel="noopener"';

/* ---- Reading the feeds ---- */
// Every occurrence of every event (repeating ones too) that hasn't ended and starts within DAYS
function occurrences(text, kind, from, until){
  const cal = new ICAL.Component(ICAL.parse(text)), list = [];
  cal.getAllSubcomponents("vtimezone").forEach(z => ICAL.TimezoneService.register(z));
  const events = cal.getAllSubcomponents("vevent"), main = new Map();
  for(const v of events) if(!v.hasProperty("recurrence-id")) main.set(v.getFirstPropertyValue("uid"), new ICAL.Event(v));
  for(const v of events) if(v.hasProperty("recurrence-id")){  // one changed date of a repeating event
    const m = main.get(v.getFirstPropertyValue("uid"));
    if(m) m.relateException(v); else main.set(v.getFirstPropertyValue("uid")+"#"+v.getFirstPropertyValue("recurrence-id"), new ICAL.Event(v));
  }
  const add = (item, start, end) => {
    if(String(item.component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") return;
    const s = start.toJSDate(), e = end ? end.toJSDate() : s;
    if(e <= from && !(start.isDate && +e === +s) || s >= until) return;
    list.push({kind, item, start, end:end||start, allDay:start.isDate, s, e});
  };
  for(const ev of main.values()){
    if(!ev.isRecurring()){ add(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for(let t, n = 0; (t = it.next()) && n < 1000; n++){
      if(t.toJSDate() >= until) break;
      const d = ev.getOccurrenceDetails(t);
      add(d.item, d.startDate, d.endDate);
    }
  }
  return list;
}

/* ---- Writing the page ---- */
const fmt = (o) => new Intl.DateTimeFormat("en-US", {timeZone:ZONE, ...o});
const dayKey = d => new Intl.DateTimeFormat("en-CA", {timeZone:ZONE, year:"numeric", month:"2-digit", day:"2-digit"}).format(d);  // "2026-11-07" in New York
const dayName = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}); };
const clock = d => fmt({hour:"numeric", minute:"2-digit"}).format(d).replace(":00","").replace(/ ([AP])M/, (_,x)=>" "+x.toLowerCase()+"m");
const allDayName = t => new Date(t.year, t.month-1, t.day).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
function when(o){
  if(o.allDay){
    const last = o.end.clone(); last.adjust(-1,0,0,0);  // an all-day event's end date is the day after it
    return last.compare(o.start) > 0 ? `all day, through ${allDayName(last)}` : "all day";
  }
  const a = clock(o.s), b = clock(o.e), sameDay = dayKey(o.s) === dayKey(o.e);
  if(+o.s === +o.e) return a;
  return sameDay ? `${a}–${b}`.replace(/ (am|pm)–(.*) \1$/, "–$2 $1") : `${a} to ${fmt({weekday:"short",month:"short",day:"numeric"}).format(o.e)}, ${b}`;
}
// Google keeps some descriptions as HTML: keep their paragraphs, line breaks and links, and drop the rest
function description(raw){
  const links = [];
  let t = raw.replace(/\r/g,"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|li|h\d)>/gi,"\n").replace(/<li[^>]*>/gi,"• ")
    .replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m,h,x) => /^(https?:|mailto:)/i.test(entities(h)) ? (links.push([entities(h), entities(x.replace(/<[^>]+>/g,""))]), `\u0001${links.length-1}\u0001`) : x)
    .replace(/<[^>]+>/g,"");
  t = esc(entities(t)).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}"${out}>${u}</a>`)
    .replace(/\u0001(\d+)\u0001/g, (m,i) => `<a href="${qa(links[i][0])}"${out}>${esc(links[i][1].trim() || links[i][0])}</a>`);
  return t.trim().split(/\n\s*\n+/).map(p => `<p>${p.trim().replace(/\n/g,"<br>")}</p>`).join("");
}
// The description as plain text (for the calendar links), with each link's address kept beside its words
const plain = raw => entities(raw.replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|li)>/gi,"\n")
  .replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m,h,x) => { x = x.replace(/<[^>]+>/g,"").trim(); return !x || entities(x) === entities(h) ? h : `${x} (${h})`; })
  .replace(/<[^>]+>/g,"")).trim();
// "Add to Google Calendar": Google's own link for adding an event
function google(o, title, where, about){
  const g = t => o.allDay ? t.toString().replace(/-/g,"") : t.toJSDate().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const q = new URLSearchParams({action:"TEMPLATE", text:title, dates:`${g(o.start)}/${g(o.end)}`, ctz:ZONE});
  if(where) q.set("location", where);
  if(about) q.set("details", about.length > 1500 ? about.slice(0,1500)+"…" : about);
  return "https://calendar.google.com/calendar/render?"+q;
}
// An .ics file with just this occurrence, for Apple's Calendar and the rest
function ics(o, title, where, about, link){
  const cal = new ICAL.Component(["vcalendar",[],[]]);
  cal.updatePropertyWithValue("prodid","-//Loggin’ Chung//lookout//EN"); cal.updatePropertyWithValue("version","2.0");
  const v = new ICAL.Component("vevent"), p = (k,val) => v.updatePropertyWithValue(k,val);
  p("uid", `${o.item.uid}-${o.start.toString()}`); p("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  if(o.allDay){ p("dtstart", o.start); p("dtend", o.end); }
  else { p("dtstart", ICAL.Time.fromJSDate(o.s, true)); p("dtend", ICAL.Time.fromJSDate(o.e, true)); }
  p("summary", title); if(where) p("location", where); if(about) p("description", about); if(link) p("url", link);
  cal.addSubcomponent(v);
  return cal.toString().replace(/\r?\n/g,"\r\n")+"\r\n";
}
const slug = s => s.normalize("NFKD").replace(/[^\w]+/g,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,50) || "event";

function render(list, OUT){
  fs.mkdirSync(path.join(OUT,"events"), {recursive:true});
  const days = new Map(), taken = new Set(), today = dayKey(new Date());
  for(const o of list.sort((a,b) => a.s - b.s || String(a.item.summary).localeCompare(String(b.item.summary)))){
    const key = o.allDay ? o.start.toString().slice(0,10) : dayKey(o.s);
    const day = key < today ? today : key;  // something already under way is listed under today
    if(!days.has(day)) days.set(day, []);
    days.get(day).push(o);
  }
  return [...days].sort(([a],[b]) => a < b ? -1 : 1).map(([day, list]) => `<section class="day"><h3>${esc(dayName(day))}</h3>\n` + list.map(o => {
    const title = o.item.summary || "(untitled)", where = (o.item.location||"").trim();
    const raw = o.item.description || "", about = plain(raw), link = o.item.component.getFirstPropertyValue("url") || "";
    let file = "events/"+o.start.toString().slice(0,10)+"-"+slug(title), n = 1;
    while(taken.has(file+(n>1?"-"+n:""))) n++;
    file += (n>1?"-"+n:"")+".ics"; taken.add(file.slice(0,-4));
    fs.writeFileSync(path.join(OUT,file), ics(o, title, where, about, link));
    const more = [
      where && `<p class="where"><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(where)}"${out}>${esc(where)}</a></p>`,
      raw.trim() && `<div class="about">${description(raw)}</div>`,
      link && `<p class="link"><a href="${qa(link)}"${out}>${esc(link)}</a></p>`,
      `<p class="add"><a href="${qa(google(o, title, where, about))}"${out}>add to Google Calendar</a><a href="${file}">download .ics</a></p>`
    ].filter(Boolean).join("");
    return `<details class="event ${o.kind}"><summary><span class="time">${esc(when(o))}</span><span class="what">${esc(title)}</span></summary>${more}</details>`;
  }).join("\n") + `</section>`).join("\n") || `<p class="none">Nothing on the calendar for the next three months.</p>`;
}

/* ---- The lookout page ---- */
async function lookout(OUT){
  const from = new Date(), until = new Date(+from + DAYS*864e5), list = [];
  let trouble = false;
  for(const c of CALENDARS){
    try{
      const r = await fetch(feed(c.id), {signal: AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error(`Google answered ${r.status}`);
      const text = await r.text(), found = occurrences(text, c.kind, from, until);
      console.log(`Calendar "${(text.match(/^X-WR-CALNAME:(.*)$/m)||[])[1]||c.id}" (${c.kind}): ${found.length} upcoming`);
      list.push(...found);
    }catch(err){ trouble = true; console.log(`::warning title=Calendar::Couldn't read the ${c.kind} calendar: ${err.message}`); }
  }
  const page = path.join(OUT,"lookout.html"), shell = fs.readFileSync(page,"utf8"), mark = /<!-- events:.*?-->/;
  if(!mark.test(shell)) throw new Error("lookout.html is missing its <!-- events: --> marker");
  const note = trouble ? `<p class="none">Part of the calendar couldn’t be read just now; it tries again within the hour. Meanwhile, <a href="${qa(GOOGLE)}"${out}>see it on Google Calendar</a>.</p>\n` : "";
  fs.writeFileSync(page, shell.replace(mark, () => note + (trouble && !list.length ? "" : render(list, OUT))));
  console.log(`Lookout: ${list.length} events in the next ${DAYS} days`);
}

module.exports = {lookout, occurrences, render};
