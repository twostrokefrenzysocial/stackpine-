/* Lattimer Family Budget — vanilla front end, no build step. */
(function () {
  'use strict';

  var LS = { token: 'lfb.token', person: 'lfb.person', tab: 'lfb.tab' };

  var S = {
    token: null,
    person: null,
    month: null,
    data: null,
    tab: 'dashboard',
    filters: { category: '', person: '', type: '' },
    pinned: false,
    sse: null,
    pollTimer: null,
    sync: 'offline',
    installPrompt: null,
    busy: false,
  };

  // ------------------------------------------------------------ tiny helpers

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(n, opts) {
    opts = opts || {};
    var num = Number(n) || 0;
    var abs = Math.abs(num);
    var withCents = opts.cents === true || (opts.cents !== false && Math.round(abs * 100) % 100 !== 0);
    var body = abs.toLocaleString('en-US', {
      minimumFractionDigits: withCents ? 2 : 0,
      maximumFractionDigits: withCents ? 2 : 0,
    });
    return (num < 0 ? '-$' : '$') + body;
  }

  function monthLabel(m) {
    if (!m) return '';
    var parts = m.split('-');
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function shiftMonth(m, delta) {
    var parts = m.split('-');
    var y = Number(parts[0]);
    var mo = Number(parts[1]) - 1 + delta;
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return y + '-' + String(mo + 1).padStart(2, '0');
  }

  function dayLabel(dateStr) {
    if (!S.data) return dateStr;
    if (dateStr === S.data.today) return 'Today';
    var parts = dateStr.split('-');
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    var t = S.data.today.split('-');
    var todayUtc = Date.UTC(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
    if (todayUtc - d.getTime() === 86400000) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function shortDate(dateStr) {
    var parts = dateStr.split('-');
    return Number(parts[1]) + '/' + Number(parts[2]);
  }

  function monthDay(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /** Sunday that starts the week containing this date (matches the server). */
  function weekStartClient(dateStr) {
    var p = dateStr.split('-');
    var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    return dt.toISOString().slice(0, 10);
  }

  function lastDayOf(month) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7));
    var day = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return month + '-' + String(day).padStart(2, '0');
  }

  /** Sensible default date for a new entry in whichever month is on screen. */
  function defaultDate() {
    return S.data.month === S.data.currentMonth ? S.data.today : lastDayOf(S.data.month);
  }

  /** min/max attributes for a date field, matching what the API will accept. */
  function dateBounds() {
    return ' min="' + esc(S.data.grace.earliestDate) + '" max="' + esc(lastDayOf(S.data.currentMonth)) + '"';
  }

  function pct(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

  var toastTimer = null;
  function toast(message, kind) {
    var node = el('toast');
    node.textContent = message;
    node.dataset.kind = kind || 'info';
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, kind === 'error' ? 4200 : 2400);
  }

  // ------------------------------------------------------------ api

  function api(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    }).catch(function () {
      throw new Error('No connection — check your signal and try again.');
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401 && S.token) {
            signOut();
            throw new Error('Signed out — please sign in again.');
          }
          throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
        }
        return data;
      });
    });
  }

  /** Any write: apply the state the server hands back, or surface the error. */
  function mutate(path, opts, successMessage) {
    if (S.busy) return Promise.resolve(null);
    S.busy = true;
    return api(path, opts)
      .then(function (result) {
        // Writes always answer with the current month; don't yank someone
        // out of a past month they were reading.
        if (result && result.state && result.state.month === (S.pinned ? S.month : result.state.month)) {
          applyState(result.state);
        } else refresh(true);
        if (successMessage) toast(successMessage);
        return result;
      })
      .catch(function (err) {
        toast(err.message, 'error');
        setSync('offline');
        return null;
      })
      .then(function (result) {
        S.busy = false;
        return result;
      });
  }

  function applyState(state) {
    S.data = state;
    S.month = state.month;
    setSync(S.sse && S.sse.readyState === 1 ? 'live' : S.sync === 'offline' ? 'polling' : S.sync);
    render();
  }

  function refresh(quiet) {
    // Unless the user has browsed to another month, always ask for "current"
    // so the app rolls over on its own at the start of a new month.
    return api('/state?month=' + encodeURIComponent(S.pinned && S.month ? S.month : ''))
      .then(function (state) {
        applyState(state);
        if (S.sync === 'offline') setSync(S.sse && S.sse.readyState === 1 ? 'live' : 'polling');
      })
      .catch(function (err) {
        if (!quiet) toast(err.message, 'error');
        setSync('offline');
        // Cold launch with no signal: the cached shell loads but has no data.
        if (!S.data) {
          el('fab').hidden = true;
          el('view').innerHTML = '<div class="card empty"><p><b>No connection</b></p>' +
            '<p class="small">The app is installed and ready — it just needs a signal to load this month.</p>' +
            '<button type="button" class="btn btn-primary" data-act="retry">Try again</button></div>';
        }
      });
  }

  // ------------------------------------------------------------ auth screens

  function showLogin() {
    el('app').hidden = true;
    el('login').hidden = false;
    el('pin-input').value = '';
    updateLoginButton();
  }

  function showApp() {
    el('login').hidden = true;
    el('app').hidden = false;
    el('who-chip').textContent = S.person ? S.person.charAt(0) : '?';
    el('who-chip').title = 'Signed in as ' + S.person;
  }

  function signOut() {
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.person);
    S.token = null;
    S.person = null;
    S.data = null;
    closeSheet();
    stopRealtime();
    showLogin();
  }

  var pendingPerson = null;

  function updateLoginButton() {
    var pin = el('pin-input').value.trim();
    el('login-submit').disabled = !(pendingPerson && pin.length === 4);
  }

  function wireLogin() {
    Array.prototype.forEach.call(document.querySelectorAll('.who-btn'), function (btn) {
      btn.addEventListener('click', function () {
        pendingPerson = btn.dataset.person;
        Array.prototype.forEach.call(document.querySelectorAll('.who-btn'), function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        el('login-error').hidden = true;
        updateLoginButton();
        el('pin-input').focus();
      });
    });

    el('pin-input').addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
      updateLoginButton();
    });

    el('pin-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var pin = el('pin-input').value.trim();
      if (!pendingPerson || pin.length !== 4) return;
      el('login-submit').disabled = true;
      api('/login', { method: 'POST', body: { person: pendingPerson, pin: pin } })
        .then(function (res) {
          S.token = res.token;
          S.person = res.person;
          localStorage.setItem(LS.token, res.token);
          localStorage.setItem(LS.person, res.person);
          boot();
        })
        .catch(function (err) {
          var box = el('login-error');
          box.textContent = err.message;
          box.hidden = false;
          el('pin-input').value = '';
          updateLoginButton();
        });
    });
  }

  // ------------------------------------------------------------ realtime

  function setSync(next) {
    S.sync = next;
    var dot = el('sync-dot');
    dot.dataset.state = next;
    el('sync-text').textContent = next === 'live' ? 'live' : next === 'polling' ? 'syncing' : 'offline';
  }

  function onVersion(info) {
    if (!info || !S.data) return;
    if (info.version === S.data.version) return;
    refresh(true).then(function () {
      if (info.by && info.by !== S.person) toast(info.by + ' just updated the budget');
    });
  }

  function startPolling() {
    if (S.pollTimer) return;
    S.pollTimer = setInterval(function () {
      if (document.hidden) return;
      api('/version')
        .then(function (info) {
          if (S.sync !== 'live') setSync('polling');
          onVersion(info);
        })
        .catch(function () { setSync('offline'); });
    }, 15000);
  }

  function stopPolling() {
    clearInterval(S.pollTimer);
    S.pollTimer = null;
  }

  function startRealtime() {
    stopRealtime();
    startPolling(); // safety net until the stream proves itself
    if (!('EventSource' in window)) return;
    try {
      S.sse = new EventSource('/api/events?token=' + encodeURIComponent(S.token));
    } catch (err) {
      return;
    }
    S.sse.addEventListener('open', function () {
      setSync('live');
      stopPolling();
    });
    S.sse.addEventListener('change', function (e) {
      setSync('live');
      stopPolling();
      try { onVersion(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
    });
    S.sse.addEventListener('error', function () {
      // EventSource retries on its own; polling covers the gap meanwhile.
      setSync(navigator.onLine ? 'polling' : 'offline');
      startPolling();
    });
  }

  function stopRealtime() {
    if (S.sse) { S.sse.close(); S.sse = null; }
    stopPolling();
  }

  // ------------------------------------------------------------ render: chrome

  function render() {
    if (!S.data) return;
    var d = S.data;

    el('month-label').textContent = monthLabel(d.month);

    var banner = el('readonly-banner');
    if (d.readOnly) {
      banner.hidden = false;
      banner.textContent = 'Past month — view only';
      banner.classList.remove('grace-banner');
    } else if (d.month !== d.currentMonth) {
      // Last month, still open for a few days.
      banner.hidden = false;
      banner.textContent = d.grace.closesAfter
        ? 'Still open through ' + monthDay(d.grace.closesAfter) + ' — you can add to ' + monthLabel(d.month)
        : 'Still open — you can add to ' + monthLabel(d.month);
      banner.classList.add('grace-banner');
    } else {
      banner.hidden = true;
      banner.classList.remove('grace-banner');
    }

    el('month-next').disabled = d.month >= d.currentMonth;
    var earliest = d.months.length ? d.months[d.months.length - 1] : d.currentMonth;
    el('month-prev').disabled = d.month <= earliest;
    el('fab').hidden = d.readOnly;

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === S.tab));
    });

    var view = el('view');
    if (S.tab === 'dashboard') view.innerHTML = viewDashboard(d);
    else if (S.tab === 'history') view.innerHTML = viewHistory(d);
    else if (S.tab === 'debt') view.innerHTML = viewDebt(d);
    else view.innerHTML = viewSettings(d);
  }

  // ------------------------------------------------------------ render: dashboard

  function barHtml(status, percent) {
    return '<div class="bar" data-status="' + esc(status) + '"><i style="width:' + pct(percent) + '%"></i></div>';
  }

  function activeCats(d, kind) {
    return d.categories.filter(function (c) { return !c.archived && (!kind || c.kind === kind); });
  }

  function viewDashboard(d) {
    // Unpaid bills stay on top (already due-date sorted by the server);
    // paid ones sink so what still needs doing is always first.
    var fixed = d.categories.filter(function (c) { return c.kind === 'fixed'; })
      .sort(function (a, b) { return (a.paid ? 1 : 0) - (b.paid ? 1 : 0); });
    var variable = d.categories.filter(function (c) { return c.kind === 'variable'; });
    var billsLeft = fixed.reduce(function (sum, c) { return c.paid ? sum : sum + c.budget; }, 0);

    var html = '';

    html += '<section class="card summary">' +
      '<div class="summary-cap">Left to spend</div>' +
      '<div class="summary-big' + (d.totals.remaining < 0 ? ' summary-neg' : '') + '">' + money(d.totals.remaining, { cents: false }) + '</div>' +
      '<div class="summary-grid">' +
      summaryCell('Money in', d.totals.received, 'of ' + money(d.totals.income, { cents: false }) + ' expected') +
      summaryCell('Spent', d.totals.spent) +
      summaryCell('Budgeted', d.totals.budgeted) +
      summaryCell('Bills left', billsLeft) +
      '</div></section>';

    // Weekly pace: everyday spending only — the mortgage landing in week one
    // is not "overspending", so bills stay out of this number.
    if (d.week || (d.weeks && d.weeks.length)) {
      html += '<div class="section-title"><span>Week by week</span>' +
        (d.week ? '<span>' + monthDay(d.week.from) + ' – ' + monthDay(d.week.to) + '</span>' : '') +
        '</div><section class="card">';
      if (d.week) {
        html += '<div class="cat-head"><span class="cat-name">This week, everyday spending</span>' +
          '<span class="cat-nums">' + money(d.week.everyday) + ' / ~' + money(d.week.allowance, { cents: false }) + '</span></div>' +
          barHtml(d.week.status, d.week.pct) +
          '<div class="cat-foot"><span>' +
          (d.week.remaining < 0
            ? money(-d.week.remaining) + ' over an even pace'
            : money(d.week.remaining) + ' left at an even pace') + '</span>' +
          (d.week.income > 0 ? '<span class="week-in">+' + money(d.week.income) + ' came in</span>' : '') +
          '</div>';
      }
      html += weekBarsHtml(d);
      html += '</section>';
    }

    // Money in: tap Log when a paycheck lands and record what it actually was.
    html += '<div class="section-title"><span>Income</span><span>' +
      money(d.totals.received) + ' of ' + money(d.totals.income, { cents: false }) + ' received</span></div>';
    html += '<section class="card card-tight">';
    d.income.sources.forEach(function (s) {
      var sub = s.received > 0
        ? 'got ' + money(s.received) + ' (' + s.checks + ' of ' + s.per_month + ' checks)'
        : money(s.amount, { cents: false }) + ' × ' + s.per_month + ' per month';
      html += '<div class="bill">' +
        '<span class="tx-avatar" data-person="' + esc(s.person) + '">' + esc((s.person || s.name).charAt(0)) + '</span>' +
        '<span class="bill-name">' + esc(s.name) + '<span class="bill-sub">' + esc(sub) + '</span></span>' +
        (d.readOnly ? '' : '<button type="button" class="btn btn-sm btn-in" data-act="log-income" data-id="' + s.id + '">Log</button>') +
        '</div>';
    });
    if (!d.readOnly) {
      html += '<div class="card-foot-btn"><button type="button" class="btn btn-block btn-sm" data-act="log-income" data-id="">+ Other income (bonus, sale, refund…)</button></div>';
    }
    html += '</section>';

    // Scheduled bills sit directly under the summary: if one of them puts the
    // budget underwater, that needs seeing before the checklist.
    var upcoming = d.upcoming || [];
    if (upcoming.length) {
      var projected = d.totals.budgeted + upcoming.reduce(function (s, c) { return s + c.budget; }, 0);
      var over = projected - d.totals.income;
      html += '<div class="section-title"><span>Coming up</span></div><section class="card card-tight">';
      upcoming.forEach(function (c) {
        html += '<div class="bill bill-pending">' +
          '<span class="bill-box" aria-hidden="true">◷</span>' +
          '<span class="bill-name">' + esc(c.name) +
          '<span class="bill-sub">starts ' + esc(monthLabel(c.startsMonth)) + '</span></span>' +
          '<span class="bill-amt">' + money(c.budget, { cents: false }) + '</span></div>';
      });
      html += '<div class="cat"><div class="cat-foot"><span>Budget once these start</span>' +
        '<span class="' + (over > 0 ? 'cat-over' : '') + '">' + money(projected, { cents: false }) +
        ' of ' + money(d.totals.income, { cents: false }) +
        (over > 0 ? ' — ' + money(over, { cents: false }) + ' short' : '') +
        '</span></div></div></section>';
    }

    var overdue = fixed.filter(function (c) { return c.dueStatus === 'overdue'; });
    var dueSoon = fixed.filter(function (c) { return c.dueStatus === 'today' || c.dueStatus === 'soon'; });
    if (overdue.length || dueSoon.length) {
      html += '<section class="card due-alert">' +
        '<div class="row"><span>' +
        (overdue.length ? '<b>' + overdue.length + ' overdue</b>' : '') +
        (overdue.length && dueSoon.length ? ' · ' : '') +
        (dueSoon.length ? dueSoon.length + ' due within 3 days' : '') +
        '</span><b>' +
        money(overdue.concat(dueSoon).reduce(function (s, c) { return s + c.budget; }, 0), { cents: false }) +
        '</b></div></section>';
    }

    html += '<div class="section-title"><span>Fixed bills</span><span>' +
      fixed.filter(function (c) { return c.paid; }).length + ' of ' + fixed.length + ' paid</span></div>';

    if (!fixed.length) {
      html += '<div class="card empty">No fixed bills yet. Add them in Settings.</div>';
    } else {
      html += '<section class="card card-tight">';
      fixed.forEach(function (c) {
        var extra = '';
        if (c.paid && Math.abs(c.spent - c.budget) >= 0.01) {
          extra = '<span class="bill-sub">' + money(c.spent) + ' recorded of ' + money(c.budget) + '</span>';
        } else if (!c.paid && c.spent > 0) {
          extra = '<span class="bill-sub">' + money(c.spent) + ' already recorded</span>';
        } else if (c.dueDay) {
          extra = '<span class="bill-sub' + (c.dueStatus === 'overdue' ? ' bill-late' : '') + '">' +
            esc(dueText(c)) + '</span>';
        }
        html += '<button type="button" class="bill" data-act="toggle-bill" data-id="' + c.id + '"' +
          ' aria-pressed="' + (c.paid ? 'true' : 'false') + '"' + (d.readOnly || c.archived ? ' disabled' : '') + '>' +
          '<span class="bill-box" aria-hidden="true">✓</span>' +
          '<span class="bill-name">' + esc(c.name) + (c.archived ? ' <span class="badge">closed</span>' : '') + extra + '</span>' +
          '<span class="bill-amt">' + money(c.budget, { cents: false }) + '</span>' +
          '</button>';
      });
      html += '</section>';
    }

    html += '<div class="section-title"><span>Spending categories</span></div>';
    if (!variable.length) {
      html += '<div class="card empty">No spending categories yet. Add them in Settings.</div>';
    } else {
      html += '<section class="card card-tight">';
      variable.forEach(function (c) {
        html += '<div class="cat">' +
          '<div class="cat-head"><span class="cat-name">' + esc(c.name) +
          (c.archived ? ' <span class="badge">closed</span>' : '') + '</span>' +
          '<span class="cat-nums">' + money(c.spent) + ' / ' + money(c.budget, { cents: false }) + '</span></div>' +
          barHtml(c.status, c.pct) +
          '<div class="cat-foot"><span>' + Math.round(c.pct) + '% used</span>' +
          '<span class="' + (c.remaining < 0 ? 'cat-over' : '') + '">' +
          (c.remaining < 0 ? money(-c.remaining) + ' over' : money(c.remaining) + ' left') +
          '</span></div></div>';
      });
      html += '</section>';
    }

    return html;
  }

  /** Mini per-week chart: everyday spending as bars, income as a green dot row. */
  function weekBarsHtml(d) {
    if (!d.weeks || !d.weeks.length) return '';
    var max = d.weeks.reduce(function (m, w) { return Math.max(m, w.everyday); }, 0);
    var html = '<div class="week-bars">';
    d.weeks.forEach(function (w) {
      var h = max > 0 ? Math.max(4, Math.round((w.everyday / max) * 56)) : 4;
      html += '<div class="wbar' + (w.isCurrent ? ' wbar-now' : '') + '"' +
        ' title="' + esc(monthDay(w.from) + ' – ' + monthDay(w.to)) + '">' +
        '<span class="wbar-amt">' + (w.everyday > 0 ? money(w.everyday, { cents: false }) : '·') + '</span>' +
        '<i style="height:' + h + 'px"></i>' +
        '<span class="wbar-cap">' + (w.isCurrent ? 'now' : 'W' + w.n) + '</span>' +
        (w.income > 0 ? '<span class="wbar-in" title="+' + esc(String(money(w.income))) + ' in">●</span>' : '<span class="wbar-in"> </span>') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /** Human wording for a bill's due date: "Overdue by 2 days", "Due Fri the 15th". */
  function dueText(c) {
    if (!c.dueDay) return '';
    if (c.dueStatus === 'overdue') {
      var late = Math.abs(c.dueIn);
      return 'Overdue by ' + late + (late === 1 ? ' day' : ' days');
    }
    if (c.dueStatus === 'today') return 'Due today';
    if (c.dueStatus === 'soon') return 'Due in ' + c.dueIn + (c.dueIn === 1 ? ' day' : ' days');
    return 'Due the ' + ordinal(c.dueDay);
  }

  function ordinal(n) {
    var rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  function summaryCell(label, value, sub) {
    return '<div class="summary-cell"><span class="summary-cap">' + esc(label) + '</span>' +
      '<b>' + money(value, { cents: false }) + '</b>' +
      (sub ? '<span class="summary-sub">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  // ------------------------------------------------------------ render: history

  function viewHistory(d) {
    var showOut = S.filters.type !== 'in';
    var showIn = S.filters.type !== 'out';

    var rows = [];
    if (showOut) {
      d.transactions.forEach(function (t) {
        if (S.filters.category && String(t.category_id) !== S.filters.category) return;
        if (S.filters.person && t.person !== S.filters.person) return;
        rows.push({ kind: 'out', id: t.id, date: t.date, person: t.person, amount: t.amount,
          title: t.category, meta: t.note || (t.source === 'billpay' ? 'Bill paid' : t.person) });
      });
    }
    if (showIn && !S.filters.category) {
      d.income.entries.forEach(function (e) {
        if (S.filters.person && e.person !== S.filters.person) return;
        rows.push({ kind: 'in', id: e.id, date: e.date, person: e.person, amount: e.amount,
          title: e.label, meta: e.note || 'Received' });
      });
    }
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    });

    var outTotal = rows.reduce(function (s, r) { return r.kind === 'out' ? s + r.amount : s; }, 0);
    var inTotal = rows.reduce(function (s, r) { return r.kind === 'in' ? s + r.amount : s; }, 0);

    var html = '<section class="card">' +
      '<div class="chips" style="margin-bottom:10px">' +
      typeChip('', 'Everything') + typeChip('out', 'Spending') + typeChip('in', 'Income') +
      '</div>' +
      '<label class="field"><span>Category</span><select class="input" data-act="filter-category">' +
      '<option value="">All categories</option>' +
      d.categories.map(function (c) {
        return '<option value="' + c.id + '"' + (S.filters.category === String(c.id) ? ' selected' : '') + '>' +
          esc(c.name) + '</option>';
      }).join('') +
      '</select></label>' +
      '<div class="chips">' +
      personChip('', 'Everyone') +
      d.people.map(function (p) { return personChip(p, p); }).join('') +
      '</div></section>';

    var headline = [];
    if (outTotal || showOut) headline.push('−' + money(outTotal));
    if (inTotal) headline.push('+' + money(inTotal));
    html += '<div class="section-title"><span>' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') +
      '</span><span>' + headline.join(' · ') + '</span></div>';

    if (!rows.length) {
      html += '<div class="card empty">Nothing recorded yet for ' + esc(monthLabel(d.month)) + '.</div>';
      return html;
    }

    // Weekly subtotals for whatever is currently filtered.
    var weekTotals = {};
    rows.forEach(function (r) {
      var wk = weekStartClient(r.date);
      weekTotals[wk] = weekTotals[wk] || { out: 0, inn: 0 };
      if (r.kind === 'in') weekTotals[wk].inn += r.amount;
      else weekTotals[wk].out += r.amount;
    });

    html += '<section class="card card-tight">';
    var lastDay = null;
    var lastWeek = null;
    rows.forEach(function (r) {
      var wk = weekStartClient(r.date);
      if (wk !== lastWeek) {
        lastWeek = wk;
        var t = weekTotals[wk];
        var wkLabel = wk < d.month + '-01' ? d.month + '-01' : wk;
        html += '<div class="week-head"><span>Week of ' + esc(monthDay(wkLabel)) + '</span><span>' +
          (t.out > 0 ? '−' + money(t.out) : '') +
          (t.out > 0 && t.inn > 0 ? ' · ' : '') +
          (t.inn > 0 ? '<b class="week-in">+' + money(t.inn) + '</b>' : '') +
          '</span></div>';
      }
      if (r.date !== lastDay) {
        lastDay = r.date;
        html += '<div class="day-head">' + esc(dayLabel(r.date)) + '</div>';
      }
      html += '<button type="button" class="tx' + (r.kind === 'in' ? ' tx-in' : '') + '"' +
        ' data-act="' + (r.kind === 'in' ? 'edit-inc' : 'edit-tx') + '" data-id="' + r.id + '"' +
        (d.readOnly ? ' disabled' : '') + '>' +
        '<span class="tx-avatar" data-person="' + esc(r.person) + '">' + esc(r.person.charAt(0)) + '</span>' +
        '<span class="tx-main"><span class="tx-cat">' + esc(r.title) + '</span>' +
        '<span class="tx-meta">' + esc(r.meta) + ' · ' + esc(shortDate(r.date)) + '</span></span>' +
        '<span class="tx-amt">' + (r.kind === 'in' ? '+' : '') + money(r.amount) + '</span>' +
        '</button>';
    });
    html += '</section>';
    return html;
  }

  function typeChip(value, label) {
    return '<button type="button" class="chip" data-act="filter-type" data-type="' + esc(value) + '"' +
      ' aria-pressed="' + (S.filters.type === value ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }

  function personChip(value, label) {
    return '<button type="button" class="chip" data-act="filter-person" data-person="' + esc(value) + '"' +
      ' aria-pressed="' + (S.filters.person === value ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }

  // ------------------------------------------------------------ render: debt

  function viewDebt(d) {
    var open = d.debts.filter(function (x) { return !x.settled; });
    var settled = d.debts.filter(function (x) { return x.settled; });
    var targetTotal = d.debts.reduce(function (s, x) { return s + x.target; }, 0);
    var clearedTotal = settled.reduce(function (s, x) { return s + x.target; }, 0);
    var clearedPct = targetTotal > 0 ? (clearedTotal / targetTotal) * 100 : 0;

    var html = '<section class="card">' +
      '<div class="row"><div><div class="summary-cap muted">Settlement fund</div>' +
      '<div class="fund-balance">' + money(d.fund.balance) + '</div></div>' +
      '<button type="button" class="btn btn-accent btn-sm" data-act="add-deposit">Deposit</button></div>' +
      '<div class="ledger">' +
      '<div><span>From bills</span><b>' + money(d.fund.contributed, { cents: false }) + '</b></div>' +
      '<div><span>Deposits</span><b>' + money(d.fund.deposited, { cents: false }) + '</b></div>' +
      '<div><span>Settled</span><b>' + money(d.fund.spent, { cents: false }) + '</b></div>' +
      '</div></section>';

    html += '<section class="card">' +
      '<div class="row"><b>Debts cleared</b><span class="muted small">' + settled.length + ' of ' + d.debts.length + '</span></div>' +
      barHtml('ok', clearedPct) +
      '<div class="cat-foot"><span>' + money(clearedTotal, { cents: false }) + ' of ' + money(targetTotal, { cents: false }) + ' in settlement targets</span></div>' +
      '</section>';

    html += '<div class="section-title"><span>Settlement targets</span></div>';
    html += '<section class="card card-tight">';
    if (!open.length) html += '<div class="empty">Every target is settled. 🎉</div>';
    open.forEach(function (x) { html += debtHtml(x); });
    html += '</section>';

    if (settled.length) {
      html += '<div class="section-title"><span>Settled</span></div><section class="card card-tight">';
      settled.forEach(function (x) { html += debtHtml(x); });
      html += '</section>';
    }

    html += '<div class="section-title"><span>Fund deposits</span></div><section class="card card-tight">';
    if (!d.fund.deposits.length) {
      html += '<div class="empty">No manual deposits yet. Add extra paychecks here.</div>';
    } else {
      d.fund.deposits.forEach(function (dep) {
        html += '<div class="tx">' +
          '<span class="tx-avatar" data-person="' + esc(dep.person) + '">' + esc(dep.person.charAt(0)) + '</span>' +
          '<span class="tx-main"><span class="tx-cat">' + money(dep.amount) + '</span>' +
          '<span class="tx-meta">' + esc(dep.note || 'Deposit') + ' · ' + esc(shortDate(dep.date)) + '</span></span>' +
          '<button type="button" class="icon-del" data-act="del-deposit" data-id="' + dep.id + '" aria-label="Delete deposit">✕</button>' +
          '</div>';
      });
    }
    html += '</section>';
    return html;
  }

  function debtHtml(x) {
    var html = '<div class="debt' + (x.settled ? ' debt-settled' : '') + '">' +
      '<div class="cat-head"><span class="debt-name">' + esc(x.name) + '</span>' +
      '<span class="cat-nums">' + money(x.target, { cents: false }) + ' target</span></div>';

    if (x.label) html += '<div style="margin-top:6px"><span class="badge badge-alert">' + esc(x.label) + '</span></div>';

    if (x.settled) {
      html += '<div class="cat-foot"><span>Settled ' + esc(x.settledDate || '') +
        (x.settledBy ? ' by ' + esc(x.settledBy) : '') + '</span>' +
        '<span>' + money(x.settledAmount || 0) + ' paid</span></div>' +
        '<div style="margin-top:10px"><button type="button" class="btn btn-sm" data-act="unsettle" data-id="' + x.id + '">Reopen</button></div>';
    } else {
      html += barHtml(x.coverage >= 100 ? 'ok' : 'warn', x.coverage) +
        '<div class="cat-foot"><span>Balance ' + money(x.balance, { cents: false }) + '</span>' +
        '<span>Fund covers ' + Math.round(x.coverage) + '%</span></div>' +
        '<div class="row" style="margin-top:10px;gap:8px">' +
        '<button type="button" class="btn btn-sm" data-act="edit-debt" data-id="' + x.id + '">Edit</button>' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="settle" data-id="' + x.id + '">Mark settled</button>' +
        '</div>';
    }
    return html + '</div>';
  }

  // ------------------------------------------------------------ render: settings

  function viewSettings(d) {
    var fixed = activeCats(d, 'fixed');
    var variable = activeCats(d, 'variable');

    var html = '<div class="section-title"><span>Income</span><span>' + money(d.income.total, { cents: false }) + ' / mo</span></div>';
    html += '<section class="card">';
    d.income.sources.forEach(function (s) {
      html += '<div class="edit-row">' +
        '<span class="edit-name">' + esc(s.name) +
        '<br><span class="muted small">' + s.per_month + ' × per month' + (s.person ? ' · ' + esc(s.person) : '') + '</span></span>' +
        '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + s.amount +
        '" data-act="income-amount" data-id="' + s.id + '" aria-label="Amount for ' + esc(s.name) + '">' +
        '<button type="button" class="icon-del" data-act="del-income" data-id="' + s.id + '" aria-label="Delete income source">✕</button>' +
        '</div>';
    });
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:12px" data-act="add-income">+ Add income source</button>';
    html += '<p class="muted small" style="margin:10px 0 0">These are the plan. When a paycheck actually lands, log the real amount with the Log button on the Budget tab — that\'s what "money in" counts.</p>';
    html += '</section>';

    html += '<div class="section-title"><span>Fixed bill budgets</span></div><section class="card">';
    fixed.forEach(function (c) { html += billRow(c); });
    (d.upcoming || []).filter(function (c) { return c.kind === 'fixed'; })
      .forEach(function (c) { html += billRow(c); });
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:12px" data-act="add-category" data-kind="fixed">+ Add fixed bill</button></section>';

    html += '<div class="section-title"><span>Spending budgets</span></div><section class="card">';
    variable.forEach(function (c) { html += categoryRow(c); });
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:12px" data-act="add-category" data-kind="variable">+ Add category</button></section>';

    html += '<div class="section-title"><span>App</span></div><section class="card stack">' +
      '<div class="row"><span class="muted small">Signed in as</span><b>' + esc(d.person) + '</b></div>' +
      '<div class="row"><span class="muted small">Sync</span><b>' + esc(S.sync) + '</b></div>' +
      '<div class="row"><span class="muted small">Time zone</span><b>' + esc(d.timezone) + '</b></div>';
    if (S.installPrompt) {
      html += '<button type="button" class="btn btn-accent btn-block" data-act="install">Install on this phone</button>';
    }
    html += '<button type="button" class="btn btn-block" data-act="signout">Sign out</button>' +
      '<p class="muted small" style="margin:0">Budget changes apply to ' + esc(monthLabel(d.currentMonth)) +
      ' and forward. Past months keep the budget they were run on.</p>' +
      '</section>';

    return html;
  }

  /** Fixed bills get their own stacked row so the due-day field has room. */
  function billRow(c) {
    var note = c.startsMonth
      ? '<span class="muted small"> · starts ' + esc(monthLabel(c.startsMonth)) + '</span>'
      : '';
    return '<div class="edit-card">' +
      '<div class="edit-card-name">' + esc(c.name) + note + '</div>' +
      '<div class="edit-card-controls">' +
      '<label class="mini"><span>Amount</span>' +
      '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + c.budget +
      '" data-act="budget" data-id="' + c.id + '" aria-label="Budget for ' + esc(c.name) + '"></label>' +
      '<label class="mini"><span>Due day</span>' +
      '<input class="input" type="number" inputmode="numeric" step="1" min="1" max="31" placeholder="—" value="' +
      (c.dueDay == null ? '' : c.dueDay) +
      '" data-act="due-day" data-id="' + c.id + '" aria-label="Day of month ' + esc(c.name) + ' is due"></label>' +
      '<button type="button" class="icon-del" data-act="del-category" data-id="' + c.id +
      '" aria-label="Remove ' + esc(c.name) + '">✕</button>' +
      '</div></div>';
  }

  function categoryRow(c) {
    var starts = c.startsMonth
      ? '<br><span class="muted small">starts ' + esc(monthLabel(c.startsMonth)) + '</span>'
      : '';
    return '<div class="edit-row">' +
      '<span class="edit-name">' + esc(c.name) + starts + '</span>' +
      '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + c.budget +
      '" data-act="budget" data-id="' + c.id + '" aria-label="Budget for ' + esc(c.name) + '">' +
      '<button type="button" class="icon-del" data-act="del-category" data-id="' + c.id + '" aria-label="Remove ' + esc(c.name) + '">✕</button>' +
      '</div>';
  }

  // ------------------------------------------------------------ sheets

  function openSheet(html) {
    var sheet = el('sheet');
    sheet.innerHTML = '<div class="sheet-grip"></div>' + html;
    sheet.hidden = false;
    el('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    el('sheet').hidden = true;
    el('sheet').innerHTML = '';
    el('scrim').hidden = true;
    document.body.style.overflow = '';
  }

  function sheetHead(title) {
    return '<div class="sheet-head"><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="sheet-close" data-act="close-sheet" aria-label="Close">✕</button></div>';
  }

  function personPicker(selected) {
    return '<div class="chips" data-role="person-picker">' +
      S.data.people.map(function (p) {
        return '<button type="button" class="chip" data-act="pick-person" data-person="' + esc(p) + '"' +
          ' aria-pressed="' + (p === selected ? 'true' : 'false') + '">' + esc(p) + '</button>';
      }).join('') + '</div>';
  }

  // ---- quick add -------------------------------------------------------

  var QA = { digits: '', step: 1, note: '', date: null, person: null, details: false, mode: 'out', sourceId: null, sourceLabel: '', locked: false };

  function qaAmount() { return Number(QA.digits || '0') / 100; }

  function openQuickAdd(mode, source) {
    if (!S.data) { toast('Still loading — try again in a second', 'error'); return; }
    if (S.data.readOnly) { toast('Switch to ' + monthLabel(S.data.currentMonth) + ' to add', 'error'); return; }
    QA = {
      digits: source ? String(Math.round(source.amount * 100)) : '',
      step: 1,
      note: '',
      date: defaultDate(),
      person: source && source.person ? source.person : S.person,
      details: false,
      mode: mode === 'in' ? 'in' : 'out',
      sourceId: source ? source.id : null,
      sourceLabel: source ? source.name : '',
      locked: Boolean(source),
    };
    renderQuickAdd();
  }

  function renderQuickAdd() {
    if (QA.step === 1) {
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      var title = QA.locked ? QA.sourceLabel : 'Quick add';
      var html = sheetHead(title);
      if (!QA.locked) {
        html += '<div class="chips mode-toggle">' +
          '<button type="button" class="chip" data-act="qa-mode" data-mode="out" aria-pressed="' + (QA.mode === 'out') + '">Spending</button>' +
          '<button type="button" class="chip chip-in" data-act="qa-mode" data-mode="in" aria-pressed="' + (QA.mode === 'in') + '">Income</button>' +
          '</div>';
      } else {
        html += '<p class="muted small" style="margin:0 0 4px;text-align:center">How much actually came in?</p>';
      }
      html += '<div class="amount-display' + (QA.digits ? '' : ' dim') + (QA.mode === 'in' ? ' amount-in' : '') + '">' +
        (QA.mode === 'in' ? '+' : '') + money(qaAmount(), { cents: true }) + '</div>' +
        '<div class="keypad">' +
        keys.map(function (k) { return '<button type="button" class="key" data-act="key" data-key="' + k + '">' + k + '</button>'; }).join('') +
        '<button type="button" class="key" data-act="key" data-key="back" aria-label="Backspace">⌫</button>' +
        '<button type="button" class="key" data-act="key" data-key="0">0</button>' +
        '<button type="button" class="key" data-act="key" data-key="00">00</button>' +
        '</div>';

      if (QA.details) {
        html += '<label class="field"><span>Note</span>' +
          '<input class="input" id="qa-note" placeholder="Optional" maxlength="200" value="' + esc(QA.note) + '"></label>' +
          '<label class="field"><span>Date</span>' +
          '<input class="input" id="qa-date" type="date" value="' + esc(QA.date) + '"' + dateBounds() + '></label>' +
          '<div class="field"><span>Who</span>' + personPicker(QA.person) + '</div>';
      } else {
        html += '<button type="button" class="detail-toggle" data-act="qa-details">+ Note, date or person</button>';
      }

      var nextLabel = QA.mode === 'in'
        ? (QA.locked ? 'Save paycheck' : 'Choose source →')
        : 'Choose category →';
      html += '<button type="button" class="btn btn-accent btn-block" data-act="qa-next"' +
        (QA.digits ? '' : ' disabled') + '>' + nextLabel + '</button>';
      openSheet(html);
      return;
    }

    if (QA.mode === 'in') {
      var srcBody = sheetHead('+' + money(qaAmount()) + ' — where from?') +
        '<div class="cat-grid">' +
        S.data.income.sources.map(function (s) {
          return '<button type="button" class="cat-pick" data-act="qa-save-income" data-id="' + s.id + '">' +
            '<b>' + esc(s.name) + '</b><span>usually ' + money(s.amount, { cents: false }) + '</span></button>';
        }).join('') +
        '<button type="button" class="cat-pick" data-act="qa-save-income" data-id="">' +
        '<b>Other income</b><span>bonus, sale, refund…</span></button>' +
        '</div>' +
        '<button type="button" class="btn btn-block" style="margin-top:14px" data-act="qa-back">← Change amount</button>';
      openSheet(srcBody);
      return;
    }

    var variable = activeCats(S.data, 'variable');
    var fixed = activeCats(S.data, 'fixed');
    var body = sheetHead(money(qaAmount()) + ' — tap a category') +
      '<div class="cat-grid">' + variable.map(catPickHtml).join('') + '</div>';
    if (fixed.length) {
      body += '<div class="section-title"><span>Fixed bills</span></div>' +
        '<div class="cat-grid">' + fixed.map(catPickHtml).join('') + '</div>';
    }
    body += '<button type="button" class="btn btn-block" style="margin-top:14px" data-act="qa-back">← Change amount</button>';
    openSheet(body);
  }

  function catPickHtml(c) {
    var left = c.remaining < 0 ? money(-c.remaining) + ' over' : money(c.remaining, { cents: false }) + ' left';
    return '<button type="button" class="cat-pick" data-act="qa-save" data-id="' + c.id + '">' +
      '<b>' + esc(c.name) + '</b><span>' + left + '</span></button>';
  }

  function quickAddSave(categoryId) {
    var amount = qaAmount();
    if (!(amount > 0)) return;
    var body = { category_id: Number(categoryId), amount: amount, note: QA.note, date: QA.date, person: QA.person };
    closeSheet();
    mutate('/transactions', { method: 'POST', body: body }, money(amount) + ' saved');
  }

  function quickAddSaveIncome(sourceId) {
    var amount = qaAmount();
    if (!(amount > 0)) return;
    var body = {
      amount: amount,
      source_id: sourceId === '' || sourceId == null ? null : Number(sourceId),
      note: QA.note,
      date: QA.date,
      person: QA.person,
    };
    if (!body.source_id) body.label = 'Other income';
    closeSheet();
    mutate('/income/entries', { method: 'POST', body: body }, '+' + money(amount) + ' received 🎉');
  }

  // ---- edit transaction ------------------------------------------------

  function openEditTx(id) {
    var t = S.data.transactions.filter(function (x) { return x.id === Number(id); })[0];
    if (!t) return;
    var html = sheetHead('Edit transaction') +
      '<label class="field"><span>Amount</span>' +
      '<input class="input" id="tx-amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="' + t.amount + '"></label>' +
      '<label class="field"><span>Category</span><select class="input" id="tx-category">' +
      S.data.categories.filter(function (c) { return !c.archived || c.id === t.category_id; })
        .map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === t.category_id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>Date</span>' +
      '<input class="input" id="tx-date" type="date" value="' + esc(t.date) + '"' + dateBounds() + '></label>' +
      '<div class="field"><span>Who</span>' + personPicker(t.person) + '</div>' +
      '<label class="field"><span>Note</span>' +
      '<input class="input" id="tx-note" maxlength="200" value="' + esc(t.note) + '"></label>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-act="tx-save" data-id="' + t.id + '">Save changes</button>' +
      '<button type="button" class="btn btn-danger btn-block" data-act="tx-delete" data-id="' + t.id + '">Delete</button>' +
      '</div>';
    QA.person = t.person;
    openSheet(html);
  }

  function saveTx(id) {
    var body = {
      amount: Number($('#tx-amount').value),
      category_id: Number($('#tx-category').value),
      date: $('#tx-date').value,
      note: $('#tx-note').value,
      person: QA.person,
    };
    if (!(body.amount > 0)) { toast('Enter an amount above zero', 'error'); return; }
    closeSheet();
    mutate('/transactions/' + id, { method: 'PUT', body: body }, 'Saved');
  }

  // ---- edit income entry -----------------------------------------------

  function openEditIncome(id) {
    var e = S.data.income.entries.filter(function (x) { return x.id === Number(id); })[0];
    if (!e) return;
    QA.person = e.person;
    openSheet(sheetHead('Edit income') +
      '<label class="field"><span>Amount</span>' +
      '<input class="input" id="inc-amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="' + e.amount + '"></label>' +
      '<label class="field"><span>Source</span><select class="input" id="inc-source">' +
      '<option value=""' + (e.source_id ? '' : ' selected') + '>Other income</option>' +
      S.data.income.sources.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === e.source_id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>Label</span>' +
      '<input class="input" id="inc-label" maxlength="60" value="' + esc(e.label) + '"></label>' +
      '<label class="field"><span>Date</span>' +
      '<input class="input" id="inc-date" type="date" value="' + esc(e.date) + '"' + dateBounds() + '></label>' +
      '<div class="field"><span>Who</span>' + personPicker(e.person) + '</div>' +
      '<label class="field"><span>Note</span>' +
      '<input class="input" id="inc-note" maxlength="200" value="' + esc(e.note) + '"></label>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-act="inc-entry-save" data-id="' + e.id + '">Save changes</button>' +
      '<button type="button" class="btn btn-danger btn-block" data-act="inc-entry-delete" data-id="' + e.id + '">Delete</button>' +
      '</div>');
  }

  function saveIncomeEntry(id) {
    var body = {
      amount: Number($('#inc-amount').value),
      source_id: $('#inc-source').value || null,
      label: $('#inc-label').value,
      date: $('#inc-date').value,
      note: $('#inc-note').value,
      person: QA.person,
    };
    if (!(body.amount > 0)) { toast('Enter an amount above zero', 'error'); return; }
    closeSheet();
    mutate('/income/entries/' + id, { method: 'PUT', body: body }, 'Saved');
  }

  // ---- debts + fund ----------------------------------------------------

  function openSettle(id) {
    var debt = S.data.debts.filter(function (x) { return x.id === Number(id); })[0];
    if (!debt) return;
    openSheet(sheetHead('Settle ' + debt.name) +
      '<p class="muted small" style="margin-top:0">Fund balance is ' + money(S.data.fund.balance) +
      '. Settling subtracts the amount you record here.</p>' +
      '<label class="field"><span>Amount paid</span>' +
      '<input class="input" id="settle-amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="' + debt.target + '"></label>' +
      '<label class="field"><span>Date settled</span>' +
      '<input class="input" id="settle-date" type="date" value="' + esc(S.data.today) + '"></label>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="settle-save" data-id="' + debt.id + '">Record settlement</button>');
  }

  function openEditDebt(id) {
    var debt = S.data.debts.filter(function (x) { return x.id === Number(id); })[0];
    if (!debt) return;
    openSheet(sheetHead('Edit debt') +
      '<label class="field"><span>Name</span><input class="input" id="debt-name" maxlength="60" value="' + esc(debt.name) + '"></label>' +
      '<label class="field"><span>Balance owed</span>' +
      '<input class="input" id="debt-balance" type="number" inputmode="decimal" step="0.01" min="0" value="' + debt.balance + '"></label>' +
      '<label class="field"><span>Settlement target</span>' +
      '<input class="input" id="debt-target" type="number" inputmode="decimal" step="0.01" min="0" value="' + debt.target + '"></label>' +
      '<label class="field"><span>Note / flag</span>' +
      '<input class="input" id="debt-label" maxlength="80" value="' + esc(debt.label) + '"></label>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="debt-save" data-id="' + debt.id + '">Save</button>');
  }

  function openDeposit() {
    QA.person = S.person;
    openSheet(sheetHead('Add to settlement fund') +
      '<label class="field"><span>Amount</span>' +
      '<input class="input" id="dep-amount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></label>' +
      '<label class="field"><span>Note</span>' +
      '<input class="input" id="dep-note" maxlength="200" placeholder="Extra paycheck"></label>' +
      '<label class="field"><span>Date</span>' +
      '<input class="input" id="dep-date" type="date" value="' + esc(S.data.today) + '"></label>' +
      '<div class="field"><span>Who</span>' + personPicker(S.person) + '</div>' +
      '<button type="button" class="btn btn-accent btn-block" data-act="dep-save">Add deposit</button>');
  }

  // ---- settings sheets -------------------------------------------------

  function openAddCategory(kind) {
    openSheet(sheetHead(kind === 'fixed' ? 'New fixed bill' : 'New category') +
      '<label class="field"><span>Name</span><input class="input" id="cat-name" maxlength="60" placeholder="Name"></label>' +
      '<label class="field"><span>Monthly budget</span>' +
      '<input class="input" id="cat-budget" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></label>' +
      '<label class="field"><span>Starts (leave blank for now)</span>' +
      '<input class="input" id="cat-starts" type="month" min="' + esc(S.data.currentMonth) + '"></label>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="cat-save" data-kind="' + esc(kind) + '">Add</button>');
  }

  function openAddIncome() {
    QA.person = S.person;
    openSheet(sheetHead('New income source') +
      '<label class="field"><span>Name</span><input class="input" id="inc-name" maxlength="60" placeholder="Paycheck"></label>' +
      '<label class="field"><span>Amount per check</span>' +
      '<input class="input" id="inc-amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></label>' +
      '<label class="field"><span>Checks per month</span>' +
      '<input class="input" id="inc-count" type="number" inputmode="numeric" step="1" min="1" max="12" value="2"></label>' +
      '<div class="field"><span>Who</span>' + personPicker(S.person) + '</div>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="inc-save">Add income</button>');
  }

  // ------------------------------------------------------------ events

  function actionFrom(target) {
    var node = target.closest ? target.closest('[data-act]') : null;
    return node;
  }

  function handleClick(e) {
    var node = actionFrom(e.target);
    if (!node) return;
    var act = node.dataset.act;
    var id = node.dataset.id;

    switch (act) {
      case 'close-sheet': closeSheet(); break;

      case 'toggle-bill': {
        var cat = S.data.categories.filter(function (c) { return c.id === Number(id); })[0];
        if (!cat) break;
        mutate('/bills/' + id + '/pay', { method: 'POST', body: { paid: !cat.paid, month: S.data.month } },
          cat.paid ? cat.name + ' unmarked' : cat.name + ' paid');
        break;
      }

      case 'edit-tx': openEditTx(id); break;
      case 'tx-save': saveTx(id); break;
      case 'tx-delete':
        if (confirm('Delete this transaction?')) {
          closeSheet();
          mutate('/transactions/' + id, { method: 'DELETE' }, 'Deleted');
        }
        break;

      case 'filter-person':
        S.filters.person = node.dataset.person;
        render();
        break;

      case 'settle': openSettle(id); break;
      case 'settle-save': {
        var amount = Number($('#settle-amount').value);
        if (!(amount > 0)) { toast('Enter the amount paid', 'error'); break; }
        var date = $('#settle-date').value;
        closeSheet();
        mutate('/debts/' + id + '/settle', { method: 'POST', body: { amount: amount, date: date } }, 'Settled — nice work');
        break;
      }
      case 'unsettle':
        if (confirm('Reopen this debt?')) mutate('/debts/' + id + '/unsettle', { method: 'POST' }, 'Reopened');
        break;
      case 'edit-debt': openEditDebt(id); break;
      case 'debt-save': {
        var debtBody = {
          name: $('#debt-name').value,
          balance: Number($('#debt-balance').value),
          target: Number($('#debt-target').value),
          label: $('#debt-label').value,
        };
        closeSheet();
        mutate('/debts/' + id, { method: 'PUT', body: debtBody }, 'Saved');
        break;
      }

      case 'add-deposit': openDeposit(); break;
      case 'dep-save': {
        var depAmount = Number($('#dep-amount').value);
        if (!(depAmount > 0)) { toast('Enter an amount', 'error'); break; }
        var depBody = {
          amount: depAmount,
          note: $('#dep-note').value,
          date: $('#dep-date').value,
          person: QA.person,
        };
        closeSheet();
        mutate('/fund/deposits', { method: 'POST', body: depBody }, 'Deposit added');
        break;
      }
      case 'del-deposit':
        if (confirm('Delete this deposit?')) mutate('/fund/deposits/' + id, { method: 'DELETE' }, 'Deposit removed');
        break;

      case 'add-category': openAddCategory(node.dataset.kind); break;
      case 'cat-save': {
        var catName = $('#cat-name').value.trim();
        if (!catName) { toast('Give it a name', 'error'); break; }
        var catBody = {
          name: catName,
          kind: node.dataset.kind,
          budget: Number($('#cat-budget').value) || 0,
          starts_month: $('#cat-starts').value || null,
        };
        closeSheet();
        mutate('/categories', { method: 'POST', body: catBody }, 'Added');
        break;
      }
      case 'del-category': {
        var target = S.data.categories.filter(function (c) { return c.id === Number(id); })[0];
        if (target && confirm('Remove "' + target.name + '"? Past transactions stay in history.')) {
          mutate('/categories/' + id, { method: 'DELETE' }, 'Removed');
        }
        break;
      }

      case 'add-income': openAddIncome(); break;
      case 'inc-save': {
        var incName = $('#inc-name').value.trim();
        if (!incName) { toast('Give it a name', 'error'); break; }
        var incBody = {
          name: incName,
          amount: Number($('#inc-amount').value) || 0,
          per_month: Number($('#inc-count').value) || 1,
          person: QA.person,
        };
        closeSheet();
        mutate('/income', { method: 'POST', body: incBody }, 'Income added');
        break;
      }
      case 'del-income':
        if (confirm('Delete this income source?')) mutate('/income/' + id, { method: 'DELETE' }, 'Removed');
        break;

      case 'pick-person': {
        QA.person = node.dataset.person;
        var group = node.parentNode;
        Array.prototype.forEach.call(group.querySelectorAll('[data-act="pick-person"]'), function (b) {
          b.setAttribute('aria-pressed', String(b === node));
        });
        break;
      }

      case 'key': {
        var key = node.dataset.key;
        if (key === 'back') QA.digits = QA.digits.slice(0, -1);
        else if (QA.digits.length + key.length <= 9) QA.digits = (QA.digits + key).replace(/^0+(?=\d)/, '');
        var display = $('.amount-display');
        if (display) {
          display.textContent = (QA.mode === 'in' ? '+' : '') + money(qaAmount(), { cents: true });
          display.classList.toggle('dim', !QA.digits);
        }
        var next = $('[data-act="qa-next"]');
        if (next) next.disabled = !QA.digits;
        break;
      }
      case 'qa-details':
        captureQaDetails();
        QA.details = true;
        renderQuickAdd();
        break;
      case 'qa-mode':
        captureQaDetails();
        QA.mode = node.dataset.mode === 'in' ? 'in' : 'out';
        renderQuickAdd();
        break;
      case 'qa-next':
        if (!QA.digits) break;
        captureQaDetails();
        if (QA.mode === 'in' && QA.locked) { quickAddSaveIncome(QA.sourceId); break; }
        QA.step = 2;
        renderQuickAdd();
        break;
      case 'qa-back':
        QA.step = 1;
        renderQuickAdd();
        break;
      case 'qa-save': quickAddSave(id); break;
      case 'qa-save-income': quickAddSaveIncome(node.dataset.id); break;
      case 'log-income': {
        var src = S.data.income.sources.filter(function (x) { return x.id === Number(id); })[0];
        openQuickAdd('in', src || null);
        break;
      }
      case 'edit-inc': openEditIncome(id); break;
      case 'inc-entry-save': saveIncomeEntry(id); break;
      case 'inc-entry-delete':
        if (confirm('Delete this income entry?')) {
          closeSheet();
          mutate('/income/entries/' + id, { method: 'DELETE' }, 'Deleted');
        }
        break;
      case 'filter-type':
        S.filters.type = node.dataset.type;
        render();
        break;

      case 'retry':
        refresh().then(function () { if (S.data) startRealtime(); });
        break;
      case 'install':
        if (S.installPrompt) {
          S.installPrompt.prompt();
          S.installPrompt = null;
        }
        break;
      case 'signout':
        if (confirm('Sign out of this phone?')) signOut();
        break;
      default: break;
    }
  }

  function captureQaDetails() {
    var note = $('#qa-note');
    var date = $('#qa-date');
    if (note) QA.note = note.value;
    if (date && date.value) QA.date = date.value;
  }

  function handleChange(e) {
    var node = actionFrom(e.target);
    if (!node) return;
    var act = node.dataset.act;
    var id = node.dataset.id;

    if (act === 'filter-category') {
      S.filters.category = node.value;
      render();
    } else if (act === 'budget') {
      var budget = Number(node.value);
      if (!isFinite(budget) || budget < 0) { toast('Enter a positive number', 'error'); render(); return; }
      mutate('/categories/' + id, { method: 'PUT', body: { budget: budget } }, 'Budget updated');
    } else if (act === 'due-day') {
      var raw = node.value.trim();
      if (raw !== '' && !(Number(raw) >= 1 && Number(raw) <= 31)) {
        toast('Due day must be 1-31', 'error');
        render();
        return;
      }
      mutate('/categories/' + id, { method: 'PUT', body: { due_day: raw === '' ? null : Number(raw) } },
        raw === '' ? 'Due date cleared' : 'Due date set');
    } else if (act === 'income-amount') {
      var amount = Number(node.value);
      if (!isFinite(amount) || amount < 0) { toast('Enter a positive number', 'error'); render(); return; }
      mutate('/income/' + id, { method: 'PUT', body: { amount: amount } }, 'Income updated');
    }
  }

  function wireApp() {
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);

    el('scrim').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el('sheet').hidden) closeSheet();
    });

    el('fab').addEventListener('click', openQuickAdd);
    el('who-chip').addEventListener('click', function () {
      if (confirm('Switch user? You will need the family PIN again.')) signOut();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        S.tab = tab.dataset.tab;
        localStorage.setItem(LS.tab, S.tab);
        window.scrollTo(0, 0);
        // Settings always edits the live budget, so snap back to this month.
        if (S.tab === 'settings' && S.data && S.data.month !== S.data.currentMonth) {
          S.pinned = false;
          refresh(true);
          return;
        }
        render();
      });
    });

    el('month-prev').addEventListener('click', function () {
      S.month = shiftMonth(S.month, -1);
      S.pinned = true;
      refresh();
    });
    el('month-next').addEventListener('click', function () {
      S.month = shiftMonth(S.month, 1);
      S.pinned = S.month < S.data.currentMonth;
      refresh();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && S.data) refresh(true);
    });
    window.addEventListener('online', function () {
      if (S.data) { refresh(true); startRealtime(); }
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.installPrompt = e;
      if (S.tab === 'settings') render();
    });
  }

  // ------------------------------------------------------------ boot

  function boot() {
    showApp();
    S.month = null;
    S.pinned = false;
    refresh().then(function () {
      if (S.data) startRealtime();
    });
  }

  function init() {
    S.token = localStorage.getItem(LS.token);
    S.person = localStorage.getItem(LS.person);
    S.tab = localStorage.getItem(LS.tab) || 'dashboard';
    if (!document.querySelector('.tab[data-tab="' + S.tab + '"]')) S.tab = 'dashboard';

    wireLogin();
    wireApp();

    if (S.token && S.person) boot();
    else showLogin();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* offline shell is optional */ });
      });
    }
  }

  init();
})();
