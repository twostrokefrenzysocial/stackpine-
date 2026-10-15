/* Stackpine — site chrome: nav, scroll state, fail-safe reveals */
(function () {
  'use strict';

  /* ---- nav ---- */
  var nav = document.getElementById('nav');
  var burger = document.querySelector('.nav__burger');

  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 8);
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---- reveal on scroll ----
     Fails SAFE: .reveal is visible in CSS by default. We only opt into the
     hidden-then-animate behaviour when IntersectionObserver exists, and a
     watchdog force-reveals everything if anything goes wrong. Content must
     never be permanently invisible. */
  var nodes = document.querySelectorAll('.reveal');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showAll() {
    nodes.forEach(function (n) { n.classList.add('is-in'); });
  }

  if (!nodes.length) return;

  if (!('IntersectionObserver' in window) || reduce) {
    return; // CSS already renders them visible
  }

  document.documentElement.classList.add('js-reveal');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  nodes.forEach(function (n) { io.observe(n); });

  // Watchdog: nothing stays hidden past 2.5s.
  setTimeout(showAll, 2500);
  addEventListener('load', function () { setTimeout(showAll, 600); });
})();
