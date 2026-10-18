/* Stackpine — site chrome: nav, stage accordion, the motion layer */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

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

  /* ---- stages: one open at a time ---- */
  document.querySelectorAll('[data-stages]').forEach(function (group) {
    var stages = group.querySelectorAll('.stage');
    stages.forEach(function (stage) {
      var tab = stage.querySelector('.stage__tab');
      tab.addEventListener('click', function () {
        stages.forEach(function (s) {
          var open = s === stage;
          s.classList.toggle('is-open', open);
          s.querySelector('.stage__tab').setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
    });
  });

  /* ---- motion layer ----
     Fails SAFE: everything is visible in CSS. We hold elements back only
     when motion is allowed and IntersectionObserver exists, and a watchdog
     shows everything regardless. */
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = Array.prototype.slice.call(document.querySelectorAll('[data-enter]:not([data-enter="each"]), .shutter'));
  // long pages: every block of an "each" container is its own target
  document.querySelectorAll('[data-enter="each"]').forEach(function (box) {
    Array.prototype.forEach.call(box.children, function (child) {
      child.setAttribute('data-enter-self', '');
      targets.push(child);
    });
  });
  if (reduce || !targets.length || !('IntersectionObserver' in window)) return;

  root.classList.add('js-motion');

  targets.forEach(function (el) {
    if (!el.hasAttribute('data-enter-self')) {
      Array.prototype.forEach.call(el.children, function (child, i) {
        child.style.setProperty('--i', i);
      });
    }
    el.classList.add('is-pending');
  });

  // A shutter picture is clipped to nothing until it opens, and a clipped
  // element never reports as visible, so watch its container instead.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        (e.target._reveal || [e.target]).forEach(function (el) { el.classList.remove('is-pending'); });
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  // two frames so the held-back state paints before it animates in
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      targets.forEach(function (el) {
        var watch = el.classList.contains('shutter') ? el.parentElement : el;
        watch._reveal = (watch._reveal || []).concat(el);
        io.observe(watch);
      });
    });
  });

  setTimeout(function () {
    targets.forEach(function (el) { el.classList.remove('is-pending'); });
  }, 6000);
})();
