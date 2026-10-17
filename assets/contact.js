/* Stackpine enquiry form.
 *
 * Posts to the admin backend, which stores the enquiry and emails it on.
 * The endpoint is shared with the analytics beacon, so there is one place to
 * change it (assets/beacon.js).
 *
 * If the backend is unreachable the form stays filled in and the visitor is
 * given the address to write to, so nobody who took the time to fill it in
 * loses their message.
 */
(function () {
  'use strict';

  var form = document.getElementById('enquiry');
  if (!form) return;

  var statusEl = document.getElementById('form-status');
  var btn = document.getElementById('f-submit');
  var done = document.getElementById('form-done');
  var shownAt = Date.now();
  var FALLBACK = 'chris@stackpine.org';

  // Carry over what was typed into the homepage "start" box.
  var carried = new URLSearchParams(location.search).get('problem');
  if (carried && !form.elements.problem.value) form.elements.problem.value = carried.slice(0, 3000);

  function endpoint() {
    var e = (typeof window.STACKPINE_ANALYTICS_ENDPOINT === 'string') ? window.STACKPINE_ANALYTICS_ENDPOINT : '';
    return e.replace(/\/$/, '');
  }

  function say(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'form__status' + (isError ? ' is-error' : '');
  }

  function flag(el) {
    el.setAttribute('aria-invalid', 'true');
    el.addEventListener('input', function clear() {
      el.removeAttribute('aria-invalid');
      el.removeEventListener('input', clear);
    });
    el.focus();
  }

  function val(name) { return (form.elements[name].value || '').trim(); }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    say('');

    var name = val('name'), email = val('email'), problem = val('problem');
    if (!name) { say('Please tell us your name.', true); flag(form.elements.name); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('That email address doesn’t look right. Check it and try again.', true); flag(form.elements.email); return; }
    if (problem.length < 15) { say('Please tell us a little more about what’s slowing your business down (a sentence or two is plenty).', true); flag(form.elements.problem); return; }

    var url = endpoint();
    if (!url) {
      say('Sorry, the form isn’t available right now. Please email ' + FALLBACK + ' instead.', true);
      return;
    }

    btn.disabled = true;
    var label = btn.firstChild.textContent;
    btn.firstChild.textContent = 'Sending…';

    var body = {};
    ['name', 'email', 'phone', 'company', 'business', 'problem', 'vision',
     'current', 'people', 'timeline', 'heard', 'website'].forEach(function (k) { body[k] = val(k); });
    body.elapsed = Date.now() - shownAt;

    fetch(url + '/api/enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        form.hidden = true;
        done.hidden = false;
        var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        done.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
        done.querySelector('h2').focus();
      });
    }).catch(function (err) {
      var network = err instanceof TypeError;
      say(network
        ? 'We couldn’t send that just now. Your answers are still here — try again, or email ' + FALLBACK + '.'
        : err.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.firstChild.textContent = label;
    });
  });
})();
