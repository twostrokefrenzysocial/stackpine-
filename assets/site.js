/* Stackpine — site chrome: nav, the trail draw */
(function () {
  'use strict';

  /* ---- nav ---- */
  var nav = document.getElementById('nav');
  var burger = document.querySelector('.nav__burger');

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  if (burger && nav) {
    burger.addEventListener('click', function () {
      setOpen(!nav.classList.contains('is-open'));
    });
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        burger.focus();
      }
    });
  }

  /* mark the current page in the nav */
  var here = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('.nav__links a:not(.btn)').forEach(function (a) {
    if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
  });

  /* ---- the trail draws once when it comes into view ----
     Fails SAFE: the trail is fully visible in CSS. We only hide it first when
     motion is allowed and IntersectionObserver exists, and a watchdog shows
     it regardless. Content is never permanently invisible. */
  var trails = document.querySelectorAll('.trail');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!trails.length || reduce || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('js-motion');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.remove('is-pending');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -15% 0px', threshold: 0.15 });

  trails.forEach(function (t) {
    var r = t.getBoundingClientRect();
    // already on screen at load: no point hiding it
    if (r.top < innerHeight * 0.85) return;
    t.classList.add('is-pending');
    io.observe(t);
  });

  setTimeout(function () {
    trails.forEach(function (t) { t.classList.remove('is-pending'); });
  }, 8000);
})();
