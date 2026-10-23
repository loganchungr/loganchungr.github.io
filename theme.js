/* Light/dark toggle for Loggin' Chung.
   Follows the device setting until you click the button. Clicking again so the page matches
   the device setting returns to automatic. The choice is remembered in this browser only.
   Always sets data-theme on <html>; site.css styles the dark theme from it. */
(function () {
  var root = document.documentElement, KEY = "theme";
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  function saved() {
    try { var s = localStorage.getItem(KEY); return s === "light" || s === "dark" ? s : null; } catch (e) { return null; }
  }
  function device() { return mq.matches ? "dark" : "light"; }
  // Runs before the page paints, so there's no flash of the wrong theme.
  function apply() { root.setAttribute("data-theme", saved() || device()); }
  apply();

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function paint(btn) {
    var dark = root.getAttribute("data-theme") === "dark";
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
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try {
        if (next === device()) localStorage.removeItem(KEY);   // back to matching the device: go automatic
        else localStorage.setItem(KEY, next);
      } catch (e) {}
      root.setAttribute("data-theme", next);
      paint(btn);
    });
    var follow = function () { apply(); paint(btn); };
    if (mq.addEventListener) mq.addEventListener("change", follow); else mq.addListener(follow);
    paint(btn);
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
