/* Stackpine — the effects layer.
 *
 * Everything here is decoration on top of a page that already works:
 * content is visible without it, it never runs under
 * prefers-reduced-motion, and it only ever writes transform and opacity.
 * One requestAnimationFrame loop drives the scroll- and pointer-linked
 * parts; values are eased towards their targets so motion has weight.
 */
(function () {
  'use strict';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var root = document.documentElement;
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  root.classList.add('fx');

  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var vh = innerHeight;
  addEventListener('resize', function () { vh = innerHeight; layoutStack(); }, { passive: true });

  /* ---------- headlines rise word by word from behind a mask ---------- */
  document.querySelectorAll('.hero h1, .page-hero h1').forEach(function (h) {
    var i = 0;
    Array.prototype.slice.call(h.childNodes).forEach(function (node) {
      if (node.nodeType !== 3) return; // keep <br> and friends as they are
      var frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        var w = document.createElement('span');
        var inner = document.createElement('span');
        w.className = 'fx-w';
        inner.textContent = part;
        inner.style.animationDelay = (120 + i++ * 70) + 'ms';
        w.appendChild(inner);
        frag.appendChild(w);
      });
      node.parentNode.replaceChild(frag, node);
    });
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
  });

  /* ---------- the pine: builds, then reacts to scroll and pointer ---------- */
  var hero = document.querySelector('.hero');
  var layers = Array.prototype.slice.call(document.querySelectorAll('.hero__shape .pl__in'));
  var px = 0, py = 0, tx = 0, ty = 0; // pointer, eased
  if (hero && finePointer) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; });
  }

  /* ---------- chapters stack like layers ---------- */
  var stackHost = document.querySelector('[data-stack]');
  var chapters = stackHost ? Array.prototype.slice.call(stackHost.children).filter(function (el) {
    return el.tagName === 'SECTION';
  }) : [];
  chapters.forEach(function (ch) {
    ch.classList.add('fx-stack');
    var shade = document.createElement('div');
    shade.className = 'fx-shade';
    shade.setAttribute('aria-hidden', 'true');
    ch.appendChild(shade);
    ch._shade = shade;
  });
  function layoutStack() {
    // a chapter taller than the screen scrolls all the way through, then
    // pins at its bottom edge while the next one slides over it
    chapters.forEach(function (ch) {
      ch.style.top = Math.min(0, vh - ch.offsetHeight) + 'px';
    });
  }
  layoutStack();
  addEventListener('load', layoutStack);

  /* ---------- text that lights up as it is read ---------- */
  var scrubs = [];
  document.querySelectorAll('.stair__text, .names__text').forEach(function (el) {
    var parts = el.classList.contains('stair__text')
      ? el.querySelectorAll('span')
      : el.querySelectorAll('a');
    el.classList.add('fx-scrub');
    scrubs.push({ el: el, parts: Array.prototype.slice.call(parts) });
  });

  /* ---------- header pictures drift ---------- */
  var drifters = Array.prototype.slice.call(document.querySelectorAll('.page-hero__pic img, .stair__pics img'));

  /* ---------- the price counts down from the agency quote ---------- */
  var counters = document.querySelectorAll('[data-count-from]');
  if (counters.length && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        var el = e.target, from = +el.getAttribute('data-count-from'), t0 = performance.now(), dur = 1600;
        (function tick(now) {
          var k = clamp((now - t0) / dur, 0, 1);
          var eased = 1 - Math.pow(1 - k, 4);
          el.textContent = '$' + Math.round(from * (1 - eased)).toLocaleString('en-US');
          if (k < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) {
      el.textContent = '$' + (+el.getAttribute('data-count-from')).toLocaleString('en-US');
      cio.observe(el);
    });
  }

  /* ---------- buttons lean towards the pointer ---------- */
  if (finePointer) {
    document.querySelectorAll('.btn').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        b.style.translate = (dx * 8).toFixed(1) + 'px ' + (dy * 6).toFixed(1) + 'px';
      });
      b.addEventListener('pointerleave', function () { b.style.translate = ''; });
    });
  }

  /* ---------- the loop ---------- */
  var heroOut = 0;
  function frame() {
    var y = scrollY;

    // pine: exploded view on scroll, depth parallax on pointer
    if (layers.length) {
      px = lerp(px, tx, 0.08);
      py = lerp(py, ty, 0.08);
      var target = hero ? clamp(y / (hero.offsetHeight * 0.9), 0, 1) : 0;
      heroOut = lerp(heroOut, target, 0.14);
      var n = layers.length;
      layers.forEach(function (l, i) {
        var depth = i / (n - 1);            // trunk 0 → tip 1
        var spread = (i - (n - 1) / 2) * -2.6 * heroOut; // layers drift apart vertically
        var dx = px * (0.6 + depth * 2.2);
        var dy = py * (0.4 + depth * 1.2) + spread;
        l.style.transform = 'translate(' + dx.toFixed(3) + 'px,' + dy.toFixed(3) + 'px)';
      });
    }

    // chapters: the one being covered sinks back and dims
    for (var c = 0; c < chapters.length; c++) {
      var ch = chapters[c], next = chapters[c + 1];
      if (!next) { ch.style.transform = ''; ch._shade.style.opacity = 0; continue; }
      var nt = next.getBoundingClientRect().top;
      var cover = clamp(1 - nt / vh, 0, 1);
      ch.style.transform = cover > 0 ? 'scale(' + (1 - cover * 0.06).toFixed(4) + ')' : '';
      ch._shade.style.opacity = (cover * 0.55).toFixed(3);
      // fully covered: stop painting it at all
      ch.style.visibility = nt <= 0 ? 'hidden' : '';
    }

    // scrubbed text: parts light up in reading order as the block crosses the screen
    scrubs.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      var k = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35), 0, 1);
      var lit = Math.round(k * s.parts.length);
      s.parts.forEach(function (p, i) { p.classList.toggle('is-lit', i < lit); });
    });

    // pictures drift slower than the page
    drifters.forEach(function (img) {
      var r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var k = (r.top + r.height / 2 - vh / 2) / vh; // -1..1 across the screen
      img.style.transform = 'translateY(' + (k * -6).toFixed(2) + '%) scale(1.14)';
    });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
