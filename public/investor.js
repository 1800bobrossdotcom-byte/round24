// Investor brief — scroll-reveal, externalized so it satisfies a strict CSP
// (script-src 'self'; no inline scripts). Loaded from <head>, so the `js` flag
// lands before the body paints — no flash. If this file ever fails to load,
// the .reveal content stays visible by default (see the `.js .reveal` rule),
// so the page can never blank out on the investor.
(function () {
  var root = document.documentElement;
  root.className += ' js';

  function start() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var revs = [].slice.call(document.querySelectorAll('.reveal'));
    if (reduce || !('IntersectionObserver' in window)) {
      revs.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revs.forEach(function (el) { io.observe(el); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
