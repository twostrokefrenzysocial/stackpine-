/* Lattimer Family Budget — vanilla front end, no build step. */
(function () {
  'use strict';

  // Bumped with every release; shown in Settings so "am I on the newest
  // version?" is a glance, not a guess.
  var APP_VERSION = 24;

  var LS = { token: 'lfb.token', person: 'lfb.person', tab: 'lfb.tab' };

  var S = {
    token: null,
    person: null,
    month: null,
    data: null,
    tab: 'dashboard',
    filters: { category: '', person: '', type: '', search: '' },
    ui: { paidOpen: false, openCats: {} },
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
  var undoFn = null;

  function toast(message, kind) {
    var node = el('toast');
    node.textContent = message;
    node.dataset.kind = kind || 'info';
    node.hidden = false;
    undoFn = null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, kind === 'error' ? 4200 : 2400);
  }

  /** Delete-style toast with a 6-second Undo button — faster and safer than "are you sure?". */
  function toastUndo(message, onUndo) {
    var node = el('toast');
    node.dataset.kind = 'info';
    node.innerHTML = esc(message) + ' <button type="button" class="toast-undo" data-act="toast-undo">Undo</button>';
    node.hidden = false;
    undoFn = onUndo;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; undoFn = null; }, 6000);
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
      var err = new Error('No connection — check your signal and try again.');
      err.offline = true;
      throw err;
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

  /**
   * Any write: apply the state the server hands back, or surface the error.
   * With queueLabel set, a write that fails for lack of signal is saved on
   * this phone instead and synced automatically later (offline Quick Add).
   */
  function mutate(path, opts, successMessage, queueLabel) {
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
        if (err.offline && queueLabel && opts && opts.body) {
          enqueueEntry(path, opts.body, queueLabel);
          toast('No signal — ' + queueLabel + ' is saved on this phone and will sync by itself 📶');
        } else {
          toast(err.message, 'error');
        }
        setSync('offline');
        return null;
      })
      .then(function (result) {
        S.busy = false;
        return result;
      });
  }

  // ---- offline queue: entries saved without signal, synced when it returns

  var QUEUE_KEY = 'lfb.queue';
  var CACHE_KEY = 'lfb.cache';

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* full — queue is small, unlikely */ }
  }
  function newClientId() {
    return 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function enqueueEntry(path, body, label) {
    var q = loadQueue();
    q.push({ path: path, body: body, label: label, ts: Date.now() });
    saveQueue(q);
    render();
  }

  var flushBusy = false;
  /** Send queued entries in order; stop on no-signal, drop on real rejection. */
  function flushQueue() {
    if (flushBusy || !loadQueue().length) return;
    flushBusy = true;
    var synced = 0;
    (function step() {
      var q = loadQueue();
      if (!q.length) return done();
      var item = q[0];
      api(item.path, { method: 'POST', body: item.body })
        .then(function () {
          synced++;
          saveQueue(loadQueue().slice(1));
          step();
        })
        .catch(function (err) {
          if (err.offline) return done(); // still no signal — try again later
          // The server said no (closed month, deleted category…). Retrying
          // forever would wedge the queue; surface it and move on.
          saveQueue(loadQueue().slice(1));
          toast('Could not sync ' + (item.label || 'an entry') + ': ' + err.message, 'error');
          step();
        });
      function done() {
        flushBusy = false;
        if (synced) {
          toast(synced === 1 ? 'Synced the entry saved on this phone ✓' : 'Synced ' + synced + ' entries saved on this phone ✓');
          refresh(true);
        } else if (S.data) render();
      }
    })();
  }

  function applyState(state) {
    if (maybeSelfUpdate(state.app)) return;
    S.data = state;
    S.month = state.month;
    S.cachedAt = null;
    setSync(S.sse && S.sse.readyState === 1 ? 'live' : S.sync === 'offline' ? 'polling' : S.sync);
    // Keep the freshest current-month state on the phone so the app still
    // opens (and Quick Add still works) with no signal.
    if (state.month === state.currentMonth) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), state: state })); } catch (e) { /* best effort */ }
    }
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
        // Cold launch with no signal: fall back to the last synced state so
        // the family can still see the budget and queue Quick Adds.
        if (!S.data) {
          var cached = null;
          try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { /* no cache */ }
          if (cached && cached.state) {
            S.data = cached.state;
            S.month = cached.state.month;
            S.cachedAt = cached.at;
            render();
            return;
          }
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

  /**
   * The server says a newer build of the app exists: wipe every cache the
   * old build could hide in and load fresh. Runs at most once per session.
   */
  var updating = false;
  function maybeSelfUpdate(appRev) {
    if (updating || !appRev || appRev <= APP_VERSION) return false;
    updating = true;
    toast('Updating the app…');
    var reloadNow = function () { location.reload(); };
    var purge = ('caches' in window)
      ? caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        })
      : Promise.resolve();
    purge
      .then(function () {
        return ('serviceWorker' in navigator) ? navigator.serviceWorker.getRegistration() : null;
      })
      .then(function (reg) { return reg ? reg.update() : null; })
      .then(reloadNow, reloadNow);
    return true;
  }

  function onVersion(info) {
    if (!info || !S.data) return;
    if (maybeSelfUpdate(info.app)) return;
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
    if (d.month > d.currentMonth) {
      banner.hidden = false;
      banner.textContent = 'Planning ahead — ' + monthLabel(d.month) + ' has not started yet';
      banner.classList.remove('grace-banner');
    } else if (d.readOnly) {
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

    // One month ahead stays reachable so the Plan tab can actually plan the
    // month a scheduled bill lands in.
    el('month-next').disabled = d.month >= shiftMonth(d.currentMonth, 1);
    var earliest = d.months.length ? d.months[d.months.length - 1] : d.currentMonth;
    el('month-prev').disabled = d.month <= earliest;
    el('fab').hidden = d.readOnly;

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === S.tab));
    });

    var view = el('view');
    if (S.tab === 'dashboard') view.innerHTML = viewDashboard(d);
    else if (S.tab === 'history') view.innerHTML = viewHistory(d);
    else if (S.tab === 'plan') view.innerHTML = viewPlan(d);
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

    // Offline: viewing the last synced copy and/or entries waiting to sync.
    if (S.cachedAt) {
      html += '<div class="offline-note">📶 No connection — showing the budget as of ' +
        esc(new Date(S.cachedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) +
        '. You can still add — it saves on this phone.</div>';
    }
    var queued = loadQueue();
    if (queued.length) {
      html += '<div class="offline-note">' + queued.length + (queued.length === 1 ? ' entry' : ' entries') +
        ' saved on this phone — will sync when there\'s signal.</div>';
    }

    // What's in the bank — every account, one honest number each.
    if (d.bank && d.bank.set) {
      html += '<section class="card bank">' +
        '<div class="bank-cap">In the bank</div>' +
        '<div class="bank-big' + (d.bank.total < 0 ? ' bank-neg' : '') + '">' + money(d.bank.total) + '</div>' +
        '<div class="bank-accounts">' +
        d.bank.accounts.map(function (a) {
          return '<button type="button" class="bank-acc" data-act="account-open" data-id="' + a.id + '" title="Tap to fix or rename">' +
            '<span>' + esc(a.name) + '</span><b' + (a.balance < 0 ? ' class="cat-over"' : '') + '>' + money(a.balance) + '</b></button>';
        }).join('') +
        '</div>' +
        '<div class="bank-sub">' +
        '<span class="bank-in"><b class="bank-in">+' + money(d.totals.received, { cents: false }) + '</b> in</span>' +
        '<span><b>−' + money(d.totals.spent, { cents: false }) + '</b> out this month</span>' +
        '</div>' +
        (d.readOnly ? '' :
          '<div class="chips" style="margin-top:10px">' +
          (d.bank.accounts.length > 1 ? '<button type="button" class="chip" data-act="qa-move">⇄ Move money</button>' : '') +
          '<button type="button" class="chip" data-act="account-open" data-id="">+ Account</button>' +
          '</div>') +
        '</section>';
    } else {
      html += '<section class="card bank">' +
        '<div class="bank-cap">In the bank</div>' +
        '<p class="small muted" style="margin:6px 0 10px">Add your accounts (checking, savings…) with what\'s really in them — every dollar you log moves the right one.</p>' +
        '<button type="button" class="btn btn-block bank-set-btn" data-act="account-open" data-id="">Add an account</button>' +
        '</section>';
    }

    // Paychecks: one row, one job — log the money when it lands.
    var hint = paydayHint(d);
    html += '<section class="card card-tight"><div class="bill" style="border:0">' +
      '<span class="bill-name">Money in' +
      '<span class="bill-sub">' + money(d.totals.received, { cents: false }) + ' of ' +
      money(d.totals.income, { cents: false }) + ' expected' + (hint ? ' · ' + esc(hint) : '') + '</span></span>' +
      (d.readOnly ? '' : '<button type="button" class="btn btn-sm btn-in" data-act="income-sheet">Log a check</button>') +
      '</div></section>';

    // Last month's report card: overspending alert + leftover nudge, once per month.
    if (d.review && localStorage.getItem('lfb.review.' + d.review.month) !== 'seen') {
      var rv = d.review;
      html += '<section class="card review-card">' +
        '<div class="row"><b>' + esc(monthLabel(rv.month)) + ' report</b>' +
        '<button type="button" class="btn btn-sm" data-act="review-dismiss" data-month="' + esc(rv.month) + '">Dismiss</button></div>';
      if (rv.overs.length) {
        html += '<p class="small" style="margin:8px 0 4px"><b class="cat-over">' + money(rv.overTotal) + ' over budget</b> in ' +
          rv.overs.length + (rv.overs.length === 1 ? ' area:' : ' areas:') + '</p>';
        rv.overs.forEach(function (o) {
          html += '<div class="row small" style="padding:3px 0"><span>' + esc(o.name) + '</span>' +
            '<span class="cat-over">' + money(o.spent) + ' of ' + money(o.budget, { cents: false }) +
            ' (+' + money(o.over) + ')</span></div>';
        });
      } else {
        html += '<p class="small" style="margin:8px 0 4px">Every category stayed under budget. 👏</p>';
      }
      if (rv.suggestionCount > 0) {
        html += '<button type="button" class="btn btn-sm btn-primary btn-block" style="margin-top:8px" data-act="tuneup-open">' +
          rv.suggestionCount + ' budget change' + (rv.suggestionCount === 1 ? '' : 's') + ' suggested — review &amp; accept</button>';
      }
      // The save-it nudge only fires on real tracked income; a "leftover"
      // computed from the plan alone is hypothetical money.
      if (rv.leftover > 0 && rv.leftoverBasis === 'received') {
        html += '<div class="row small" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">' +
          '<span><b class="week-in">' + money(rv.leftover, { cents: false }) + '</b> came in and never got spent</span>' +
          '<button type="button" class="btn btn-sm btn-in" data-act="save-add" data-amount="' + rv.leftover + '">Save it</button></div>';
      } else if (rv.leftover < 0 && rv.leftoverBasis === 'received') {
        html += '<p class="small cat-over" style="margin:8px 0 0">Spending outran income by ' +
          money(-rv.leftover, { cents: false }) + '.</p>';
      }
      html += '</section>';
    }

    // A scheduled bill that puts the plan underwater gets one line here;
    // the detail lives on the Plan tab.
    var upcoming = d.upcoming || [];
    if (upcoming.length) {
      var projected = d.totals.budgeted + upcoming.reduce(function (s, c) { return s + c.budget; }, 0);
      var over = projected - d.totals.income;
      if (over > 0) {
        html += '<div class="card due-alert">Starting ' + esc(monthLabel(upcoming[0].startsMonth)) +
          ', the plan is ' + money(over, { cents: false }) + ' short — see the Plan tab.</div>';
      }
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

    var unpaidBills = fixed.filter(function (c) { return !c.paid; });
    var paidBills = fixed.filter(function (c) { return c.paid; });

    html += '<div class="section-title"><span>Bills to pay</span><span>' +
      (unpaidBills.length ? money(billsLeft, { cents: false }) + ' left' : 'all paid 🎉') + '</span></div>';

    if (!fixed.length) {
      html += '<div class="card empty">No fixed bills yet. Add them in Settings.</div>';
    } else {
      html += '<section class="card card-tight">';
      // The family pays bills the day a check lands, so the list is grouped
      // by paycheck: this Friday's batch first, then the next one.
      var groups = [];
      var byDate = {};
      unpaidBills.forEach(function (c) {
        // Anything that pays itself needs no attention; what's left is
        // grouped by the paycheck it comes out of.
        var onPayday = (c.duePayday !== null && c.duePayday !== undefined) || c.cadence === 'payday';
        var key = c.autoPay ? 'auto'
          : onPayday && c.dueDate ? c.dueDate
          : c.dueDate ? 'watch'
          : 'none';
        if (!byDate[key]) { byDate[key] = []; groups.push(key); }
        byDate[key].push(c);
      });
      var rank = function (g) {
        return g === 'none' ? 3 : g === 'auto' ? 2 : g === 'watch' ? 1 : 0;
      };
      groups.sort(function (a, b) {
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      var multiGroup = groups.length > 1;
      groups.forEach(function (key) {
        if (multiGroup) {
          var total = byDate[key].reduce(function (s, c) { return s + c.budget; }, 0);
          var head = key === 'none' ? 'No date set'
            : key === 'auto' ? '🔒 Pays itself — nothing to do'
            : key === 'watch' ? 'Keep an eye on these'
            : '✓ Pay with ' + esc(payLabel(key, d));
          html += '<div class="pay-head' + (key === 'auto' ? ' pay-head-auto' : '') + '"><span>' + head + '</span>' +
            '<span>' + money(total, { cents: false }) + '</span></div>';
        }
        byDate[key].forEach(function (c) { html += billChecklistRow(c, d); });
      });
      if (!unpaidBills.length) {
        html += '<div class="empty" style="padding:16px">Every bill is paid this month.</div>';
      }
      // Paid bills fold away so the list shrinks as the month gets done.
      if (paidBills.length) {
        html += '<button type="button" class="bill-expander" data-act="toggle-paid">' +
          (S.ui.paidOpen ? '▾' : '▸') + ' ' + paidBills.length + ' paid ✓</button>';
        if (S.ui.paidOpen) paidBills.forEach(function (c) { html += billChecklistRow(c, d); });
      }
      html += '</section>';
    }

    var pp = d.payPeriod;
    html += '<div class="section-title"><span>Spending</span><span>' +
      (pp && pp.perPaycheck
        ? 'this paycheck · ' + esc(monthDay(pp.start)) + '–' + esc(monthDay(pp.last))
        : 'this month') + '</span></div>';
    if (!variable.length) {
      html += '<div class="card empty">No spending categories yet. Add them in Settings.</div>';
    } else {
      html += '<section class="card card-tight">';
      variable.forEach(function (c) { html += spendingCatRow(c, d); });
      html += '</section>';
    }

    return html;
  }

  /** How a paycheck date reads in a group heading. */
  function payLabel(iso, d) {
    if (iso === d.today) return "today's check";
    var days = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(d.today + 'T12:00:00Z')) / 86400000);
    if (days < 0) return 'the ' + monthDay(iso) + ' check';
    // Name the real weekday — never assume it is a Friday.
    if (days <= 7) return 'this ' + weekdayOf(iso) + "'s check (" + monthDay(iso) + ')';
    return 'the ' + weekdayShort(iso) + ' ' + monthDay(iso) + ' check';
  }

  /** "Fri" for a date — so a payday on the wrong day is obvious at a glance. */
  function weekdayShort(dateStr) {
    var p = dateStr.split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])))
      .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  }

  /** A spending category row that opens to show this month's purchases in it. */
  function spendingCatRow(c, d) {
    var open = Boolean(S.ui.openCats[c.id]);
    // Everyday spending is tracked per paycheck: the bar, the percentage and
    // the "left" figure are all this pay period, not the whole month.
    var per = c.periodBudget !== undefined;
    var spent = per ? c.periodSpent : c.spent;
    var budget = per ? c.periodBudget : c.budget;
    var pct = per ? c.periodPct : c.pct;
    var status = per ? c.periodStatus : c.status;
    var left = per ? c.periodRemaining : c.remaining;

    var html = '<div class="cat' + (open ? ' cat-open' : '') + '">' +
      '<button type="button" class="cat-btn" data-act="cat-toggle" data-id="' + c.id + '">' +
      '<div class="cat-head"><span class="cat-name"><span class="cat-chev">▶</span>' + esc(c.name) +
      (c.archived ? ' <span class="badge">closed</span>' : '') + '</span>' +
      '<span class="cat-nums"><b>' + money(spent) + '</b> of ' + money(budget, { cents: false }) + '</span></div>' +
      barHtml(status, pct) +
      '<div class="cat-foot"><span>' + Math.round(pct) + '% used</span>' +
      '<span class="' + (left < 0 ? 'cat-over' : '') + '">' +
      (left < 0 ? money(-left) + ' over' : money(left) + ' left') +
      '</span></div></button>';

    if (open) {
      var start = d.payPeriod ? d.payPeriod.start : null;
      var txs = d.transactions.filter(function (t) {
        return t.category_id === c.id && (!per || !start || t.date >= start);
      });
      html += '<div class="cat-tx">';
      if (per) {
        html += '<div class="cat-tx-none" style="padding-bottom:2px">' +
          'This paycheck · ' + money(c.spent) + ' of ' + money(c.budget, { cents: false }) + ' for the whole month' +
          '</div>';
      }
      if (!txs.length) {
        html += '<div class="cat-tx-none">Nothing spent here yet' + (per ? ' this pay period' : ' this month') + '.</div>';
      } else {
        txs.forEach(function (t) {
          html += '<button type="button" class="tx" data-act="edit-tx" data-id="' + t.id + '"' +
            (d.readOnly && t.source !== 'import' ? ' disabled' : '') + '>' +
            '<span class="tx-main"><span class="tx-cat">' + esc(t.note || (t.source === 'billpay' ? 'Paid' : t.person)) + '</span>' +
            '<span class="tx-meta">' + esc(dayLabel(t.date)) + ' · ' + esc(t.person) + '</span></span>' +
            '<span class="tx-amt">−' + money(t.amount) + '</span>' +
            '</button>';
        });
      }
      html += '</div>';
    }
    return html + '</div>';
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
    if (!c.dueDay && !c.dueDate) return '';
    if (c.dueStatus === 'overdue') {
      var late = Math.abs(c.dueIn);
      return 'Overdue by ' + late + (late === 1 ? ' day' : ' days');
    }
    if (c.dueStatus === 'today') return 'Due today';
    if (c.dueStatus === 'soon') return 'Due in ' + c.dueIn + (c.dueIn === 1 ? ' day' : ' days');
    if (!c.dueDay && c.dueDate) return 'Due ' + monthDay(c.dueDate);
    return 'Due the ' + ordinal(c.dueDay);
  }

  function ordinal(n) {
    var rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  function billChecklistRow(c, d) {
    var extra = '';
    if (c.percent && !c.paid) {
      var owes = c.dueNow > 0
        ? money(c.dueNow) + ' owed on what came in'
        : (c.spent > 0 ? 'square so far' : 'log paychecks first');
      extra = '<span class="bill-sub' + (c.dueNow > 0 ? ' bill-late' : '') + '">' +
        esc(c.percent + '% of income · ' + owes) + '</span>';
    } else if (c.cadence === 'payday' && !c.paid) {
      var due = c.dueStatus ? ' · ' + dueText(c) : '';
      extra = '<span class="bill-sub' + (c.dueStatus === 'overdue' ? ' bill-late' : '') + '">' +
        esc(c.paidCount + ' of ' + c.expected + ' paydays paid' + due) + '</span>';
    } else if (c.paid && c.autoPay) {
      extra = '<span class="bill-sub">Came out on its own · ' + money(c.spent) + '</span>';
    } else if (c.paid) {
      // Say who ticked it and when, so the other phone can see what was done.
      var by = c.paidBy && c.paidBy !== 'Auto' ? 'Paid by ' + esc(c.paidBy) : 'Paid';
      var whenPaid = c.paidDate ? ' · ' + esc(dayLabel(c.paidDate)) : '';
      var offBudget = Math.abs(c.spent - c.budget) >= 0.01
        ? ' · ' + money(c.spent) + ' of ' + money(c.budget) : '';
      extra = '<span class="bill-sub">' + by + whenPaid + offBudget + '</span>';
    } else if (!c.paid && c.spent > 0 && c.cadence !== 'payday') {
      extra = '<span class="bill-sub">' + money(c.spent) + ' already recorded</span>';
    } else if (!c.paid && c.dueDay) {
      extra = '<span class="bill-sub' + (c.dueStatus === 'overdue' ? ' bill-late' : '') + '">' +
        esc(dueText(c)) + (c.autoPay ? ' · comes out on its own' : '') + '</span>';
    }
    var amt = c.percent
      ? (c.dueNow > 0 ? money(c.dueNow) : c.percent + '%')
      : c.cadence === 'payday'
        ? money(c.perPay, { cents: false }) + ' ×' + c.expected
        : money(c.budget, { cents: false });
    var partial = c.cadence === 'payday' && c.paidCount > 0 && !c.paid;
    // An auto-draft is not a to-do: it shows a lock instead of a checkbox so
    // the list reads as "these are handled, those are yours".
    var boxClass = 'bill-box' + (partial ? ' bill-box-partial' : '') + (c.autoPay ? ' bill-box-auto' : '');
    var boxMark = c.autoPay ? (c.paid ? '✓' : '🔒') : partial ? c.paidCount : '✓';
    return '<button type="button" class="bill' + (c.autoPay ? ' bill-auto' : '') + '"' +
      ' data-act="toggle-bill" data-id="' + c.id + '"' +
      ' aria-pressed="' + (c.paid ? 'true' : 'false') + '"' + (d.readOnly || c.archived ? ' disabled' : '') + '>' +
      '<span class="' + boxClass + '" aria-hidden="true">' + boxMark + '</span>' +
      '<span class="bill-name">' + esc(c.name) +
      (c.autoPay ? ' <span class="badge badge-auto">auto</span>' : '') +
      (c.archived ? ' <span class="badge">closed</span>' : '') + extra + '</span>' +
      '<span class="bill-amt">' + amt + '</span>' +
      '</button>';
  }

  function weekdayOf(dateStr) {
    var p = dateStr.split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])))
      .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  }

  /** "payday today 💵" / "payday Friday" for the soonest upcoming check. */
  function paydayHint(d) {
    // Only a real paycheck counts as "payday" — a monthly contract payment
    // landing on a Tuesday must not be announced as one.
    var checks = d.income.sources.filter(function (s) {
      return s.payInDays != null && (s.cadence === 'biweekly' || s.cadence === 'weekly');
    });
    var other = d.income.sources.filter(function (s) {
      return s.payInDays != null && s.cadence !== 'biweekly' && s.cadence !== 'weekly' && s.amount > 0;
    });
    var soonest = function (list) {
      return list.reduce(function (best, s) {
        return best === null || s.payInDays < best.payInDays ? s : best;
      }, null);
    };
    var check = soonest(checks);
    if (check && check.payInDays <= 6) {
      if (check.payInDays === 0) return 'payday today 💵 — tap to log';
      if (check.payInDays === 1) return 'payday tomorrow';
      return 'payday ' + weekdayOf(check.nextPayday);
    }
    var o = soonest(other);
    if (o && o.payInDays <= 6) {
      return o.name + (o.payInDays === 0 ? ' lands today' : o.payInDays === 1 ? ' lands tomorrow'
        : ' lands ' + weekdayOf(o.nextPayday));
    }
    if (check) return 'next payday ' + weekdayShort(check.nextPayday) + ' ' + monthDay(check.nextPayday);
    return null;
  }

  /** The income sources with their Log buttons — used by the sheet and Plan. */
  function incomeRowsHtml(d) {
    var html = '';
    d.income.sources.forEach(function (s) {
      var sub = s.received > 0
        ? 'got ' + money(s.received) + ' (' + s.checks + ' of ' + s.per_month + ' checks)'
        : money(s.amount, { cents: false }) + ' × ' + s.per_month + ' per month';
      if (s.nextPayday && s.payInDays != null && s.payInDays >= 0) {
        sub += ' · ' + (s.payInDays === 0 ? 'today 💵'
          : s.payInDays === 1 ? 'tomorrow'
          : s.payInDays <= 6 ? weekdayOf(s.nextPayday)
          : monthDay(s.nextPayday));
      }
      html += '<div class="bill">' +
        '<span class="tx-avatar" data-person="' + esc(s.person) + '">' + esc((s.person || s.name).charAt(0)) + '</span>' +
        '<span class="bill-name">' + esc(s.name) + '<span class="bill-sub">' + esc(sub) + '</span></span>' +
        (d.readOnly ? '' : '<button type="button" class="btn btn-sm btn-in" data-act="log-income" data-id="' + s.id + '">Log</button>') +
        '</div>';
    });
    if (!d.readOnly) {
      html += '<div class="card-foot-btn"><button type="button" class="btn btn-block btn-sm" data-act="log-income" data-id="">+ Other income (bonus, sale, refund…)</button></div>';
    }
    return html;
  }

  function openIncomeSheet() {
    openSheet(sheetHead('Money in — ' + monthLabel(S.data.month)) +
      '<p class="muted small" style="margin-top:0">' + money(S.data.totals.received) + ' of ' +
      money(S.data.totals.income, { cents: false }) + ' expected has come in. Tap Log when a check lands.</p>' +
      incomeRowsHtml(S.data));
  }

  /** Add a new account (no id) or fix/rename an existing one. */
  function openAccountSheet(id) {
    var acc = bankAccounts().filter(function (a) { return a.id === Number(id); })[0] || null;
    openSheet(sheetHead(acc ? acc.name : 'Add an account') +
      '<p class="muted small" style="margin-top:0">' +
      (acc
        ? 'Fix the balance to match the real account — everything logged from now on keeps it current.'
        : 'Name it like the bank does (Checking, Savings…) and enter what it really holds right now.') +
      '</p>' +
      '<label class="field"><span>Name</span>' +
      '<input class="input" id="acc-name" maxlength="60" value="' + esc(acc ? acc.name : '') + '" placeholder="Checking"></label>' +
      '<label class="field"><span>Balance right now</span>' +
      '<input class="input" id="acc-balance" type="number" inputmode="decimal" step="0.01" value="' + esc(acc ? acc.balance : '') + '" placeholder="0.00"></label>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-act="account-save" data-id="' + (acc ? acc.id : '') + '">' +
      (acc ? 'Save' : 'Add account') + '</button>' +
      (acc ? '<button type="button" class="btn btn-danger btn-block" data-act="account-delete" data-id="' + acc.id + '">Remove this account</button>' : '') +
      '</div>');
    setTimeout(function () { var i = el(acc ? 'acc-balance' : 'acc-name'); if (i) i.focus(); }, 60);
  }

  function saveAccount(id) {
    var name = el('acc-name').value.trim();
    var v = parseFloat(el('acc-balance').value);
    if (!name) { toast('Give the account a name', 'error'); return; }
    closeSheet();
    if (id) {
      var body = { name: name };
      if (!isNaN(v)) body.balance = v;
      mutate('/accounts/' + id, { method: 'PUT', body: body }, 'Account updated ✓');
    } else {
      mutate('/accounts', { method: 'POST', body: { name: name, balance: isNaN(v) ? 0 : v } }, name + ' added ✓');
    }
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

    var needle = S.filters.search.trim().toLowerCase();
    var matches = function (r) {
      if (!needle) return true;
      return (r.title + ' ' + r.meta).toLowerCase().indexOf(needle) !== -1;
    };

    // allRows respects everything except the person filter, so the per-person
    // totals always show both of them side by side.
    var allRows = [];
    if (showOut) {
      d.transactions.forEach(function (t) {
        if (S.filters.category && String(t.category_id) !== S.filters.category) return;
        var r = { kind: 'out', id: t.id, date: t.date, person: t.person, amount: t.amount, src: t.source,
          title: t.category, meta: t.note || (t.source === 'billpay' ? 'Bill paid' : t.person) };
        if (matches(r)) allRows.push(r);
      });
    }
    if (showIn && !S.filters.category) {
      d.income.entries.forEach(function (e) {
        var r = { kind: 'in', id: e.id, date: e.date, person: e.person, amount: e.amount,
          title: e.label, meta: e.note || 'Received' };
        if (matches(r)) allRows.push(r);
      });
    }
    // Money moved between accounts shows in the record but counts in no total.
    if (S.filters.type === '' && !S.filters.category) {
      (d.transfers || []).forEach(function (t) {
        var r = { kind: 'move', id: t.id, date: t.date, person: t.person, amount: t.amount,
          title: t.from + ' → ' + t.to, meta: t.note || 'Moved between accounts' };
        if (matches(r)) allRows.push(r);
      });
    }

    var rows = S.filters.person
      ? allRows.filter(function (r) { return r.person === S.filters.person; })
      : allRows;
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    });

    var perPerson = d.people.map(function (p) {
      var out = 0;
      var inn = 0;
      allRows.forEach(function (r) {
        if (r.person !== p || r.kind === 'move') return;
        if (r.kind === 'in') inn += r.amount; else out += r.amount;
      });
      return { person: p, out: out, inn: inn };
    }).filter(function (x) { return x.out > 0 || x.inn > 0; });

    var outTotal = rows.reduce(function (s, r) { return r.kind === 'out' ? s + r.amount : s; }, 0);
    var inTotal = rows.reduce(function (s, r) { return r.kind === 'in' ? s + r.amount : s; }, 0);

    var html = '';

    // The month at a glance: what came in, what went out, what that nets.
    var net = inTotal - outTotal;
    html += '<div class="hist-strip" style="margin-bottom:12px">' +
      '<div><span>Came in</span><b class="week-in">+' + money(inTotal, { cents: false }) + '</b></div>' +
      '<div><span>Went out</span><b>−' + money(outTotal, { cents: false }) + '</b></div>' +
      '<div><span>Net</span><b class="' + (net < 0 ? 'cat-over' : 'week-in') + '">' +
      (net < 0 ? '−' : '+') + money(Math.abs(net), { cents: false }) + '</b></div>' +
      '</div>';

    html += '<section class="card">' +
      '<div class="row" style="margin-bottom:10px"><div class="chips">' +
      typeChip('', 'Everything') + typeChip('out', 'Spending') + typeChip('in', 'Income') +
      '</div>' +
      (d.readOnly ? '' : '<button type="button" class="btn btn-sm" data-act="import-open">⇪ Statement</button>') +
      '</div>' +
      '<div class="chips" style="margin-bottom:10px">' +
      personChip('', 'Both of us') +
      d.people.map(function (p) { return personChip(p, 'Just ' + p); }).join('') +
      '</div>' +
      '<input class="input" type="search" placeholder="Search anything — Kroger, brakes, cheer…"' +
      ' data-act="filter-search" value="' + esc(S.filters.search) + '">' +
      '<label class="field" style="margin:10px 0 0"><span>Only one category</span><select class="input" data-act="filter-category">' +
      '<option value="">All categories</option>' +
      d.categories.map(function (c) {
        return '<option value="' + c.id + '"' + (S.filters.category === String(c.id) ? ' selected' : '') + '>' +
          esc(c.name) + '</option>';
      }).join('') +
      '</select></label>' +
      '</section>';

    if (perPerson.length > 1) {
      html += '<section class="card card-tight"><div class="who-totals">' +
        perPerson.map(function (x) {
          return '<div class="who-total"><span class="tx-avatar" data-person="' + esc(x.person) + '">' +
            esc(x.person.charAt(0)) + '</span><div><b>' + esc(x.person) + '</b>' +
            '<span class="small muted">' +
            (x.out > 0 ? '−' + money(x.out) + ' spent' : '') +
            (x.out > 0 && x.inn > 0 ? ' · ' : '') +
            (x.inn > 0 ? '<b class="week-in">+' + money(x.inn) + ' in</b>' : '') +
            '</span></div></div>';
        }).join('') +
        '</div></section>';
    }

    html += '<div class="section-title"><span>' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') +
      ' · newest first</span><span>tap one to fix it</span></div>';

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
      else if (r.kind === 'out') weekTotals[wk].out += r.amount;
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
      var rowAct = r.kind === 'in' ? 'edit-inc' : r.kind === 'move' ? 'transfer-open' : 'edit-tx';
      html += '<button type="button" class="tx' + (r.kind === 'in' ? ' tx-in' : '') + '"' +
        ' data-act="' + rowAct + '" data-id="' + r.id + '"' +
        (d.readOnly && r.src !== 'import' ? ' disabled' : '') + '>' +
        '<span class="tx-avatar" data-person="' + esc(r.person) + '">' + (r.kind === 'move' ? '⇄' : esc(r.person.charAt(0))) + '</span>' +
        '<span class="tx-main"><span class="tx-cat">' + esc(r.title) + '</span>' +
        '<span class="tx-meta">' + esc(r.person) + (r.meta && r.meta !== r.person ? ' · ' + esc(r.meta) : '') + '</span></span>' +
        '<span class="tx-amt' + (r.kind === 'move' ? ' muted' : '') + '">' +
        (r.kind === 'in' ? '+' : r.kind === 'move' ? '' : '−') + money(r.amount) + '</span>' +
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

  // ------------------------------------------------------------ render: plan

  function viewPlan(d) {
    var fixed = activeCats(d, 'fixed');
    var variable = activeCats(d, 'variable');
    var billsTotal = fixed.reduce(function (s, c) { return s + c.budget; }, 0);
    var everydayTotal = variable.reduce(function (s, c) { return s + c.budget; }, 0);
    var target = d.savings.target || 0;
    var leftover = d.totals.income - billsTotal - everydayTotal - target;
    var short = leftover < 0;

    // One page, read top to bottom: what comes in, what goes out, what is
    // left — then a single button that balances it.
    var html = '<section class="card summary">' +
      '<div class="summary-cap">' + esc(monthLabel(d.month)) + '</div>' +
      '<div class="plan-math">' +
      planLine('Money in', d.totals.income, '+') +
      planLine('Bills', billsTotal, '−') +
      planLine('Everyday spending', everydayTotal, '−') +
      (target > 0 ? planLine('Savings', target, '−') : '') +
      '<div class="plan-line plan-total"><span>' + (short ? 'Short' : 'Left over') + '</span>' +
      '<b class="' + (short ? 'summary-neg' : '') + '">' + money(Math.abs(leftover), { cents: false }) + '</b></div>' +
      '</div></section>';

    // The fix, right where the problem is stated.
    html += '<section class="card" id="plan-suggest"><p class="muted small" style="margin:0">Working out a plan…</p></section>';
    setTimeout(loadPlanSuggest, 0);

    // ---- money in: what each paycheck brings, and when
    html += '<div class="section-title"><span>Money in</span><span>' +
      money(d.totals.income, { cents: false }) + ' / mo</span></div><section class="card card-tight">';
    d.income.sources.forEach(function (s2) {
      var when = s2.nextPayday ? nextPaydayText(s2, d) : (s2.per_month + '× a month');
      html += '<div class="cat"><div class="cat-head">' +
        '<span class="cat-name">' + esc(s2.name) +
        '<span class="muted small" style="display:block;font-weight:400">' +
        money(s2.amount, { cents: false }) + ' × ' + s2.per_month + ' · ' + esc(when) + '</span></span>' +
        '<span class="cat-nums"><b>' + money(s2.monthly, { cents: false }) + '</b></span></div></div>';
    });
    html += '<div class="cat plan-row-total"><div class="cat-head"><span class="cat-name">Total coming in</span>' +
      '<span class="cat-nums"><b>' + money(d.totals.income, { cents: false }) + '</b></span></div></div>' +
      '<div class="card-foot-btn"><button type="button" class="btn btn-block btn-sm" data-act="add-income">+ Add income source</button></div>' +
      '</section>';

    // ---- every bill, in one list
    html += '<div class="section-title"><span>Bills</span><span>' + money(billsTotal, { cents: false }) + ' / mo</span></div>' +
      '<section class="card card-tight">';
    fixed.forEach(function (c) {
      var note = c.percent ? c.percent + '% of what comes in'
        : c.cadence === 'payday' ? money(c.perPay, { cents: false }) + ' every payday'
        : c.duePayday !== null && c.duePayday !== undefined ? 'with the ' + (c.dueDate ? monthDay(c.dueDate) : '') + ' check'
        : c.dueDay ? 'the ' + ordinal(c.dueDay)
        : 'no date set';
      html += '<div class="cat"><div class="cat-head">' +
        '<span class="cat-name">' + esc(c.name) +
        (c.autoPay ? ' <span class="badge badge-auto">auto</span>' : '') +
        '<span class="muted small" style="display:block;font-weight:400">' + esc(note) + '</span></span>' +
        '<span class="cat-nums"><b>' + money(c.budget, { cents: false }) + '</b></span></div></div>';
    });
    (d.upcoming || []).forEach(function (c) {
      html += '<div class="cat" style="opacity:.55"><div class="cat-head">' +
        '<span class="cat-name">' + esc(c.name) +
        '<span class="muted small" style="display:block;font-weight:400">starts ' + esc(monthLabel(c.startsMonth)) + '</span></span>' +
        '<span class="cat-nums">' + money(c.budget, { cents: false }) + '</span></div></div>';
    });
    html += '<div class="cat plan-row-total"><div class="cat-head"><span class="cat-name">Total bills</span>' +
      '<span class="cat-nums"><b>' + money(billsTotal, { cents: false }) + '</b></span></div></div></section>';

    // ---- everyday budgets
    html += '<div class="section-title"><span>Everyday spending</span><span>' +
      money(everydayTotal, { cents: false }) + ' / mo</span></div><section class="card card-tight">';
    variable.forEach(function (c) {
      html += '<div class="cat"><div class="cat-head"><span class="cat-name">' + esc(c.name) + '</span>' +
        '<span class="cat-nums"><b>' + money(c.budget, { cents: false }) + '</b></span></div></div>';
    });
    html += '<div class="cat plan-row-total"><div class="cat-head"><span class="cat-name">Total everyday</span>' +
      '<span class="cat-nums"><b>' + money(everydayTotal, { cents: false }) + '</b></span></div></div></section>';

    // ---- savings, kept to one line unless there is something to show
    html += '<div class="section-title"><span>Savings</span><span>' + money(d.savings.balance) + ' put away</span></div>' +
      '<section class="card"><div class="row">' +
      '<span class="small muted">' + (target > 0
        ? money(d.savings.thisMonth) + ' of ' + money(target, { cents: false }) + ' this month'
        : 'No monthly goal set') + '</span>' +
      '<span class="stack" style="grid-auto-flow:column;gap:6px">' +
      '<button type="button" class="btn btn-sm btn-in" data-act="save-add">+ Add</button>' +
      '<button type="button" class="btn btn-sm" data-act="save-out">Take out</button>' +
      '</span></div>';
    if (d.savings.goals.length) {
      d.savings.goals.forEach(function (g) {
        html += '<div class="goal" data-act="goal-edit" data-id="' + g.id + '" role="button" tabindex="0">' +
          '<div class="cat-head"><span class="cat-name">' + esc(g.name) + '</span>' +
          '<span class="cat-nums">' + money(g.saved) + (g.target > 0 ? ' / ' + money(g.target, { cents: false }) : '') + '</span></div>' +
          (g.target > 0 ? barHtml(g.pct >= 100 ? 'ok' : 'warn', g.pct) : '') + '</div>';
      });
    }
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:10px" data-act="goal-add">+ Add a savings goal</button>' +
      '</section>';

    return html;
  }

  /** "every 2 weeks · next Fri Aug 21" for an income source. */
  function nextPaydayText(src, d) {
    var cad = src.cadence === 'weekly' ? 'weekly'
      : src.cadence === 'monthly' ? 'monthly' : 'every 2 weeks';
    if (!src.nextPayday) return cad + ' · no payday set';
    return cad + ', next ' + weekdayShort(src.nextPayday) + ' ' + monthDay(src.nextPayday);
  }

  /**
   * The suggested budget, right on the page: what history says each everyday
   * category should get, capped so the whole plan stays under income
   * (four-walls essentials protected). One button applies the lot.
   */
  var PLAN = { list: [], totals: null };

  function loadPlanSuggest() {
    api('/budget/suggestions?month=' + encodeURIComponent(S.month || '')).then(function (out) {
      var box = el('plan-suggest');
      if (!box) return;
      PLAN.list = out.suggestions;
      PLAN.totals = out.totals;
      var over = out.totals.current - out.totals.income;

      if (!out.suggestions.length) {
        box.innerHTML = over > 0
          ? '<p class="small" style="margin:0"><b>This plan spends ' + money(over, { cents: false }) +
            ' more than comes in</b>, and the everyday budgets are already as low as they should go. ' +
            'The gap has to close on the bills side or with more income.</p>'
          : '<p class="small" style="margin:0"><b>This plan works.</b> Bills and budgets fit inside what comes in' +
            (out.totals.leftover > 0
              ? ', with <b class="week-in">' + money(out.totals.leftover, { cents: false }) +
                '</b> spare — give it a job: savings or the next debt.'
              : '.') + '</p>';
        return;
      }

      var html = over > 0
        ? '<p class="small" style="margin:0 0 10px"><b>' + money(over, { cents: false }) + ' short.</b> ' +
          'These changes close it — fun money first, food and fuel protected:</p>'
        : '<p class="small" style="margin:0 0 10px"><b>Suggested from what you actually spend:</b></p>';

      out.suggestions.forEach(function (s2) {
        var down = s2.suggested < s2.current;
        html += '<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line)">' +
          '<span style="font-weight:600">' + esc(s2.name) +
          (s2.essential ? ' <span class="badge badge-ok">four walls</span>' : '') + '</span>' +
          '<span class="cat-nums muted">' + money(s2.current, { cents: false }) +
          ' <span style="color:var(--text)">→</span> <b style="color:var(--text)">' +
          money(s2.suggested, { cents: false }) + '</b>' +
          (down ? ' <span class="tune-down">−' + money(s2.current - s2.suggested, { cents: false }) + '</span>' : '') +
          '</span></div>';
      });

      html += '<div class="cat-foot" style="margin-top:10px"><span>Plan after these changes</span>' +
        '<span>' + money(out.totals.ifAllApplied, { cents: false }) + ' of ' +
        money(out.totals.income, { cents: false }) + '</span></div>' +
        (out.totals.leftover >= 0
          ? '<div class="cat-foot"><span>Left over</span><span class="week-in">' +
            money(out.totals.leftover, { cents: false }) + '</span></div>'
          : '') +
        '<button type="button" class="btn btn-primary btn-block" style="margin-top:12px" data-act="plan-apply">Use this plan</button>' +
        '<button type="button" class="btn btn-block btn-sm" style="margin-top:8px" data-act="tuneup-open">Change them one at a time</button>';
      box.innerHTML = html;
    }).catch(function () {
      var box = el('plan-suggest');
      if (box) box.innerHTML = '<p class="muted small" style="margin:0">Could not build the plan right now.</p>';
    });
  }

  function planApplyAll() {
    var changes = PLAN.list.map(function (s) {
      return { category_id: s.category_id, budget: s.suggested };
    });
    if (!changes.length) return;
    mutate('/budget/apply', { method: 'POST', body: { changes: changes } },
      'Plan applied — ' + changes.length + ' budget' + (changes.length === 1 ? '' : 's') + ' updated ✓');
  }

  function loadCoach() {
    api('/plan/coach').then(function (out) {
      var box = el('coach-box');
      if (!box) return;
      var html = '';
      out.steps.forEach(function (st) {
        var isNow = st.n === out.currentStep;
        if (!isNow) {
          html += '<div class="coach-step' + (st.done ? ' coach-done' : '') + '">' +
            '<span class="coach-n">' + (st.done ? '✓' : st.n) + '</span>' +
            '<div class="coach-body"><span class="small' + (st.done ? '' : ' muted') + '">' + esc(st.title) + '</span></div></div>';
          return;
        }
        html += '<div class="coach-step coach-now">' +
          '<span class="coach-n">' + st.n + '</span>' +
          '<div class="coach-body"><b>' + esc(st.title) + '</b>' +
          '<span class="small muted">' + esc(st.detail) + '</span>' +
          (st.progress > 0 ? barHtml(st.progress >= 100 ? 'ok' : 'warn', st.progress) : '') +
          '</div></div>';
      });
      box.innerHTML = html;
    }).catch(function () {
      var box = el('coach-box');
      if (box) box.innerHTML = '<p class="muted small" style="margin:0">Could not load this right now.</p>';
    });
  }

  function planLine(label, value, sign) {
    return '<div class="plan-line"><span>' + esc(label) + '</span><b>' + sign + ' ' + money(value, { cents: false }) + '</b></div>';
  }

  // ------------------------------------------------------------ render: debt

  function viewDebt(d) {
    // Ramsey debt snowball: smallest balance first — the lawsuit outranks all.
    var open = d.debts.filter(function (x) { return !x.settled; })
      .sort(function (a, b) {
        var la = /lawsuit/i.test(a.label) ? 1 : 0;
        var lb = /lawsuit/i.test(b.label) ? 1 : 0;
        return (lb - la) || (a.balance - b.balance);
      });
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

    html += '<div class="section-title"><span>Settlement targets</span><span>snowball order</span></div>';
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
      // Name the weekday of the payday: a date on the wrong day is otherwise
      // impossible to spot in a date box.
      var dayName = s.nextPayday ? weekdayOf(s.nextPayday) : null;
      html += '<div class="edit-card">' +
        '<div class="edit-card-name">' + esc(s.name) +
        '<span class="muted small"> · ' + s.per_month + '×/mo' + (s.person ? ' · ' + esc(s.person) : '') + '</span></div>' +
        '<div class="edit-card-controls edit-card-3">' +
        '<label class="mini"><span>Per check</span>' +
        '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + s.amount +
        '" data-act="income-amount" data-id="' + s.id + '" aria-label="Amount for ' + esc(s.name) + '"></label>' +
        '<label class="mini"><span>Next payday' +
        (dayName ? ' <b class="' + (dayName === 'Friday' ? 'pay-day-ok' : 'pay-day-odd') + '">' + esc(dayName) + '</b>' : '') +
        '</span>' +
        '<input class="input" type="date" value="' + esc(s.nextPayday || '') +
        '" data-act="income-payday" data-id="' + s.id + '" aria-label="Next payday for ' + esc(s.name) + '"></label>' +
        '<label class="mini"><span>Repeats</span>' +
        '<select class="input" data-act="income-cadence" data-id="' + s.id + '" aria-label="Pay cadence for ' + esc(s.name) + '">' +
        ['biweekly', 'weekly', 'monthly'].map(function (c) {
          return '<option value="' + c + '"' + ((s.cadence || 'biweekly') === c ? ' selected' : '') + '>' +
            (c === 'biweekly' ? 'every 2 weeks' : c) + '</option>';
        }).join('') + '</select></label>' +
        '<button type="button" class="icon-del" data-act="del-income" data-id="' + s.id + '" aria-label="Delete income source">✕</button>' +
        '</div></div>';
    });
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:12px" data-act="add-income">+ Add income source</button>';
    html += '<p class="muted small" style="margin:10px 0 0">These are the plan. When a paycheck actually lands, log the real amount with the Log button on the Budget tab — that\'s what "money in" counts.</p>';
    html += '</section>';

    if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
      html += '<div class="section-title"><span>Reminders</span></div><section class="card">' +
        '<p class="muted small" style="margin:0 0 10px">A morning heads-up on this phone when bills are due ' +
        'or overdue, and when a new month\'s report is ready.</p>' +
        '<div id="push-status" class="muted small" style="margin-bottom:10px">Checking…</div>' +
        '<div class="stack">' +
        '<button type="button" class="btn btn-primary btn-block" data-act="push-enable">Turn on reminders</button>' +
        '<button type="button" class="btn btn-block btn-sm" data-act="push-test">Send a test</button>' +
        '<button type="button" class="btn btn-block btn-sm" data-act="push-disable">Turn off on this phone</button>' +
        '</div></section>';
      setTimeout(refreshPushStatus, 0);
    }

    html += '<div class="section-title"><span>Accounts</span>' +
      (d.bank && d.bank.set ? '<span>' + money(d.bank.total) + ' total</span>' : '') + '</div><section class="card">';
    if (d.bank && d.bank.accounts.length) {
      d.bank.accounts.forEach(function (a) {
        html += '<div class="edit-row" style="grid-template-columns:1fr auto auto">' +
          '<span class="edit-name">' + esc(a.name) + '</span>' +
          '<b>' + money(a.balance) + '</b>' +
          '<button type="button" class="btn btn-sm" data-act="account-open" data-id="' + a.id + '">Fix</button>' +
          '</div>';
      });
    } else {
      html += '<p class="muted small" style="margin:0 0 10px">Add each real account (checking, savings, business…) with what it holds — every dollar you log moves the right one.</p>';
    }
    html += '<button type="button" class="btn btn-block btn-sm" style="margin-top:10px" data-act="account-open" data-id="">+ Add account</button>' +
      '</section>';

    html += '<div class="section-title"><span>Backups</span></div><section class="card">' +
      '<p class="muted small" style="margin:0 0 10px">The whole budget is copied automatically every night ' +
      'and kept on the server — two weeks of nightly copies plus a year of monthly ones. ' +
      'Download a copy now and then to keep one off the server too.</p>' +
      '<div id="backup-status" class="muted small" style="margin-bottom:10px">Checking…</div>' +
      '<button type="button" class="btn btn-block btn-sm" data-act="backup-download">⬇ Download a backup</button>' +
      '</section>';
    setTimeout(refreshBackupStatus, 0);

    html += '<div class="section-title"><span>Savings goal</span></div><section class="card">' +
      '<div class="edit-row" style="grid-template-columns:1fr 118px">' +
      '<span class="edit-name">Put away each month<br><span class="muted small">Progress shows on the Plan tab</span></span>' +
      '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + (d.savings.target || 0) +
      '" data-act="savings-target" aria-label="Monthly savings goal">' +
      '</div></section>';

    html += '<div class="section-title"><span>Smart tune-up</span></div><section class="card">' +
      '<p class="muted small" style="margin:0 0 10px">Compares every spending budget to what you actually spent in past months and suggests new numbers. You pick which to apply.</p>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="tuneup-open">Review budget suggestions</button>' +
      '</section>';

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
      '<div class="row"><span class="muted small">Time zone</span><b>' + esc(d.timezone) + '</b></div>' +
      '<div class="row"><span class="muted small">App version</span><b>v' + APP_VERSION + '</b></div>';
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
    var isPayday = c.cadence === 'payday';
    var amountField = c.percent
      ? '<label class="mini"><span>% of income</span>' +
        '<input class="input" type="number" inputmode="numeric" step="1" min="1" max="100" value="' + c.percent +
        '" data-act="bill-percent" data-id="' + c.id + '" aria-label="Percent of income for ' + esc(c.name) + '"></label>'
      : '<label class="mini"><span>' + (isPayday ? 'Per payday' : 'Amount') + '</span>' +
        '<input class="input" type="number" inputmode="decimal" step="0.01" min="0" value="' + (isPayday ? c.perPay : c.budget) +
        '" data-act="budget" data-id="' + c.id + '" aria-label="Budget for ' + esc(c.name) + '"></label>';
    return '<div class="edit-card">' +
      '<div class="edit-card-name">' + esc(c.name) + note + '</div>' +
      '<div class="edit-card-controls edit-card-3">' +
      amountField +
      '<label class="mini"><span>Repeats</span>' +
      '<select class="input" data-act="bill-cadence" data-id="' + c.id + '" aria-label="How ' + esc(c.name) + ' repeats">' +
      '<option value="monthly"' + (isPayday ? '' : ' selected') + '>monthly</option>' +
      '<option value="payday"' + (isPayday ? ' selected' : '') + '>every payday</option>' +
      '</select></label>' +
      '<label class="mini"><span>Paid when</span>' +
      '<select class="input" data-act="bill-when" data-id="' + c.id + '"' + (isPayday ? ' disabled' : '') +
      ' aria-label="When ' + esc(c.name) + ' gets paid">' +
      '<option value="p0"' + (c.duePayday === 0 ? ' selected' : '') + '>1st paycheck</option>' +
      '<option value="p1"' + (c.duePayday === 1 ? ' selected' : '') + '>2nd paycheck</option>' +
      '<option value="day"' + (c.dueDay != null ? ' selected' : '') + '>day of month</option>' +
      '<option value="none"' + (c.duePayday == null && c.dueDay == null ? ' selected' : '') + '>no date</option>' +
      '</select></label>' +
      (c.dueDay != null || (c.duePayday == null && !isPayday)
        ? '<label class="mini"><span>Day</span>' +
          '<input class="input" type="number" inputmode="numeric" step="1" min="1" max="31" placeholder="—" value="' +
          (c.dueDay == null ? '' : c.dueDay) + '"' +
          ' data-act="due-day" data-id="' + c.id + '" aria-label="Day of month ' + esc(c.name) + ' is due"></label>'
        : '') +
      '<button type="button" class="icon-del" data-act="del-category" data-id="' + c.id +
      '" aria-label="Remove ' + esc(c.name) + '">✕</button>' +
      '</div>' +
      '<div class="edit-card-extra">' +
      (c.dueDay != null
        ? '<label class="switch"><input type="checkbox" data-act="bill-auto" data-id="' + c.id + '"' +
          (c.autoPay ? ' checked' : '') + '><span>Comes out on its own — tick it off automatically</span></label>'
        : '') +
      (bankAccounts().length > 1
        ? '<label class="mini" style="margin-top:6px"><span>Paid from</span>' +
          '<select class="input" data-act="bill-account" data-id="' + c.id + '" aria-label="Account ' + esc(c.name) + ' is paid from">' +
          bankAccounts().map(function (a) {
            return '<option value="' + a.id + '"' + (c.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
          }).join('') + '</select></label>'
        : '') +
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

  // ------------------------------------------------------------ push notifications

  function urlB64ToUint8(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function refreshBackupStatus() {
    var box = el('backup-status');
    if (!box) return;
    api('/backup/status').then(function (out) {
      box.textContent = out.newest
        ? 'Last backup: ' + monthDay(out.newest.date) + ' · ' + out.count + ' cop' + (out.count === 1 ? 'y' : 'ies') + ' kept'
        : 'No backup yet — the first one runs tonight.';
    }).catch(function () { box.textContent = 'Could not check just now.'; });
  }

  function downloadBackup(btn) {
    btn.disabled = true;
    fetch('/api/backup/download', { headers: { Authorization: 'Bearer ' + S.token } })
      .then(function (res) {
        if (!res.ok) throw new Error('Download failed — try again.');
        return res.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'lattimer-budget-' + (S.data ? S.data.today : 'backup') + '.db';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
        toast('Backup downloaded — keep it somewhere safe 💾');
        refreshBackupStatus();
      })
      .catch(function (err) { toast(err.message, 'error'); })
      .then(function () { btn.disabled = false; });
  }

  function refreshPushStatus() {
    var box = el('push-status');
    if (!box) return;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      var granted = Notification.permission === 'granted';
      box.textContent = sub && granted
        ? 'On for this phone ✓'
        : Notification.permission === 'denied'
          ? 'Blocked in this phone\'s browser settings — allow notifications for this app to use reminders.'
          : 'Off on this phone';
    }).catch(function () { box.textContent = 'Off on this phone'; });
  }

  function enablePush() {
    if (!('PushManager' in window)) { toast('This phone does not support notifications', 'error'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Notifications were not allowed', 'error'); refreshPushStatus(); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return api('/push/vapid-key').then(function (out) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8(out.key),
          });
        });
      }).then(function (sub) {
        return api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      }).then(function () {
        toast('Reminders are on for this phone 🔔');
        refreshPushStatus();
      });
    }).catch(function (err) { toast(err.message, 'error'); refreshPushStatus(); });
  }

  function disablePush() {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      if (!sub) { toast('Already off'); refreshPushStatus(); return; }
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return api('/push/unsubscribe', { method: 'POST', body: { endpoint: endpoint } });
      }).then(function () {
        toast('Reminders are off on this phone');
        refreshPushStatus();
      });
    }).catch(function (err) { toast(err.message, 'error'); });
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

  var QA = { digits: '', step: 1, note: '', date: null, person: null, details: false, mode: 'out', sourceId: null, sourceLabel: '', locked: false, account: null, fromId: null, toId: null };

  function qaAmount() { return Number(QA.digits || '0') / 100; }

  function bankAccounts() {
    return (S.data && S.data.bank && S.data.bank.accounts) || [];
  }

  /** Last account used on this phone, falling back to the first one. */
  function defaultAccount() {
    var accs = bankAccounts();
    var saved = Number(localStorage.getItem('lfb.account'));
    if (accs.some(function (a) { return a.id === saved; })) return saved;
    return accs.length ? accs[0].id : null;
  }

  function accountChips(selected, act) {
    var accs = bankAccounts();
    if (accs.length < 2) return '';
    return '<div class="chips qa-chips">' + accs.map(function (a) {
      return '<button type="button" class="chip" data-act="' + act + '" data-id="' + a.id + '"' +
        ' aria-pressed="' + (a.id === Number(selected) ? 'true' : 'false') + '">' + esc(a.name) + '</button>';
    }).join('') + '</div>';
  }

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
      mode: mode === 'in' ? 'in' : mode === 'move' ? 'move' : 'out',
      sourceId: source ? source.id : null,
      sourceLabel: source ? source.name : '',
      locked: Boolean(source),
      account: defaultAccount(),
      fromId: defaultAccount(),
      toId: null,
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
          (bankAccounts().length > 1
            ? '<button type="button" class="chip" data-act="qa-mode" data-mode="move" aria-pressed="' + (QA.mode === 'move') + '">Move</button>'
            : '') +
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

      // Which account this money touches (only shown once there are several).
      if (QA.mode !== 'move' && bankAccounts().length > 1) {
        html += '<div class="field" style="margin:0"><span style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin:2px 0 5px;text-align:center">' +
          (QA.mode === 'in' ? 'Into which account?' : 'From which account?') + '</span>' +
          accountChips(QA.account, 'qa-account') + '</div>';
      }

      // The fast path: their most-used categories, one tap to save.
      if (QA.mode === 'out') {
        html += '<div class="chips qa-chips">' +
          topCategories(6).map(function (c) {
            return '<button type="button" class="chip" data-act="qa-quick" data-id="' + c.id + '">' + esc(c.name) + '</button>';
          }).join('') + '</div>';
      }

      var nextLabel = QA.mode === 'in'
        ? (QA.locked ? 'Save paycheck' : 'Choose source →')
        : QA.mode === 'move' ? 'Pick the accounts →' : 'All categories →';
      html += '<button type="button" class="btn btn-accent btn-block" data-act="qa-next"' +
        (QA.digits ? '' : ' disabled') + '>' + nextLabel + '</button>';
      openSheet(html);
      return;
    }

    if (QA.mode === 'move') {
      var moveBody = sheetHead(money(qaAmount()) + ' — move between accounts') +
        '<div class="field"><span>From</span>' + accountRadio('mv-from', QA.fromId) + '</div>' +
        '<div class="field"><span>To</span>' + accountRadio('mv-to', QA.toId) + '</div>' +
        '<button type="button" class="btn btn-primary btn-block" data-act="qa-move-save"' +
        (QA.fromId && QA.toId && QA.fromId !== QA.toId ? '' : ' disabled') + '>Move it</button>' +
        '<button type="button" class="btn btn-block" style="margin-top:10px" data-act="qa-back">← Change amount</button>';
      openSheet(moveBody);
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

  /** Most-used everyday categories this month, topped up in budget order. */
  function topCategories(n) {
    var counts = {};
    S.data.transactions.forEach(function (t) {
      if (t.category_kind === 'variable') counts[t.category_id] = (counts[t.category_id] || 0) + 1;
    });
    return activeCats(S.data, 'variable')
      .slice()
      .sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0); })
      .slice(0, n);
  }

  function catPickHtml(c) {
    var left = c.remaining < 0 ? money(-c.remaining) + ' over' : money(c.remaining, { cents: false }) + ' left';
    return '<button type="button" class="cat-pick" data-act="qa-save" data-id="' + c.id + '">' +
      '<b>' + esc(c.name) + '</b><span>' + left + '</span></button>';
  }

  function accountRadio(act, selected) {
    return '<div class="chips">' + bankAccounts().map(function (a) {
      return '<button type="button" class="chip" data-act="' + act + '" data-id="' + a.id + '"' +
        ' aria-pressed="' + (a.id === Number(selected) ? 'true' : 'false') + '">' +
        esc(a.name) + ' · ' + money(a.balance, { cents: false }) + '</button>';
    }).join('') + '</div>';
  }

  function quickAddMove() {
    var amount = qaAmount();
    if (!(amount > 0) || !QA.fromId || !QA.toId || QA.fromId === QA.toId) return;
    var from = bankAccounts().filter(function (a) { return a.id === QA.fromId; })[0];
    var to = bankAccounts().filter(function (a) { return a.id === QA.toId; })[0];
    closeSheet();
    mutate('/transfers', {
      method: 'POST',
      body: { from_id: QA.fromId, to_id: QA.toId, amount: amount, date: QA.date, note: QA.note },
    }, money(amount) + ' moved ' + (from ? from.name : '') + ' → ' + (to ? to.name : ''));
  }

  function quickAddSave(categoryId) {
    var amount = qaAmount();
    if (!(amount > 0)) return;
    var body = {
      category_id: Number(categoryId), amount: amount, note: QA.note,
      date: QA.date, person: QA.person, client_id: newClientId(),
      account_id: QA.account,
    };
    if (QA.account) localStorage.setItem('lfb.account', String(QA.account));
    closeSheet();
    mutate('/transactions', { method: 'POST', body: body }, money(amount) + ' saved', money(amount) + ' of spending');
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
      client_id: newClientId(),
      account_id: QA.account,
    };
    if (!body.source_id) body.label = 'Other income';
    if (QA.account) localStorage.setItem('lfb.account', String(QA.account));
    closeSheet();
    mutate('/income/entries', { method: 'POST', body: body }, '+' + money(amount) + ' received 🎉', money(amount) + ' of income');
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
      (bankAccounts().length > 1
        ? '<label class="field"><span>Account</span><select class="input" id="tx-account">' +
          bankAccounts().map(function (a) {
            var sel = (t.account_id ? t.account_id === a.id : a.id === bankAccounts()[0].id);
            return '<option value="' + a.id + '"' + (sel ? ' selected' : '') + '>' + esc(a.name) + '</option>';
          }).join('') + '</select></label>'
        : '') +
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
    var accSel = $('#tx-account');
    if (accSel) body.account_id = Number(accSel.value);
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

  // ---- savings -----------------------------------------------------------

  function openSavings(direction, prefill, goalId) {
    QA.person = S.person;
    var goalField = '';
    if (S.data.savings.goals.length) {
      goalField = '<label class="field"><span>Toward</span><select class="input" id="sav-goal">' +
        '<option value=""' + (goalId ? '' : ' selected') + '>General savings</option>' +
        S.data.savings.goals.map(function (g) {
          return '<option value="' + g.id + '"' + (Number(goalId) === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') + '</select></label>';
    }
    openSheet(sheetHead(direction === 'out' ? 'Take out of savings' : 'Add to savings') +
      '<label class="field"><span>Amount</span>' +
      '<input class="input" id="sav-amount" type="number" inputmode="decimal" step="0.01" min="0.01"' +
      (prefill ? ' value="' + prefill + '"' : ' placeholder="0.00"') + '></label>' +
      goalField +
      '<label class="field"><span>Note</span>' +
      '<input class="input" id="sav-note" maxlength="200" placeholder="' +
      (direction === 'out' ? 'What it went to' : 'Leftover from July, extra check…') + '"></label>' +
      '<div class="field"><span>Who</span>' + personPicker(S.person) + '</div>' +
      '<button type="button" class="btn ' + (direction === 'out' ? 'btn-primary' : 'btn-in') + ' btn-block"' +
      ' data-act="sav-save" data-direction="' + (direction === 'out' ? 'out' : 'in') + '">' +
      (direction === 'out' ? 'Take out' : 'Put it away') + '</button>');
  }

  function saveSavings(direction) {
    var amount = Number($('#sav-amount').value);
    if (!(amount > 0)) { toast('Enter an amount', 'error'); return; }
    var goalSel = $('#sav-goal');
    var body = {
      amount: amount,
      direction: direction,
      note: $('#sav-note').value,
      person: QA.person,
      goal_id: goalSel && goalSel.value ? Number(goalSel.value) : null,
    };
    closeSheet();
    mutate('/savings/entries', { method: 'POST', body: body },
      direction === 'out' ? money(amount) + ' taken out' : '+' + money(amount) + ' saved 🎉');
  }

  function openGoalSheet(goal) {
    openSheet(sheetHead(goal ? 'Edit goal' : 'New savings goal') +
      '<label class="field"><span>Name</span>' +
      '<input class="input" id="goal-name" maxlength="60" placeholder="Christmas, emergency fund…"' +
      (goal ? ' value="' + esc(goal.name) + '"' : '') + '></label>' +
      '<label class="field"><span>Target (optional)</span>' +
      '<input class="input" id="goal-target" type="number" inputmode="decimal" step="0.01" min="0"' +
      (goal && goal.target ? ' value="' + goal.target + '"' : ' placeholder="0.00"') + '></label>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-act="goal-save"' +
      (goal ? ' data-id="' + goal.id + '"' : '') + '>' + (goal ? 'Save' : 'Add goal') + '</button>' +
      (goal
        ? '<button type="button" class="btn btn-in btn-block" data-act="save-add-goal" data-id="' + goal.id + '">+ Put money toward it</button>' +
          '<button type="button" class="btn btn-danger btn-block" data-act="goal-del" data-id="' + goal.id + '">Delete goal (money stays in savings)</button>'
        : '') +
      '</div>');
  }

  // ---- bank statement import -------------------------------------------

  var IMP = { rows: [], busy: false };

  function openImport() {
    IMP = { rows: [], busy: false };
    openSheet(sheetHead('Import bank statement') +
      '<p class="muted small" style="margin-top:0">Upload last month\'s statement PDF, a CSV export ' +
      '(PNC: Account Activity → Download), or paste the text. You review everything before it saves.</p>' +
      (bankAccounts().length > 1
        ? '<label class="field"><span>This statement is from</span><select class="input" id="imp-account">' +
          bankAccounts().map(function (a, i) {
            return '<option value="' + a.id + '"' + (a.id === defaultAccount() ? ' selected' : '') + '>' + esc(a.name) + '</option>';
          }).join('') + '</select></label>'
        : '') +
      '<label class="btn btn-block" style="margin-bottom:10px">Choose PDF or CSV file' +
      '<input type="file" id="imp-file" accept=".csv,.pdf,text/csv,text/plain,application/pdf" data-act="imp-file" hidden></label>' +
      '<label class="field"><span>Or paste it</span>' +
      '<textarea class="input imp-paste" id="imp-text" rows="4" placeholder="Date,Description,Withdrawals,Deposits…"></textarea></label>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="imp-preview">Preview</button>' +
      '<div id="imp-results"></div>');
  }

  function importPreview(payload) {
    if (typeof payload === 'string') payload = { text: payload };
    if (!payload || (!payload.pdf && (!payload.text || !payload.text.trim()))) {
      toast('Pick a file or paste the statement first', 'error');
      return;
    }
    var box = el('imp-results');
    if (box) box.innerHTML = '<p class="muted small" style="text-align:center">Reading' + (payload.pdf ? ' PDF' : '') + '…</p>';
    api('/import/preview', { method: 'POST', body: payload })
      .then(function (out) {
        IMP.rows = out.rows.map(function (r) {
          r.include = !r.alreadyImported && r.writable && r.direction === 'out' && !r.maybeManual && !r.transfer;
          if (r.direction === 'out' && !r.category_id) r.category_id = defaultImportCategory();
          return r;
        });
        renderImportRows(out);
      })
      .catch(function (err) { toast(err.message, 'error'); if (box) box.innerHTML = ''; });
  }

  function defaultImportCategory() {
    var misc = S.data.categories.filter(function (c) { return c.kind === 'variable' && !c.archived; })[0];
    return misc ? misc.id : null;
  }

  function renderImportRows(meta) {
    var box = el('imp-results');
    if (!box) return;
    if (!IMP.rows.length) {
      box.innerHTML = '<div class="empty">No transactions found in that file. ' +
        'Make sure it\'s the CSV export, not a PDF.</div>';
      return;
    }
    var cats = S.data.categories.filter(function (c) { return !c.archived; });
    var html = '<div class="section-title"><span>' + IMP.rows.length + ' rows found' +
      (meta && meta.truncated ? ' (first 400)' : '') + '</span><span>tap to adjust</span></div>';

    IMP.rows.forEach(function (r, idx) {
      var status = '';
      if (r.alreadyImported) status = '<span class="badge">already in</span>';
      else if (!r.writable) status = '<span class="badge">closed month</span>';
      else if (r.transfer) status = '<span class="badge">↔ between accounts</span>';
      else if (r.maybeManual) {
        status = '<span class="badge badge-alert" title="' + esc(r.match ? r.match.label : '') + '">already logged? ' +
          (r.match ? esc(monthDay(r.match.date)) + (r.match.person ? ' by ' + esc(r.match.person) : '') : '') + '</span>';
      }
      else if (r.direction === 'in') status = '<span class="badge badge-ok">deposit → income</span>';
      else if (r.guessedBy === 'learned') status = '<span class="badge badge-ok">remembered</span>';

      var disabled = r.alreadyImported || !r.writable;
      html += '<div class="imp-row' + (disabled ? ' imp-off' : '') + '">' +
        '<label class="imp-check"><input type="checkbox" data-act="imp-check" data-idx="' + idx + '"' +
        (r.include ? ' checked' : '') + (disabled ? ' disabled' : '') + '></label>' +
        '<div class="imp-main">' +
        '<div class="imp-desc">' + esc(r.description || '(no description)') + '</div>' +
        '<div class="imp-meta">' + esc(shortDate(r.date)) + ' · ' +
        (r.direction === 'in' ? '<b class="week-in">+' : '<b>') + money(r.amount) + '</b> ' + status + '</div>' +
        (r.direction === 'out' && !disabled
          ? '<select class="input imp-cat" data-act="imp-cat" data-idx="' + idx + '">' +
            cats.map(function (c) {
              return '<option value="' + c.id + '"' + (c.id === r.category_id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
            }).join('') + '</select>'
          : '') +
        '</div></div>';
    });

    var n = IMP.rows.filter(function (r) { return r.include; }).length;
    html += '<button type="button" class="btn btn-accent btn-block" style="margin-top:12px" data-act="imp-commit"' +
      (n ? '' : ' disabled') + '>Import ' + n + ' selected</button>';
    box.innerHTML = html;
  }

  function refreshImportButton() {
    var btn = $('[data-act="imp-commit"]');
    if (!btn) return;
    var n = IMP.rows.filter(function (r) { return r.include; }).length;
    btn.disabled = !n;
    btn.textContent = 'Import ' + n + ' selected';
  }

  function importCommit() {
    if (IMP.busy) return;
    var chosen = IMP.rows.filter(function (r) { return r.include; }).map(function (r) {
      return { date: r.date, description: r.description, amount: r.amount, direction: r.direction, category_id: r.category_id };
    });
    if (!chosen.length) return;
    IMP.busy = true;
    var accSel = el('imp-account');
    api('/import/commit', { method: 'POST', body: { rows: chosen, account_id: accSel ? Number(accSel.value) : undefined } })
      .then(function (out) {
        closeSheet();
        if (out.state) applyState(out.state);
        var bits = [];
        if (out.added) bits.push(out.added + ' spending');
        if (out.addedIncome) bits.push(out.addedIncome + ' income');
        if (out.skipped) bits.push(out.skipped + ' already in');
        toast('Imported: ' + (bits.join(', ') || 'nothing new'));
      })
      .catch(function (err) { toast(err.message, 'error'); })
      .then(function () { IMP.busy = false; });
  }

  // ---- budget tune-up ----------------------------------------------------

  var TUNE = { list: [], totals: null };

  function openTuneup() {
    openSheet(sheetHead('Smart budget tune-up') +
      '<p class="muted small" style="margin-top:0">Looking at what you actually spent…</p>');
    api('/budget/suggestions?month=' + encodeURIComponent(S.month || ''))
      .then(function (out) {
        TUNE.list = out.suggestions.map(function (s) { s.include = true; return s; });
        TUNE.totals = out.totals;
        var body = sheetHead('Smart budget tune-up');
        if (!TUNE.list.length) {
          body += '<div class="empty">Nothing to suggest yet. Once a full month of spending is in ' +
            'the books, this compares every budget to what really happened.</div>';
          openSheet(body);
          return;
        }
        body += out.mode === 'cut'
          ? '<div class="card due-alert" style="margin:0 0 10px">Your real spending outruns your income. ' +
            'These cuts bring the plan under what you make — lifestyle trims first, the four walls (food, fuel) last.</div>'
          : '<div class="card tune-fits" style="margin:0 0 10px">Good news: your spending fits under your income. ' +
            'These budgets track reality' +
            (out.totals.leftover > 0 ? ', and <b>' + money(out.totals.leftover, { cents: false }) + ' is left over — give every dollar a job (savings or debt)</b>' : '') +
            '.</div>';
        body += '<p class="muted small" style="margin-top:0">Based on ' +
          (out.monthsConsidered.length === 1
            ? monthLabel(out.monthsConsidered[0])
            : 'your last ' + out.monthsConsidered.length + ' months') +
          '. Applies this month forward. Accept them together — they only fit under your income as a set.</p>';
        TUNE.list.forEach(function (s, idx) {
          var up = s.delta > 0;
          body += '<div class="imp-row">' +
            '<label class="imp-check"><input type="checkbox" checked data-act="tune-check" data-idx="' + idx + '"></label>' +
            '<div class="imp-main">' +
            '<div class="imp-desc">' + esc(s.name) +
            (s.essential ? ' <span class="badge badge-ok">four walls</span>' : '') + '</div>' +
            '<div class="imp-meta">' +
            (s.average !== null ? 'really spending ' + money(s.average) + ' · ' : '') +
            'now budgeted ' + money(s.current, { cents: false }) + ' · ' + esc(s.why) + '</div>' +
            '<div class="tune-move ' + (up ? 'tune-up' : 'tune-down') + '">' +
            money(s.current, { cents: false }) + ' → ' + money(s.suggested, { cents: false }) +
            ' (' + (up ? '+' : '−') + money(Math.abs(s.delta), { cents: false }) + ')</div>' +
            '</div></div>';
        });
        body += '<div id="tune-totals"></div>' +
          '<button type="button" class="btn btn-primary btn-block" style="margin-top:12px" data-act="tune-apply">Apply selected</button>';
        openSheet(body);
        renderTuneTotals();
      })
      .catch(function (err) { toast(err.message, 'error'); closeSheet(); });
  }

  function renderTuneTotals() {
    var box = el('tune-totals');
    if (!box || !TUNE.totals) return;
    var delta = TUNE.list.reduce(function (s, x) { return x.include ? s + x.delta : s; }, 0);
    var projected = TUNE.totals.current + delta;
    var over = projected - TUNE.totals.income;
    box.innerHTML = '<div class="cat-foot" style="margin-top:10px"><span>Budget if applied</span>' +
      '<span class="' + (over > 0 ? 'cat-over' : '') + '">' + money(projected, { cents: false }) +
      ' of ' + money(TUNE.totals.income, { cents: false }) + ' income' +
      (over > 0 ? ' — ' + money(over, { cents: false }) + ' over' : '') + '</span></div>';
  }

  function tuneApply() {
    var changes = TUNE.list.filter(function (s) { return s.include; }).map(function (s) {
      return { category_id: s.category_id, budget: s.suggested };
    });
    if (!changes.length) { toast('Nothing selected', 'error'); return; }
    closeSheet();
    mutate('/budget/apply', { method: 'POST', body: { changes: changes } },
      'Updated ' + changes.length + ' budget' + (changes.length === 1 ? '' : 's'));
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

      case 'toast-undo': {
        var fn = undoFn;
        undoFn = null;
        el('toast').hidden = true;
        if (fn) fn();
        break;
      }

      case 'toggle-bill': {
        var cat = S.data.categories.filter(function (c) { return c.id === Number(id); })[0];
        if (!cat) break;
        mutate('/bills/' + id + '/pay', { method: 'POST', body: { paid: !cat.paid, month: S.data.month } },
          cat.paid ? cat.name + ' unmarked' : cat.name + ' paid');
        break;
      }

      case 'edit-tx': openEditTx(id); break;
      case 'tx-save': saveTx(id); break;
      case 'tx-delete': {
        var deadTx = S.data.transactions.filter(function (x) { return x.id === Number(id); })[0];
        closeSheet();
        mutate('/transactions/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadTx) {
            toastUndo(money(deadTx.amount) + ' ' + deadTx.category + ' deleted', function () {
              mutate('/transactions/restore', { method: 'POST', body: {
                category_id: deadTx.category_id, amount: deadTx.amount, note: deadTx.note,
                person: deadTx.person, date: deadTx.date, source: deadTx.source,
              } }, 'Restored');
            });
          }
        });
        break;
      }

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
      case 'del-deposit': {
        var deadDep = S.data.fund.deposits.filter(function (x) { return x.id === Number(id); })[0];
        mutate('/fund/deposits/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadDep) {
            toastUndo(money(deadDep.amount) + ' deposit removed', function () {
              mutate('/fund/deposits', { method: 'POST', body: {
                amount: deadDep.amount, note: deadDep.note, person: deadDep.person, date: deadDep.date,
              } }, 'Restored');
            });
          }
        });
        break;
      }

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
        var deadCat = S.data.categories.concat(S.data.upcoming || [])
          .filter(function (c) { return c.id === Number(id); })[0];
        mutate('/categories/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadCat) {
            toastUndo('"' + deadCat.name + '" removed', function () {
              mutate('/categories', { method: 'POST', body: {
                name: deadCat.name, kind: deadCat.kind, budget: deadCat.budget,
                starts_month: deadCat.startsMonth || null,
              } }, 'Restored');
            });
          }
        });
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
      case 'del-income': {
        var deadSrc = S.data.income.sources.filter(function (x) { return x.id === Number(id); })[0];
        mutate('/income/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadSrc) {
            toastUndo('"' + deadSrc.name + '" removed', function () {
              mutate('/income', { method: 'POST', body: {
                name: deadSrc.name, amount: deadSrc.amount, per_month: deadSrc.per_month, person: deadSrc.person,
              } }, 'Restored');
            });
          }
        });
        break;
      }

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
        QA.mode = node.dataset.mode === 'in' ? 'in' : node.dataset.mode === 'move' ? 'move' : 'out';
        renderQuickAdd();
        break;
      case 'qa-account':
        captureQaDetails();
        QA.account = Number(id);
        renderQuickAdd();
        break;
      case 'mv-from':
        QA.fromId = Number(id);
        renderQuickAdd();
        break;
      case 'mv-to':
        QA.toId = Number(id);
        renderQuickAdd();
        break;
      case 'qa-move-save': quickAddMove(); break;
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
      case 'qa-quick':
        if (!QA.digits) { toast('Type the amount first', 'error'); break; }
        captureQaDetails();
        quickAddSave(id);
        break;
      case 'qa-save-income': quickAddSaveIncome(node.dataset.id); break;
      case 'log-income': {
        var src = S.data.income.sources.filter(function (x) { return x.id === Number(id); })[0];
        openQuickAdd('in', src || null);
        break;
      }
      case 'edit-inc': openEditIncome(id); break;
      case 'transfer-open': {
        var tr = (S.data.transfers || []).filter(function (x) { return x.id === Number(id); })[0];
        if (!tr) break;
        openSheet(sheetHead('Moved between accounts') +
          '<p style="margin-top:0"><b>' + money(tr.amount) + '</b> from <b>' + esc(tr.from) + '</b> to <b>' + esc(tr.to) + '</b>' +
          '<span class="muted small" style="display:block;margin-top:4px">' + esc(dayLabel(tr.date)) + ' · ' + esc(tr.person) +
          (tr.note ? ' · ' + esc(tr.note) : '') + '</span></p>' +
          '<button type="button" class="btn btn-danger btn-block" data-act="transfer-delete" data-id="' + tr.id + '">Delete this transfer</button>');
        break;
      }
      case 'inc-entry-save': saveIncomeEntry(id); break;
      case 'inc-entry-delete': {
        var deadInc = S.data.income.entries.filter(function (x) { return x.id === Number(id); })[0];
        closeSheet();
        mutate('/income/entries/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadInc) {
            toastUndo('+' + money(deadInc.amount) + ' ' + deadInc.label + ' deleted', function () {
              mutate('/income/entries/restore', { method: 'POST', body: {
                source_id: deadInc.source_id, label: deadInc.label, amount: deadInc.amount,
                note: deadInc.note, person: deadInc.person, date: deadInc.date,
              } }, 'Restored');
            });
          }
        });
        break;
      }
      case 'filter-type':
        S.filters.type = node.dataset.type;
        render();
        break;

      case 'import-open': openImport(); break;
      case 'push-enable': enablePush(); break;
      case 'push-disable': disablePush(); break;
      case 'push-test':
        api('/push/test', { method: 'POST' })
          .then(function (out) {
            toast(out.sent ? 'Test sent to ' + out.sent + ' phone' + (out.sent === 1 ? '' : 's') : 'No phones have reminders on yet', out.sent ? 'info' : 'error');
          })
          .catch(function (err) { toast(err.message, 'error'); });
        break;
      case 'backup-download':
        downloadBackup(node);
        break;
      case 'review-dismiss':
        localStorage.setItem('lfb.review.' + node.dataset.month, 'seen');
        render();
        break;
      case 'income-sheet': openIncomeSheet(); break;
      case 'toggle-paid':
        S.ui.paidOpen = !S.ui.paidOpen;
        render();
        break;
      case 'cat-toggle':
        S.ui.openCats[node.dataset.id] = !S.ui.openCats[node.dataset.id];
        render();
        break;
      case 'account-open': openAccountSheet(node.dataset.id); break;
      case 'account-save': saveAccount(node.dataset.id); break;
      case 'account-delete':
        closeSheet();
        mutate('/accounts/' + id, { method: 'DELETE' }, 'Account removed');
        break;
      case 'qa-move': openQuickAdd('move'); break;
      case 'plan-apply': planApplyAll(); break;
      case 'transfer-delete':
        closeSheet();
        mutate('/transfers/' + id, { method: 'DELETE' }, 'Transfer removed');
        break;
      case 'save-add': openSavings('in', node.dataset.amount || ''); break;
      case 'save-add-goal': openSavings('in', '', node.dataset.id); break;
      case 'save-out': openSavings('out', ''); break;
      case 'sav-save': saveSavings(node.dataset.direction); break;
      case 'goal-add': openGoalSheet(null); break;
      case 'goal-edit': {
        var goal = S.data.savings.goals.filter(function (g) { return g.id === Number(id); })[0];
        if (goal) openGoalSheet(goal);
        break;
      }
      case 'goal-save': {
        var goalName = $('#goal-name').value.trim();
        if (!goalName) { toast('Give it a name', 'error'); break; }
        var goalBody = { name: goalName, target: Number($('#goal-target').value) || 0 };
        closeSheet();
        if (id) mutate('/savings/goals/' + id, { method: 'PUT', body: goalBody }, 'Saved');
        else mutate('/savings/goals', { method: 'POST', body: goalBody }, 'Goal added');
        break;
      }
      case 'goal-del': {
        var deadGoal = S.data.savings.goals.filter(function (g) { return g.id === Number(id); })[0];
        closeSheet();
        mutate('/savings/goals/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadGoal) {
            toastUndo('"' + deadGoal.name + '" goal deleted', function () {
              mutate('/savings/goals', { method: 'POST', body: { name: deadGoal.name, target: deadGoal.target } }, 'Restored');
            });
          }
        });
        break;
      }
      case 'save-del': {
        var deadSav = S.data.savings.entries.filter(function (x) { return x.id === Number(id); })[0];
        mutate('/savings/entries/' + id, { method: 'DELETE' }).then(function (r) {
          if (r && deadSav) {
            toastUndo(money(Math.abs(deadSav.amount)) + ' savings entry removed', function () {
              mutate('/savings/entries', { method: 'POST', body: {
                amount: Math.abs(deadSav.amount),
                direction: deadSav.amount < 0 ? 'out' : 'in',
                note: deadSav.note, person: deadSav.person, date: deadSav.date, goal_id: deadSav.goal_id,
              } }, 'Restored');
            });
          }
        });
        break;
      }
      case 'imp-preview': importPreview(el('imp-text') ? el('imp-text').value : ''); break;
      case 'imp-commit': importCommit(); break;
      case 'tuneup-open': openTuneup(); break;
      case 'tune-apply': tuneApply(); break;

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
    } else if (act === 'imp-file') {
      var file = node.files && node.files[0];
      if (!file) return;
      var isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      var reader = new FileReader();
      reader.onerror = function () { toast('Could not read that file', 'error'); };
      if (isPdf) {
        reader.onload = function () {
          var bytes = new Uint8Array(reader.result);
          var chunks = [];
          for (var i = 0; i < bytes.length; i += 0x8000) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
          }
          importPreview({ pdf: btoa(chunks.join('')) });
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = function () { importPreview(String(reader.result || '')); };
        reader.readAsText(file);
      }
    } else if (act === 'imp-check') {
      var impRow = IMP.rows[Number(node.dataset.idx)];
      if (impRow) { impRow.include = node.checked; refreshImportButton(); }
    } else if (act === 'imp-cat') {
      var catRow = IMP.rows[Number(node.dataset.idx)];
      if (catRow) catRow.category_id = Number(node.value);
    } else if (act === 'savings-target') {
      var goal = Number(node.value);
      if (!isFinite(goal) || goal < 0) { toast('Enter a positive number', 'error'); render(); return; }
      mutate('/savings/target', { method: 'PUT', body: { amount: goal } }, 'Savings goal updated');
    } else if (act === 'tune-check') {
      var tuneRow = TUNE.list[Number(node.dataset.idx)];
      if (tuneRow) { tuneRow.include = node.checked; renderTuneTotals(); }
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
    } else if (act === 'bill-percent') {
      var pctVal = Math.round(Number(node.value));
      if (!(pctVal >= 1 && pctVal <= 100)) { toast('Percent must be 1–100', 'error'); render(); return; }
      mutate('/categories/' + id, { method: 'PUT', body: { percent_income: pctVal } }, 'Now ' + pctVal + '% of income');
    } else if (act === 'bill-auto') {
      mutate('/categories/' + id, { method: 'PUT', body: { auto_pay: node.checked } },
        node.checked ? 'Will tick itself off on its due day' : 'Back to checking it off by hand');
    } else if (act === 'bill-account') {
      mutate('/categories/' + id, { method: 'PUT', body: { account_id: Number(node.value) } }, 'Account set');
    } else if (act === 'bill-when') {
      var v = node.value;
      if (v === 'p0' || v === 'p1') {
        mutate('/categories/' + id, { method: 'PUT', body: { due_payday: v === 'p0' ? 0 : 1 } },
          'Paid with the ' + (v === 'p0' ? '1st' : '2nd') + ' paycheck');
      } else if (v === 'none') {
        mutate('/categories/' + id, { method: 'PUT', body: { due_payday: null, due_day: null } }, 'No due date');
      } else {
        // switch to calendar mode; the day field appears for them to fill in
        mutate('/categories/' + id, { method: 'PUT', body: { due_payday: null, due_day: 1 } }, 'Set the day of the month');
      }
    } else if (act === 'bill-cadence') {
      mutate('/categories/' + id, { method: 'PUT', body: { cadence: node.value } },
        node.value === 'payday' ? 'Now repeats every payday' : 'Now monthly');
    } else if (act === 'income-payday') {
      mutate('/income/' + id, { method: 'PUT', body: { next_date: node.value || null } },
        node.value ? 'Payday set' : 'Payday cleared');
    } else if (act === 'income-cadence') {
      mutate('/income/' + id, { method: 'PUT', body: { cadence: node.value } }, 'Updated');
    } else if (act === 'income-amount') {
      var amount = Number(node.value);
      if (!isFinite(amount) || amount < 0) { toast('Enter a positive number', 'error'); render(); return; }
      mutate('/income/' + id, { method: 'PUT', body: { amount: amount } }, 'Income updated');
    }
  }

  function wireApp() {
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);

    // Live search in History; re-render keeps focus by restoring the value.
    var searchTimer = null;
    document.addEventListener('input', function (e) {
      var node = e.target.closest ? e.target.closest('[data-act="filter-search"]') : null;
      if (!node) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        S.filters.search = node.value;
        render();
        var again = $('[data-act="filter-search"]');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 250);
    });

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
      S.pinned = S.month !== S.data.currentMonth;
      refresh();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && S.data) { flushQueue(); refresh(true); }
    });
    window.addEventListener('online', function () {
      flushQueue();
      if (S.data) { refresh(true); startRealtime(); }
    });
    // Belt and suspenders: whatever events we miss, queued entries retry on
    // a slow interval until they make it through.
    setInterval(function () {
      if (S.token && loadQueue().length && navigator.onLine !== false) flushQueue();
    }, 20000);
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
      flushQueue();
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
