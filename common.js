/* GROKAZON shared page code: helpers, the Grok Bot nav, the footer, toast, sheets, the "Sign in with X" sheet. */
(function () {
  'use strict';
  var C = window.GZ_CONFIG || {};
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) {
    try { if (arguments.length > 1) { localStorage.setItem(k, JSON.stringify(v)); return v; } return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return arguments.length > 1 ? v : null; }
  }
  var tt;
  function toast(m) {
    var el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = m; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }
  // a modal sheet: bottom sheet on a phone, centred on desktop; Escape / backdrop closes
  function sheet(html, onOpen) {
    var s = document.createElement('div'); s.className = 'sheet on'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true');
    s.innerHTML = '<div class="panel">' + html + '</div>';
    document.body.appendChild(s);
    var close = function () { s.remove(); document.removeEventListener('keydown', key); };
    var key = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    s.addEventListener('click', function (e) { if (e.target === s || e.target.closest('[data-close]')) close(); });
    if (onOpen) onOpen(s, close);
    var f = $('input,select,button', s); if (f && window.matchMedia('(min-width: 900px)').matches) f.focus();
    return close;
  }
  // the wordmark: the bot glyph is the "o" once the generated PNG exists (art-src/PROMPTS.md); plain type until then
  function mark() {
    var g = C.ART && C.ART.glyph;
    return g ? 'gr<img src="' + esc(g) + '" alt="o">kazon' : 'grokazon';
  }
  /* Sign in with X: the helper runs X's own login (OAuth 2.0), reads the profile + X plan once, and gives this browser a
     random Grokazon session id (gz.xs) that goes with API calls as "Authorization: Bearer". Signed out, a preview switch
     shows what X Premium changes. */
  var API = (C.API || '').replace(/\/+$/, '');
  function session() { var s = store('gz.xs'); return /^[a-f0-9]{48}$/.test(s || '') ? s : ''; }
  function me() { return session() ? store('gz.me') : null; }
  // every API call says who it is for: the X session when signed in, and this browser's random id (orders, listings, missions)
  function deviceId() {
    var d = store('gz.device');
    if (!/^[a-f0-9]{24}$/.test(d || '')) { d = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); store('gz.device', d); }
    return d;
  }
  function authHeaders(h) { h = h || {}; if (session()) h.authorization = 'Bearer ' + session(); h['x-gz-device'] = deviceId(); return h; }
  // fast delivery is included with any X plan (Basic, Premium, Premium+); signed out, the preview switch decides
  function premium(v) {
    if (arguments.length) { store('gz.xpremium', !!v); document.dispatchEvent(new CustomEvent('gz:premium')); }
    var m = me(); return m ? !!m.fast : !!store('gz.xpremium');
  }
  function loadMe(quiet) {
    if (!session() || !API) return Promise.resolve(null);
    return fetch(API + '/me', { headers: authHeaders() }).then(function (r) {
      if (r.status === 401) { store('gz.xs', ''); store('gz.me', null); drawWho(); document.dispatchEvent(new CustomEvent('gz:premium')); if (!quiet) toast('Signed out of X'); return null; }
      return r.json();
    }).then(function (j) { if (j && j.username) { store('gz.me', j); drawWho(); document.dispatchEvent(new CustomEvent('gz:premium')); } return j; }).catch(function () { return null; });
  }
  function xLoginReady() {
    if (!API) return Promise.resolve(false);
    try { var c = sessionStorage.getItem('gz.xlogin'); if (c) return Promise.resolve(c === '1'); } catch (e) { }
    return fetch(API + '/health').then(function (r) { return r.json(); }).then(function (j) { try { sessionStorage.setItem('gz.xlogin', j.xLogin ? '1' : '0'); } catch (e) { } return !!j.xLogin; }).catch(function () { return false; });
  }
  function goX() { location.href = API + '/auth/x/start?return=' + encodeURIComponent(location.origin + location.pathname + location.search); }
  function previewSheet(note) {
    sheet('<h3>Sign in with <span class=\"xlogo\" role=\"img\" aria-label=\"X\"></span></h3><p>Your X account is your Grokazon account: Grok reads your X plan once, so fast delivery is applied automatically. ' + esc(note || 'X sign-in switches on as soon as Grokazon\u2019s X app is approved.') + ' Meanwhile, preview what X Premium changes:</p>' +
      '<label class="switch"><span>Preview as X Premium</span><input type="checkbox" id="xprem"' + (premium() ? ' checked' : '') + '></label>' +
      '<p style="margin-top:14px">Grokazon never asks for your X password or a card. Checkout always happens at the merchant.</p>' +
      '<div class="acts"><a class="pill grey sm" href="' + esc(C.X_PREMIUM) + '" target="_blank" rel="noopener">See X Premium ↗</a><button class="pill white sm" data-close type="button">Done</button></div>',
      function (s) { $('#xprem', s).addEventListener('change', function (e) { premium(e.target.checked); toast(e.target.checked ? 'Preview: X Premium, fast delivery included' : 'Preview off'); }); });
  }

  /* Sign in with a wallet (Solana): the wallet signs one plain message with a one-time code; nothing goes on-chain.
     Wallets are found through the Wallet Standard (any wallet that registers) plus the usual injected ones. */
  function findWallets() {
    var found = [], seen = {};
    var add = function (name, icon, api) { var k = String(name).toLowerCase().replace(/[^a-z0-9]/g, ''); if (!k || seen[k]) return; seen[k] = 1; found.push({ name: name, icon: icon || '', api: api }); };
    try {
      var reg = function (w) { try { if ((w.chains || []).some(function (c) { return /^solana:/.test(c); }) && w.features['standard:connect'] && w.features['solana:signMessage']) add(w.name, w.icon, { std: w }); } catch (e) { } };
      window.addEventListener('wallet-standard:register-wallet', function (e) { try { e.detail({ register: function () { Array.prototype.forEach.call(arguments, reg); } }); } catch (er) { } });
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: function () { Array.prototype.forEach.call(arguments, reg); } } }));
    } catch (e) { }
    var ph = window.phantom && window.phantom.solana; if (ph && ph.signMessage) add('Phantom', '', { legacy: ph });
    if (window.solflare && window.solflare.signMessage) add('Solflare', '', { legacy: window.solflare });
    if (window.backpack && window.backpack.signMessage) add('Backpack', '', { legacy: window.backpack });
    if (window.solana && window.solana.signMessage && !(ph && window.solana === ph)) add(window.solana.isPhantom ? 'Phantom' : 'Wallet', '', { legacy: window.solana });
    return found;
  }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function walletSignIn(w, onDone) {
    var address, account;
    var connect = w.api.std ? w.api.std.features['standard:connect'].connect().then(function (r) { account = (r.accounts || w.api.std.accounts || [])[0]; if (!account) throw new Error('No account'); address = account.address; })
      : w.api.legacy.connect().then(function (r) { var pk = (r && r.publicKey) || w.api.legacy.publicKey; address = pk.toBase58 ? pk.toBase58() : String(pk); });
    return connect.then(function () { return fetch(API + '/auth/wallet/nonce', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gz-device': deviceId() }, body: JSON.stringify({ address: address }) }).then(function (r) { return r.json(); }); })
      .then(function (j) {
        if (!j.message) throw new Error(j.error || 'Could not start the sign-in.');
        var bytes = new TextEncoder().encode(j.message);
        var sign = w.api.std ? w.api.std.features['solana:signMessage'].signMessage({ account: account, message: bytes }).then(function (r) { return (r[0] || r).signature; })
          : w.api.legacy.signMessage(bytes, 'utf8').then(function (r) { return r.signature || r; });
        return sign.then(function (sig) { return fetch(API + '/auth/wallet/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gz-device': deviceId() }, body: JSON.stringify({ address: address, signature: b64(sig), message: j.message }) }).then(function (r) { return r.json(); }); });
      })
      .then(function (j) {
        if (!j.sid) throw new Error(j.error || 'The wallet sign-in did not work.');
        store('gz.xs', j.sid); store('gz.me', j.me); drawWho(); document.dispatchEvent(new CustomEvent('gz:premium'));
        toast('Signed in with wallet ' + j.me.username); if (onDone) onDone(j.me);
      });
  }
  function walletSheet(close0) {
    var ws = findWallets(), phone = /iPhone|Android/i.test(navigator.userAgent) && !ws.length;
    var here = location.origin + location.pathname + location.search;
    sheet('<h3>Connect a wallet</h3><p>Your wallet becomes your Grokazon account: orders, missions and reviews follow it. You sign one plain message to prove you hold it. No transaction, no fee, nothing leaves the wallet.</p>' +
      (ws.length ? '<div class="wlist">' + ws.map(function (w, i) { return '<button class="pill grey block" type="button" data-w="' + i + '">' + (w.icon ? '<img src="' + esc(w.icon) + '" alt="">' : '') + 'Connect ' + esc(w.name) + '</button>'; }).join('') + '</div>'
        : phone ? '<div class="wlist"><a class="pill grey block" href="https://phantom.app/ul/browse/' + encodeURIComponent(here) + '?ref=' + encodeURIComponent(location.origin) + '">Open in Phantom</a><a class="pill grey block" href="https://solflare.com/ul/v1/browse/' + encodeURIComponent(here) + '?ref=' + encodeURIComponent(location.origin) + '">Open in Solflare</a></div><p class="mute">Grokazon opens inside the wallet\u2019s browser, then tap Connect.</p>'
        : '<p class="mute">No Solana wallet found in this browser. Install <a href="https://phantom.com" target="_blank" rel="noopener">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a>, then come back.</p>') +
      '<div class="werr" id="werr" role="alert"></div><div class="acts"><button class="pill line sm" type="button" data-close>Cancel</button></div>',
      function (s, close) {
        $$('[data-w]', s).forEach(function (b) { b.addEventListener('click', function () {
          $$('[data-w]', s).forEach(function (x) { x.disabled = true; }); b.textContent = 'Check your wallet\u2026';
          walletSignIn(ws[+b.getAttribute('data-w')], function () { close(); if (close0) close0(); }).catch(function (e) { $('#werr', s).textContent = /reject|denied|cancel/i.test(e.message || '') ? 'Sign-in cancelled in the wallet.' : (e.message || 'The wallet sign-in did not work.'); $$('[data-w]', s).forEach(function (x) { x.disabled = false; }); b.textContent = 'Connect ' + ws[+b.getAttribute('data-w')].name; });
        }); });
      });
  }
  // choose how to sign in: X (plan read once, fast delivery) or a wallet
  function chooseSheet() {
    sheet('<h3>Sign in to Grokazon</h3><p>One account for orders, missions and reviews, on every device you sign in on.</p>' +
      '<div class="wlist"><button class="pill white block" type="button" id="gox">Continue with <span class="xlogo" role="img" aria-label="X" style="margin-left:6px"></span></button><button class="pill grey block" type="button" id="gow">Connect a wallet</button></div>' +
      '<p class="mute" style="margin-top:12px">With X, any X plan includes X fast delivery. Grokazon never sees an X password or a wallet key.</p><div class="acts"><button class="pill line sm" type="button" data-close>Cancel</button></div>',
      function (s, close) {
        $('#gox', s).addEventListener('click', function () { xLoginReady().then(function (ok) { close(); if (ok) goX(); else previewSheet(); }); });
        $('#gow', s).addEventListener('click', function () { close(); walletSheet(); });
      });
  }
  function accountSheet() {
    var m = me();
    if (m.wallet) return walletAccountSheet(m);
    sheet('<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">' + whoAv(m, 'lg') + '<div><h3 style="margin:0">' + esc(m.name) + '</h3><span class="mute">@' + esc(m.username) + '</span></div></div>' +
      '<p>' + (m.fast ? '<b style="color:var(--ink);font-weight:500">' + esc(m.planName) + '</b>: fast delivery is included on every item marked X fast.' : 'No X subscription on this account, so X fast delivery is not included. Any X plan (Basic, Premium, Premium+) turns it on.') + '</p>' +
      '<p>Your missions now follow your X account to every device you sign in on. Grokazon read your profile and plan once; it cannot post, read your posts or see your password.</p>' +
      '<div class="acts">' + (m.fast ? '' : '<a class="pill grey sm" href="' + esc(C.X_PREMIUM) + '" target="_blank" rel="noopener">Get X Premium ↗</a>') + '<button class="pill line sm" type="button" id="xout">Sign out</button><button class="pill white sm" data-close type="button">Done</button></div>',
      function (s, close) {
        $('#xout', s).addEventListener('click', function () {
          var sid = session(); store('gz.xs', ''); store('gz.me', null); close(); drawWho(); document.dispatchEvent(new CustomEvent('gz:premium')); toast('Signed out');
          if (API && sid) fetch(API + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + sid } }).catch(function () { });
        });
      });
  }
  function walletAccountSheet(m) {
    sheet('<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">' + whoAv(m, 'lg') + '<div><h3 style="margin:0">Wallet account</h3><span class="mute mono" style="font-size:13px;word-break:break-all">' + esc(m.wallet) + '</span></div></div>' +
      '<p>Your orders, missions and reviews follow this wallet on every device. Grokazon only asked it to sign a message: no transaction, no fee, and it cannot move anything in the wallet.</p>' +
      '<p>X fast delivery comes with an X plan; sign in with X on this device to add it.</p>' +
      '<div class="acts"><button class="pill grey sm" type="button" id="wcopy">Copy address</button><button class="pill line sm" type="button" id="xout">Sign out</button><button class="pill white sm" data-close type="button">Done</button></div>',
      function (s, close) {
        $('#wcopy', s).addEventListener('click', function () { try { navigator.clipboard.writeText(m.wallet); toast('Address copied'); } catch (e) { } });
        $('#xout', s).addEventListener('click', function () {
          var sid = session(); store('gz.xs', ''); store('gz.me', null); close(); drawWho(); document.dispatchEvent(new CustomEvent('gz:premium')); toast('Signed out');
          if (API && sid) fetch(API + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + sid } }).catch(function () { });
        });
      });
  }
  function signIn() {
    if (me()) return accountSheet();
    if (!API) return previewSheet();
    chooseSheet();
  }
  function whoAv(m, cls) { return m && m.avatar ? '<img class="xav ' + (cls || '') + '" src="' + esc(m.avatar) + '" alt="" referrerpolicy="no-referrer">' : '<span class="xav ' + (cls || '') + ' ini' + (m && m.wallet ? ' wal' : '') + '">' + (m && m.wallet ? '\u25CE' : esc(((m && m.username) || 'x').charAt(0).toUpperCase())) + '</span>'; }
  function drawWho() {
    var m = me(), a = $('#xin'); if (!a) return;
    a.innerHTML = m ? whoAv(m) + '<span><small>Hello, ' + (m.wallet ? '' : '@') + esc(m.username) + '</small>Account</span>' : '<span><small>Hello, sign in</small>Sign in with <span class=\"xlogo\" role=\"img\" aria-label=\"X\"></span></span>';
  }
  // back from X: #gzs=<session> (signed in) or #gzx=notready|cancelled|failed
  function landing() {
    var h = location.hash, mS = h.match(/gzs=([a-f0-9]{48})/), mX = h.match(/gzx=(\w+)/);
    if (!mS && !mX) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (mS) { store('gz.xs', mS[1]); loadMe(true).then(function (j) { if (j) toast('Signed in as @' + j.username + (j.fast ? ' · ' + j.planName + ': fast delivery included' : '')); }); }
    else if (mX[1] === 'notready') { try { sessionStorage.setItem('gz.xlogin', '0'); } catch (e) { } previewSheet(); }
    else toast(mX[1] === 'cancelled' ? 'X sign-in cancelled' : 'X sign-in did not work. Try again.');
  }
  function cartCount() { var c = store('gz.cart') || []; return c.reduce(function (n, x) { return n + (x.qty || 1); }, 0); }
  function missionCount() { return (store('gz.missions') || []).length; }
  // missions with news (a first find or a price drop) since the visitor last opened Missions
  function newCount() { var n = (store('gz.missions') || []).filter(function (m) { return m.changedAt && m.changedAt > (m.seenAt || 0) && m.status !== 'done'; }).length; return n ? n + ' new' : ''; }
  // Amazon's two-tier top bar in the Grok skin: logo, deliver-to, the search bar (search the store or ask Grok),
  // account (Sign in with X), Returns & Orders, Cart; then the departments strip. Sticky, not fixed.
  /* Deliver to: each visitor's own place. First a private guess from this device (its time zone's city and its language
     region), never an IP lookup; tap to set city, country and postcode. Kept in this browser (gz.where). */
  var CC = 'US GB CA AU NZ IE DE FR ES IT NL BE CH AT SE NO DK FI PL PT CZ GR TR AE SA IL IN PK BD SG MY ID TH VN PH JP KR CN HK TW BR MX AR CL CO PE ZA NG KE EG MA'.split(' ');
  function regionName(cc) { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); } catch (e) { return cc; } }
  var TZ_CC = { 'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
    'Asia/Manila': 'PH', 'Asia/Jakarta': 'ID', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
    'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Jerusalem': 'IL', 'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
    'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Bucharest': 'RO',
    'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ',
    'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR',
    'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Africa/Cairo': 'EG' };
  function guessWhere() {
    var tz = '', cc = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
    (navigator.languages || [navigator.language || '']).some(function (l) { var m = String(l).match(/-([A-Za-z]{2})$/); if (m) { cc = m[1].toUpperCase(); return true; } return false; });
    var city = /\//.test(tz) && !/^Etc\//.test(tz) ? tz.split('/').pop().replace(/_/g, ' ') : '';
    // the clock's time zone says where the device is; the browser language only says which English it reads
    // (an en-US browser in Kuala Lumpur is in Malaysia)
    var byTz = TZ_CC[tz] || (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota|Juneau|Menominee)/.test(tz) || tz === 'Pacific/Honolulu' ? 'US' : '');
    return { city: city, cc: byTz || cc, src: 'device' };
  }
  function where(v) {
    if (arguments.length) { store('gz.where', v); drawWhere(); document.dispatchEvent(new CustomEvent('gz:where')); }
    var w = store('gz.where'); return w && (w.city || w.cc) ? w : guessWhere();
  }
  function whereLabel(w) { w = w || where(); return w.city || (w.cc ? regionName(w.cc) : 'your area'); }
  function drawWhere() { $$('[data-where]').forEach(function (el) { el.innerHTML = '<small>Deliver to</small>' + esc(whereLabel()) + (el.classList.contains('dlvm') ? ' \u203a' : ''); }); }
  function whereSheet() {
    var w = where();
    sheet('<h3>Choose your delivery location</h3><p>Delivery dates and checkout use this. It stays in this browser.</p>' +
      '<form id="wf"><div class="fld2"><label class="fld">City<input name="city" maxlength="60" value="' + esc(w.city || '') + '" placeholder="Kuala Lumpur"></label>' +
      '<label class="fld">Postcode (optional)<input name="zip" maxlength="12" value="' + esc(w.zip || '') + '" autocomplete="postal-code"></label></div>' +
      '<label class="fld">Country<select name="cc">' + CC.concat(w.cc && CC.indexOf(w.cc) < 0 ? [w.cc] : []).map(function (c) { return [c, regionName(c)]; }).sort(function (a, b) { return a[1] < b[1] ? -1 : 1; }).map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === w.cc ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
      '<div class="acts"><button class="pill line sm" type="button" id="wGuess">Use this device\u2019s guess</button><button class="pill white sm" type="submit">Done</button></div></form>',
      function (s, close) {
        $('#wf', s).addEventListener('submit', function (e) { e.preventDefault(); var f = e.target; where({ city: f.city.value.trim(), zip: f.zip.value.trim(), cc: f.cc.value, src: 'set' }); close(); toast('Delivering to ' + whereLabel()); });
        $('#wGuess', s).addEventListener('click', function () { try { localStorage.removeItem('gz.where'); } catch (e) { } drawWhere(); document.dispatchEvent(new CustomEvent('gz:where')); close(); toast('Delivering to ' + whereLabel()); });
      });
  }

  var DEPTS = [['electronics', 'Electronics'], ['home', 'Home & Kitchen'], ['grocery', 'Grocery'], ['beauty', 'Beauty'], ['fashion', 'Fashion'], ['sports', 'Sports']];
  function nav() {
    var top = $('nav.nav'); if (!top) return;
    var on = top.getAttribute('data-on') || '', P = new URLSearchParams(location.search);
    var q = /search\.html$/.test(location.pathname) ? (P.get('q') || '') : '', dsel = P.get('dept') || '';
    var strip = [['All', 'search.html', 'all'], ['Today\u2019s Deals', 'search.html?deals=1', 'deals']].concat(DEPTS.map(function (d) { return [d[1], 'search.html?dept=' + d[0], d[0]]; }))
      .concat([['Ask Grok', 'results.html', 'shop'], ['Grok Missions <b class="newN">' + newCount() + '</b>', 'missions.html', 'missions'], ['Sell on Grokazon', 'seller.html', 'sell'], ['Meet Grok', 'about.html', 'about']]);
    top.innerHTML = '<div class="belt"><a class="mark" href="index.html" aria-label="grokazon home">' + mark() + '</a>' +
      '<button class="deliver" type="button" data-where></button>' +
      '<form class="sbar" action="search.html" role="search"><select name="dept" aria-label="Department"><option value="">All</option>' + DEPTS.map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === dsel ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') + '</select>' +
      '<input name="q" value="' + esc(q) + '" placeholder="Search Grokazon or ask Grok" aria-label="Search Grokazon or ask Grok" autocomplete="off"><button type="submit" aria-label="Search">' + (C.ART && C.ART.glyph ? '<img src="' + esc(C.ART.glyph) + '" alt="">' : 'Go') + '</button></form>' +
      '<button class="acct" type="button" id="xin"></button>' +
      '<a class="acct orders" href="orders.html"><small>Returns</small>&amp; Orders</a>' +
      '<a class="cartb" href="cart.html" aria-label="Cart"><b id="cartN">' + cartCount() + '</b><span>Cart</span></a><button class="dlvm" type="button" data-where></button></div>' +
      '<div class="strip" role="navigation" aria-label="Departments">' + strip.map(function (l) { return '<a href="' + l[1] + '"' + (l[2] === on ? ' class="on" aria-current="page"' : '') + '>' + l[0] + '</a>'; }).join('') + '</div>';
    $('#xin').addEventListener('click', signIn);
    $$('[data-where]', top).forEach(function (b) { b.addEventListener('click', whereSheet); }); drawWhere();
    $('.sbar', top).addEventListener('submit', function (e) { var i = $('input', this); if (!i.value.trim()) { e.preventDefault(); i.focus(); } else if (!$('select', this).value) $('select', this).disabled = true; });
  }
  function refreshCounts() { var n = $('#cartN'); if (n) n.textContent = cartCount(); $$('.newN').forEach(function (b) { b.textContent = newCount(); }); }
  function footer() {
    var f = $('footer.foot'); if (!f) return;
    f.innerHTML = '<div class="wrap"><div class="cols"><div><a class="mark" href="index.html">' + mark() + '</a><span>Don’t shop. Send Grok.</span></div>' +
      '<div><b>Shop</b><a href="search.html?deals=1">Today’s Deals</a><a href="results.html">Ask Grok</a><a href="missions.html">Grok Missions</a><a href="orders.html">Returns &amp; Orders</a></div>' +
      '<div><b>Sell</b><a href="seller.html">Sell on Grokazon</a><a href="sell.html">How selling works</a><a href="index.html#pricing">X fast delivery</a><a href="about.html">Meet Grok</a></div>' +
      '<div><b>Grokazon</b><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="orders.html">Your orders</a></div>' +
      '<div><b>Follow</b>' + (C.X_URL ? '<a href="' + esc(C.X_URL) + '" target="_blank" rel="noopener"><span class="xlogo" role="img" aria-label="X" style="margin:0 6px 0 0"></span>@' + esc(C.X_URL.split('/').pop()) + '</a>' : '') + '</div>' +
      '<div><b>Sources</b><a href="' + esc(C.ARTICLE) + '" target="_blank" rel="noopener">Business Insider ↗</a></div></div>' +
      '</div>';
  }
  window.GZ = { $: $, $$: $$, esc: esc, store: store, toast: toast, sheet: sheet, premium: premium, signIn: signIn, refreshCounts: refreshCounts, mark: mark, C: C, me: me, authHeaders: authHeaders, deviceId: deviceId, DEPTS: DEPTS, where: where, whereLabel: whereLabel, whereSheet: whereSheet, regionName: regionName };
  nav(); drawWho(); landing();
  try { if (API && navigator.sendBeacon && !/admin\.html$/.test(location.pathname)) navigator.sendBeacon(API + '/hit'); } catch (e) { }
  try { if (session() && !sessionStorage.getItem('gz.mechecked')) { sessionStorage.setItem('gz.mechecked', '1'); loadMe(true); } } catch (e) { }
  document.addEventListener('DOMContentLoaded', footer);
})();
