/* Stackpine — live command-center demo.
   Tabs share one state object, so acting in Bookings or Requests
   visibly changes the Dashboard. */
(function () {
  'use strict';

  var root = document.getElementById('demo');
  if (!root) return;

  var COLS = [
    { id: 'new',  label: 'New' },
    { id: 'wip',  label: 'In Progress' },
    { id: 'done', label: 'Done' }
  ];

  var state = {
    bookingsToday: 7,
    revenue: 8420,
    chart: [5, 8, 6, 9, 7, 11, 7],
    days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    bookings: [
      { id: 1, t: '09:00', who: 'Sarah M.',  what: 'Standard appointment', done: false },
      { id: 2, t: '11:30', who: 'Dale R.',   what: 'Consultation',          done: false },
      { id: 3, t: '14:00', who: 'Priya N.',  what: 'Follow-up visit',       done: false },
      { id: 4, t: '16:15', who: 'Marcus T.', what: 'New client intake',     done: false }
    ],
    cards: [
      { id: 1, text: 'Update the front window signage', pri: 'med',  col: 'new' },
      { id: 2, text: 'Reorder printer toner',           pri: 'low',  col: 'new' },
      { id: 3, text: 'Fix the leaking sink in back',    pri: 'high', col: 'wip' }
    ],
    feed: [
      { ic: '📅', text: 'New booking: Sarah M. — Standard appointment, 9:00 AM', t: '2m' },
      { ic: '💬', text: 'Auto-reminder text sent to tomorrow’s first booking', t: '9m' },
      { ic: '🧾', text: 'Invoice #1041 paid — $280', t: '1h' }
    ],
    seq: 100
  };

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var $ = function (sel) { return root.querySelector(sel); };

  /* ---------- tabs ---------- */
  root.querySelectorAll('.demo__tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      root.querySelectorAll('.demo__tab').forEach(function (t) {
        t.setAttribute('aria-selected', String(t === tab));
      });
      root.querySelectorAll('.demo__panel').forEach(function (p) {
        p.hidden = p.id !== 'panel-' + tab.dataset.panel;
      });
    });
  });

  /* ---------- dashboard ---------- */
  function flash(el) {
    if (!el) return;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 700);
  }

  function openCount() {
    return state.cards.filter(function (c) { return c.col !== 'done'; }).length;
  }

  function renderDash() {
    var b = $('#stat-bookings'), o = $('#stat-open'), r = $('#stat-rev');
    if (b) b.textContent = state.bookingsToday;
    if (o) o.textContent = openCount();
    if (r) r.textContent = '$' + state.revenue.toLocaleString();

    var max = Math.max.apply(null, state.chart);
    $('#chart').innerHTML = state.chart.map(function (v, i) {
      return '<div class="chart__bar"><b>' + v + '</b>' +
             '<div class="chart__fill" style="height:' + Math.round((v / max) * 100) + '%"></div>' +
             '<span>' + state.days[i] + '</span></div>';
    }).join('');

    $('#feed').innerHTML = state.feed.slice(0, 5).map(function (f, i) {
      return '<li' + (i === 0 && f.fresh ? ' class="new"' : '') + '>' +
             '<span class="feed__ic">' + f.ic + '</span>' +
             '<span>' + esc(f.text) + '</span>' +
             '<span class="feed__t">' + esc(f.t) + '</span></li>';
    }).join('');
  }

  function push(ic, text) {
    state.feed.unshift({ ic: ic, text: text, t: 'now', fresh: true });
    renderDash();
  }

  /* ---------- bookings ---------- */
  function renderBookings() {
    $('#bookings').innerHTML = state.bookings.map(function (b) {
      return '<div class="bk__row' + (b.done ? ' done' : '') + '">' +
        '<span class="bk__time">' + b.t + '</span>' +
        '<span><span class="bk__who">' + esc(b.who) + '</span><br>' +
        '<span class="bk__what">' + esc(b.what) + '</span></span>' +
        (b.done
          ? '<span class="bk__done">✓ Confirmed</span>'
          : '<button class="btn btn--ghost btn--sm" data-confirm="' + b.id + '">Confirm</button>') +
        '</div>';
    }).join('');
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-confirm]');
    if (!btn) return;
    var b = state.bookings.find(function (x) { return x.id === +btn.dataset.confirm; });
    if (!b || b.done) return;
    b.done = true;
    state.bookingsToday += 1;
    state.revenue += 280;
    state.chart[6] += 1;
    renderBookings();
    renderDash();
    flash($('#stat-bookings'));
    flash($('#stat-rev'));
    push('✅', 'Booking confirmed: ' + b.who + ' — ' + b.what);
  });

  /* ---------- requests (kanban) ---------- */
  function renderKanban() {
    $('#kanban').innerHTML = COLS.map(function (col) {
      var cards = state.cards.filter(function (c) { return c.col === col.id; });
      return '<div class="kb__col" data-col="' + col.id + '">' +
        '<h4>' + col.label + ' <b>' + cards.length + '</b></h4>' +
        (cards.length ? cards.map(function (c) {
          var i = COLS.findIndex(function (x) { return x.id === c.col; });
          return '<div class="kb__card p-' + c.pri + '" draggable="true" data-id="' + c.id + '">' +
            esc(c.text) +
            '<div class="kb__meta"><span class="kb__pri">' + c.pri + '</span>' +
            '<span class="kb__move">' +
            '<button data-move="' + c.id + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move left">‹</button>' +
            '<button data-move="' + c.id + '" data-dir="1"' + (i === COLS.length - 1 ? ' disabled' : '') + ' aria-label="Move right">›</button>' +
            '</span></div></div>';
        }).join('') : '<p class="kb__empty">Nothing here</p>') +
        '</div>';
    }).join('');
    bindDrag();
  }

  function move(id, dir) {
    var c = state.cards.find(function (x) { return x.id === id; });
    if (!c) return;
    var i = COLS.findIndex(function (x) { return x.id === c.col; }) + dir;
    if (i < 0 || i >= COLS.length) return;
    c.col = COLS[i].id;
    renderKanban();
    renderDash();
    flash($('#stat-open'));
    if (c.col === 'done') push('✅', 'Request completed: "' + c.text + '"');
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-move]');
    if (btn) move(+btn.dataset.move, +btn.dataset.dir);
  });

  function bindDrag() {
    root.querySelectorAll('.kb__card').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    });
    root.querySelectorAll('.kb__col').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('over'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('over');
        var c = state.cards.find(function (x) { return x.id === +e.dataTransfer.getData('text/plain'); });
        if (!c || c.col === col.dataset.col) return;
        c.col = col.dataset.col;
        renderKanban();
        renderDash();
        flash($('#stat-open'));
        if (c.col === 'done') push('✅', 'Request completed: "' + c.text + '"');
      });
    });
  }

  var form = $('#kb-add');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#kb-input');
      var text = input.value.trim();
      if (!text) return;
      // naive auto-prioritisation — the kind of rule a real build encodes
      var urgent = /urgent|asap|leak|broken|down|fix|emergency/i.test(text);
      var soon = /today|tomorrow|order|reorder|call/i.test(text);
      state.cards.push({
        id: ++state.seq,
        text: text,
        pri: urgent ? 'high' : soon ? 'med' : 'low',
        col: 'new'
      });
      input.value = '';
      renderKanban();
      renderDash();
      flash($('#stat-open'));
      push('📥', 'New request logged: "' + text + '"');
    });
  }

  renderDash();
  renderBookings();
  renderKanban();
})();
