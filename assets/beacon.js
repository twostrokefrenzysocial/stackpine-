/* Stackpine analytics beacon.
 *
 * Posts one record per page view to your own admin backend. No cookies, no
 * third party, no personal data — the server derives a visitor id that rotates
 * at UTC midnight, so it cannot follow anyone across days. That is why this
 * needs no cookie banner.
 *
 * SET THIS after deploying stackpine-admin on Railway, e.g.
 *   https://admin.stackpine.org
 * While it is left empty the beacon does nothing at all.
 */
var STACKPINE_ANALYTICS_ENDPOINT = 'https://stackpine-admin-production.up.railway.app';

(function () {
  'use strict';
  if (!STACKPINE_ANALYTICS_ENDPOINT) return;            // not configured yet
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  function send() {
    try {
      fetch(STACKPINE_ANALYTICS_ENDPOINT.replace(/\/$/, '') + '/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, referrer: document.referrer || null }),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      }).catch(function () { /* analytics must never break the page */ });
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'complete') send();
  else addEventListener('load', send, { once: true });
})();
