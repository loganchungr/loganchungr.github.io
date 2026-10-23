/* Light/dark toggle for Loggin' Chung.
   Follows the device setting until you click the button. Clicking again so the page matches
   the device setting returns to automatic. The choice is remembered in this browser only. */
(function () {
  var root = document.documentElement, KEY = "theme";
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  // Apply a saved choice immediately, before the page paints, so there's no flash.
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {}

  // Colors for an explicit choice. The selectors are specific enough to beat each page's own styles.
  var css =
    'html[data-theme="light"]:root{--bg:#eef1f4;--panel:#fbfcfd;--tile:#fbfcfd;--ink:#1a2130;--muted:#667085;--line:#cfd6df;--scrim:rgba(20,28,44,.55);color-scheme:light}' +
    'html[data-theme="dark"]:root{--bg:#12161e;--panel:#1b212c;--tile:#1b212c;--ink:#e6eaf1;--muted:#8b95a7;--line:#303949;--scrim:rgba(0,0,0,.65);color-scheme:dark}' +
    '.theme-toggle{position:fixed;left:1rem;bottom:calc(1rem + env(safe-area-inset-bottom,0px));z-index:5;width:2.25rem;height:2.25rem;padding:0;display:grid;place-items:center;border-radius:50%;border:1px dashed var(--line);background:var(--panel);color:var(--ink);opacity:.65;cursor:pointer}' +
    '.theme-toggle:hover,.theme-toggle:focus-visible{opacity:1}' +
    '.theme-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '.theme-toggle svg{width:1.1rem;height:1.1rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}';
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function current() {
    return root.getAttribute("data-theme") || (mq.matches ? "dark" : "light");
  }
  function paint(btn) {
    var dark = current() === "dark";
    var label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.innerHTML = dark ? SUN : MOON;   // shows what you'll switch to
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function init() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      var device = mq.matches ? "dark" : "light";
      if (next === device) {            // back to matching the device: go automatic
        root.removeAttribute("data-theme");
        try { localStorage.removeItem(KEY); } catch (e) {}
      } else {
        root.setAttribute("data-theme", next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
      }
      paint(btn);
    });
    if (mq.addEventListener) mq.addEventListener("change", function () { paint(btn); });
    paint(btn);
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
