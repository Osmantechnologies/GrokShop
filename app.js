/* GROKAZON app: catalogue, product cards, cart, missions, the ask flow, and each page's setup (body[data-page]). */
(function () {
  'use strict';
  var G = window.GZ, C = G.C, $ = G.$, $$ = G.$$, esc = G.esc;
  var API = (C.API || '').replace(/\/+$/, '');
  var OWNER_Q = 'Find me the best wireless headphones under $150, delivered this week.';

  /* ---------- catalogue: every seller (through the helper), once per session ---------- */
  var CAT_KEY = 'gz.cat.v6', catP = null, byId = {}, SHOPS = [];
  function timed(url, ms, init) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, Object.assign({}, init || {}, { signal: ctl.signal })).finally(function () { clearTimeout(t); });
  }
  function catalogue() {
    if (catP) return catP;
    catP = (function () {
      try { var c = JSON.parse(sessionStorage.getItem(CAT_KEY) || 'null'); if (c && c.products && c.products.length) { c.products.shops = c.shops; return Promise.resolve(c.products); } } catch (e) { }
      var direct = function () { return timed(C.CATALOGUE, 15000).then(function (r) { if (!r.ok) throw new Error('catalogue ' + r.status); return r.json(); }); };
      var src = API ? timed(API + '/catalogue', 20000).then(function (r) { if (!r.ok) throw new Error('catalogue ' + r.status); return r.json(); }).catch(direct) : direct();
      return src.then(function (j) {
        var list = j.products.map(function (p) {
          return { id: p.id, dept: p.dept || '', source: p.source || 'demo', test: !!p.test, shop: p.shop || '', merchant: p.merchant || '', variantId: p.variantId || '', title: p.title, description: p.description, category: p.category, price: p.price, discountPercentage: p.discountPercentage, rating: p.rating == null ? null : p.rating, stock: p.stock == null ? null : p.stock, tags: p.tags || [], brand: p.brand || '', warrantyInformation: p.warrantyInformation || '', shippingInformation: p.shippingInformation || '', availabilityStatus: p.availabilityStatus, returnPolicy: p.returnPolicy || '',
            ref: p.ref ? { match: p.ref.match, name: p.ref.name, retailer: p.ref.retailer, url: p.ref.url, price: p.ref.price, checked: p.ref.checked } : null, reviews: (p.reviews || []).map(function (r) { return { rating: r.rating, comment: r.comment, date: r.date, reviewerName: r.reviewerName, verified: !!r.verified, test: !!r.test }; }), images: p.images || [], thumbnail: p.thumbnail };
        });
        list.shops = j.shops || [];
        try { sessionStorage.setItem(CAT_KEY, JSON.stringify({ products: list, shops: list.shops })); } catch (e) { }
        return list;
      });
    })().then(function (list) { list.forEach(function (p) { byId[String(p.id)] = p; }); SHOPS = list.shops || SHOPS; return list; });
    catP.catch(function () { catP = null; });
    return catP;
  }
  // eBay items are not in the catalogue (they are searched live); the ones a shopper viewed are remembered in this browser
  function get(id) { return byId[String(id)] || (/^e-/.test(String(id)) ? (G.store('gz.ebay') || {})[String(id)] : undefined); }

  /* ---------- product facts (all from the catalogue) ---------- */
  function titleCase(s) { return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function merchant(p) { return p.merchant || ((p.brand ? p.brand : titleCase(p.category.replace(/-/g, ' '))) + ' store'); }
  function isShop(p) { return p.source === 'shopify'; }
  function shopTag(p) { return p.source === 'cj' ? '<span class="tag">Ships from US</span>' : ''; }
  function fast(p) { var s = p.shippingInformation || '', m = s.match(/(\d+)-(\d+) days/i); return /overnight|1-2 business|3-5 business/i.test(s) || (!!m && +m[2] <= 5); }   // X fast delivery: anything that arrives within a working week
  function shipDays(p) {
    var s = (p.shippingInformation || '').toLowerCase();
    if (/overnight/.test(s)) return { n: 1, biz: true }; var m = s.match(/(\d+)-(\d+) business/); if (m) return { n: +m[2], biz: true };
    m = s.match(/(\d+)-(\d+) days/); if (m) return { n: +m[2] };
    if (/1 week/.test(s)) return { n: 7 }; if (/2 weeks/.test(s)) return { n: 14 }; if (/1 month/.test(s)) return { n: 30 }; return null;
  }
  function eta(p) {
    var d = shipDays(p); if (!d) return ''; var t = new Date(), n = d.n;
    if (d.biz) { while (n > 0) { t.setDate(t.getDate() + 1); if (t.getDay() % 6) n--; } } else t.setDate(t.getDate() + n);
    return t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function money(n) { return '$' + Number(n).toFixed(2); }
  function was(p) { return p.discountPercentage > 0 ? p.price / (1 - p.discountPercentage / 100) : 0; }
  function starsTxt(r) { var f = Math.round(r); return '★★★★★'.slice(0, f) + '☆☆☆☆☆'.slice(0, 5 - f); }
  function stars(p) { if (p.rating == null) return '<span class="stars"><span class="mute">no ratings yet</span></span>'; return '<span class="stars"><span class="s5" aria-hidden="true">' + starsTxt(p.rating) + '</span><span>' + p.rating + '</span><span class="mute">(' + p.reviews.length + ' reviews)</span></span>'; }
  function xBadge(p) {
    if (!fast(p)) return '';
    return G.premium() ? '<span class="tag ok">X fast · free</span>' : '<span class="tag x">X fast · free with X Premium</span>';
  }
  function delivLine(p) { var e = eta(p); return '<div class="deliv">' + esc(p.shippingInformation || 'Shipping set by the store at checkout') + (e ? ' · <span class="mute">est. by ' + esc(e) + '</span>' : '') + '</div>'; }
  function stockTag(p) { if (p.stock == null) return '<span class="tag ' + (/in stock/i.test(p.availabilityStatus) ? 'ok' : 'warn') + '">' + esc(p.availabilityStatus) + '</span>'; return p.stock > 0 ? '<span class="tag ok">' + esc(p.availabilityStatus) + '</span>' : '<span class="tag warn">Out of stock</span>'; }

  // the Amazon card anatomy, inside a bot message: photo, title, stars + count, big price, delivery line, badge
  function card(p, o) {
    o = o || {}; var w = was(p);
    return '<article class="pcard' + (o.pick ? ' is-pick' : '') + '" data-id="' + p.id + '">' +
      '<a class="ph" href="product.html?id=' + p.id + '"><img src="' + esc(p.thumbnail) + '" alt="' + esc(p.title) + '" loading="lazy" width="300" height="300"></a>' +
      '<div class="bd"><div class="badges">' + (o.pick ? '<span class="tag pick">Grok’s pick</span>' : (o.rank ? '<span class="tag">#' + o.rank + '</span>' : '')) + xBadge(p) + shopTag(p) + '</div>' +
      '<a class="ti" href="product.html?id=' + p.id + '">' + esc(p.title) + '</a><div class="mer">Sold by ' + esc(merchant(p)) + '</div>' + stars(p) +
      '<div class="price">' + money(p.price) + (w ? '<small>' + money(w) + '</small>' : '') + '</div>' + delivLine(p) + '</div>' +
      (o.why ? '<div class="why"><b>why</b> ' + esc(o.why) + '</div>' : '') +
      (o.acts !== false ? '<div class="acts"><button class="pill white sm" type="button" data-add="' + p.id + '">Add to cart</button><a class="pill grey sm" href="product.html?id=' + p.id + '">Details</a></div>' : '') +
      '</article>';
  }
  function avatar(name, i, cls) {
    var faces = (C.ART && C.ART.faces) || [], f = faces.length ? faces[i % faces.length] : '';
    var cols = ['g', 'o', 'b', 'p', 'y', 'w'], ini = String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    return '<span class="av ' + cols[i % cols.length] + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + (f ? '<img src="' + esc(f) + '" alt="">' : esc(ini || 'G')) + '</span>';
  }
  function grokAv(cls) { var g = C.ART && C.ART.glyph; return g ? '<span class="av w' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><img src="' + esc(g) + '" alt=""></span>' : avatar('Grok', 0, cls); }

  /* ---------- cart (this browser only; checkout always happens at the merchant) ---------- */
  function cart() { return G.store('gz.cart') || []; }
  function saveCart(c) { G.store('gz.cart', c); G.refreshCounts(); }
  function addToCart(id, quiet) {
    var p0 = get(id), key = p0 ? p0.id : id, c = cart(), x = c.filter(function (i) { return String(i.id) === String(key); })[0];
    if (x) x.qty = Math.min(9, (x.qty || 1) + 1); else c.push({ id: key, qty: 1 });
    saveCart(c); if (!quiet) { var p = get(id); G.toast('Added' + (p ? ': ' + p.title : '')); }
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-add]'); if (b) addToCart(b.getAttribute('data-add')); });
  function merchantLink(p) { return 'https://dummyjson.com/products/' + p.id; }   // demo products only: their source record stands in for a checkout
  // Shopify products: a real cart at the store, then its own checkout page (the tab opens first so it is not blocked)
  function shopCheckout(items) {
    var w = window.open('about:blank', '_blank');
    return timed(API + '/checkout', 20000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: items.map(function (x) { return { id: x.p.id, qty: x.qty }; }) }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'The store did not answer.'); return j; }); })
      .then(function (j) { if (w) w.location.href = j.url; else location.href = j.url; return j; })
      .catch(function (e) { if (w) w.close(); G.toast(/Failed to fetch|abort/i.test(e.message || '') ? 'Could not reach the store. Try again.' : e.message); throw e; });
  }
  function checkoutButton(items, m, cls) {
    var p = items[0].p;
    if (isShop(p) && API) return '<button class="pill white ' + (cls || 'sm') + '" type="button" data-checkout="' + esc(p.shop) + '">Checkout at ' + esc(m) + ' ↗</button>';
    return '<a class="pill ' + (cls === 'grey' ? 'grey' : 'white sm') + '" href="' + esc(merchantLink(p)) + '" target="_blank" rel="noopener">Checkout at ' + esc(m) + ' ↗</a>';
  }

  /* ---------- missions: kept in this browser, watched by the helper every hour (missions.js in the Worker) ---------- */
  function missions() { return G.store('gz.missions') || []; }
  var syncT;
  function saveMissions(m, noSync) {
    G.store('gz.missions', m); G.refreshCounts();
    if (!noSync && API) { clearTimeout(syncT); syncT = setTimeout(function () { pushMissions(m).catch(function () { }); }, 300); }
  }
  // a random id for this browser (no account, no personal data): the helper files its missions under it
  function deviceId() {
    var d = G.store('gz.device');
    if (!/^[a-f0-9]{24}$/.test(d || '')) { d = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); G.store('gz.device', d); }
    return d;
  }
  function pushMissions(ms) {
    return timed(API + '/missions', 10000, { method: 'POST', headers: G.authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ device: deviceId(), missions: ms.map(function (m) { return { id: m.id, name: m.name, what: m.what, budget: m.budget, every: m.every, status: m.status === 'done' ? 'done' : undefined }; }) }) })
      .then(function (r) { if (!r.ok) throw new Error('sync ' + r.status); return r.json(); });
  }
  function fresh(m) { return !!m.changedAt && m.changedAt > (m.seenAt || 0) && m.status !== 'done'; }
  // sync, then read the helper's reports (it re-checks due missions itself, hourly, even with every page closed);
  // helper missing or down: a quick check in this browser instead. Resolves {live}.
  function watchAll(list) {
    var local = function () {
      var ms = missions();
      return Promise.all(ms.filter(function (m) { return m.status !== 'done'; }).map(function (m) { return refreshMission(m, list); })).then(function () { saveMissions(ms, true); return { live: false }; });
    };
    if (!API) return local();
    return pushMissions(missions()).then(function () { return timed(API + '/missions?device=' + deviceId(), 10000, { headers: G.authHeaders() }); }).then(function (r) { return r.json(); }).then(function (j) {
      var by = {}; (j.missions || []).forEach(function (s) { by[s.id] = s; });
      var cur = missions();
      cur.forEach(function (m) {
        var s = by[m.id]; if (!s) return;
        ['status', 'report', 'bestId', 'bestPrice', 'changedAt', 'change'].forEach(function (k) { if (s[k] !== undefined) m[k] = s[k]; });
        if (s.checkedAt) m.checked = s.checkedAt;
      });
      saveMissions(cur, true); return { live: true };
    }).catch(function () { return local(); });
  }
  function seedMissions() {
    if (G.store('gz.seeded')) return; G.store('gz.seeded', true);
    var now = Date.now();
    saveMissions([
      { id: 'm1', name: 'Headphones hunt', what: OWNER_Q, budget: 150, by: 'this week', every: 'once', at: now - 3600e3, status: 'watching', report: 'starting…', example: true },
      { id: 'm2', name: 'Coffee restock', what: 'restock my coffee every 3 weeks, best price', budget: 20, by: '', every: 'every 3 weeks', at: now - 86400e3, status: 'watching', report: 'starting…', example: true }
    ]);
  }
  var STOP = /^(the|and|for|with|under|best|find|me|my|a|an|of|to|every|weeks?|price|delivered|this|week|that|ships?|in|days?|restock)$/;
  function localMatch(list, q, budget) {   // used only when the helper is offline: plain word match + budget
    var terms = String(q).toLowerCase().match(/[a-z]{3,}/g) || []; terms = terms.filter(function (t) { return !STOP.test(t); });
    return list.filter(function (p) { var h = (p.title + ' ' + p.category + ' ' + (p.tags || []).join(' ')).toLowerCase(); return terms.some(function (t) { return h.indexOf(t.replace(/s$/, '')) >= 0; }) && (!budget || p.price <= budget); });
  }
  function refreshMission(m, list) {
    var q = m.what + (m.budget && !/\$\d/.test(m.what) ? ' under $' + m.budget : '');
    var done = function (ids, src) {
      var ps = ids.map(get).filter(Boolean).filter(function (p) { return !m.budget || p.price <= m.budget; });
      var best = ps.sort(function (a, b) { return a.price - b.price; })[0];
      m.checked = Date.now();
      if (best) { m.status = 'found'; m.bestId = best.id; m.report = 'found ' + ps.length + (m.budget ? ' under $' + m.budget : '') + ', best so far ' + money(best.price) + ' (' + best.title.toLowerCase() + ')'; }
      else { m.status = 'watching'; m.report = 'still watching, nothing' + (m.budget ? ' under $' + m.budget : '') + ' yet'; }
      if (src) m.report += src;
      return m;
    };
    if (!API) return Promise.resolve(done(localMatch(list, m.what, m.budget).map(function (p) { return p.id; }), ''));
    return timed(API + '/match?q=' + encodeURIComponent(q), 8000).then(function (r) { return r.json(); }).then(function (j) { return done(j.ids || [], ''); })
      .catch(function () { return done(localMatch(list, m.what, m.budget).map(function (p) { return p.id; }), ' · helper offline, quick check'); });
  }
  function ago(t) { var s = (Date.now() - t) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.round(s / 60) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; }
  function statusTag(s) { return '<span class="tag ' + (s === 'found' ? 'pick' : s === 'done' ? '' : 'ok') + '">' + esc(s) + '</span>'; }
  function botRow(m, i, on, href) {
    return '<a class="bot' + (on ? ' on' : '') + '" href="' + esc(href || ('results.html?q=' + encodeURIComponent(m.what) + '&m=' + m.id)) + '">' + avatar(m.name, i + 1) +
      '<div class="who"><div class="row1"><span>' + esc(m.name) + '</span><span class="time">' + ago(m.checked || m.at) + '</span></div><div class="rep">' + esc(m.report || '') + '</div><div class="st">' + statusTag(m.status) + '</div></div></a>';
  }
  function newMission(prefill) {
    G.sheet('<h3>New mission</h3><p>' + (API ? 'Grok re-checks it on its own, every hour, even with this page closed, and reports back on Missions. No account: missions belong to this browser.' : 'Grok checks it each time you open Missions. No account: missions belong to this browser.') + '</p>' +
      '<form id="mf"><label class="fld">What should Grok find?<input name="what" required maxlength="200" placeholder="' + esc(OWNER_Q) + '" value="' + esc(prefill || '') + '"></label>' +
      '<div class="fld2"><label class="fld">Budget (USD)<input name="budget" type="number" min="1" max="100000" inputmode="decimal" placeholder="150"></label>' +
      '<label class="fld">By when<select name="by"><option value="">Any time</option><option>this week</option><option>in 2 weeks</option><option>this month</option></select></label></div>' +
      '<label class="fld">How often should Grok check?<select name="every"><option>hourly</option><option selected>daily</option><option>weekly</option><option>every 3 weeks</option><option>once</option></select></label>' +
      '<div class="acts"><button class="pill grey sm" type="button" data-close>Cancel</button><button class="pill white sm" type="submit">Start mission</button></div></form>',
      function (s, close) {
        $('#mf', s).addEventListener('submit', function (e) {
          e.preventDefault(); var f = e.target, what = f.what.value.trim(); if (!what) return;
          var name = what.replace(/^(find|get|buy|watch|restock)( me)?( the| a| an| my)?\s+/i, '').split(/\s+/).slice(0, 3).join(' ');
          var m = { id: 'm' + Date.now().toString(36), name: name.charAt(0).toUpperCase() + name.slice(1), what: what, budget: +f.budget.value || 0, by: f.by.value, every: f.every.value, at: Date.now(), status: 'watching', report: 'starting…' };
          var all = missions(); all.unshift(m); saveMissions(all); close(); G.toast('Mission started: ' + m.name);
          document.dispatchEvent(new CustomEvent('gz:missions'));
        });
      });
  }

  /* ---------- the ask (Worker /ask; saved headphones answer when the helper is down) ---------- */
  function fixture() { return timed('data/fixture-headphones.json', 8000).then(function (r) { return r.json(); }); }
  function ask(q, useFixture) {
    if (!API) return fixture().then(function (a) { a.offline = 'no-api'; return a; });
    return timed(API + '/ask' + (useFixture ? '?fixture=1' : ''), 90000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: q }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || ('helper ' + r.status)); e.api = true; throw e; } return j; }); })
      .catch(function (e) { return fixture().then(function (a) { a.offline = e.api ? e.message : 'down'; return a; }); });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function msgBot(html, cls) { return '<div class="msg gk' + (cls ? ' ' + cls : '') + '">' + grokAv() + '<div class="bub"><div class="name">Grok</div>' + html + '</div></div>'; }
  function msgUser(t) { return '<div class="msg user"><div class="bub">' + esc(t) + '</div></div>'; }
  function compareTable(rows) {
    return '<div class="cmp-wrap"><table class="cmp"><thead><tr><th>Product</th><th>Price</th><th>Delivery</th><th>Seller trust</th><th>Key spec</th></tr></thead><tbody>' +
      rows.map(function (c) { var p = get(c.id); return p ? '<tr><td data-l="Product"><a href="product.html?id=' + p.id + '">' + esc(p.title) + '</a><br><span class="mute">' + esc(merchant(p)) + '</span></td><td class="p" data-l="Price">' + money(p.price) + '</td><td data-l="Delivery">' + esc(p.shippingInformation) + (fast(p) ? '<br><span class="mute">X fast</span>' : '') + '</td><td data-l="Seller trust">' + esc(c.trust || '') + '</td><td data-l="Key spec">' + esc(c.spec || '') + '</td></tr>' : ''; }).join('') +
      '</tbody></table></div>';
  }
  function exampleChips() {
    return ['Find me the best wireless headphones under $150, delivered this week.', 'a standing desk under $300 that ships to KL in 5 days', 'restock my coffee every 3 weeks, best price'];
  }

  // the X delivery tiers band (prices only once verified on x.com, else a link)
  function fillTiers() {
    var X = C.X_PRICES;
    [['basic', 'X Basic', ['Grok shops for you', 'X fast delivery on eligible items']], ['premium', 'X Premium', ['Everything in Basic', 'Missions that check daily', 'X fast delivery on eligible items']], ['plus', 'X Premium+', ['Everything in Premium', 'Missions that check hourly', 'X fast delivery, first in line']]].forEach(function (t, i) {
      var el = $$('.tier')[i]; if (!el) return;
      el.querySelector('.amt').outerHTML = X && X[t[0]] ? '<div class="amt">' + esc(X[t[0]]) + ' <small>/ month</small></div><div class="bill">Billed by X</div>' : '<div class="amt see">Price on X</div><div class="bill"><a href="' + esc(C.X_PREMIUM) + '" target="_blank" rel="noopener" style="text-decoration:underline">see x.com/premium ↗</a></div>';
      el.querySelector('ul').innerHTML = t[2].map(function (x, j) { return '<li' + (j === t[2].length - 1 ? ' class="d"' : '') + '>' + esc(x) + '</li>'; }).join('');
    });
  }

  /* ---------- pages ---------- */
  var PAGES = {};

  // HOME: the x.ai/bot page with shopping inside
  PAGES.home = function () {
    $('#heroForm').addEventListener('submit', function (e) { e.preventDefault(); var q = $('#q').value.trim() || OWNER_Q; location.href = 'results.html?q=' + encodeURIComponent(q); });
    $('#seeMission').addEventListener('click', function () { $('#window').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#heroChips').innerHTML = exampleChips().map(function (t) { return '<a class="chip" href="results.html?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('');
    $('#quoteSrc').href = C.ARTICLE;
    $$('[data-top]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { $('#q').focus(); }, 350); }); });
    fillTiers();
    $$('[data-signin]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); G.signIn(); }); });
    if (C.ART && C.ART.glyph) $('#glyph').innerHTML = '<img class="glyph" src="' + esc(C.ART.glyph) + '" alt="">';
    $('#ctaSend').addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { $('#q').focus(); }, 350); });
    $$('[data-newmission]').forEach(function (b) { b.addEventListener('click', function () { newMission(); }); });
    // the timer on the "watching" strip
    var t0 = Date.now(), tm = $('#watchT');
    setInterval(function () { var s = Math.floor((Date.now() - t0) / 1000); tm.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000);

    Promise.all([catalogue(), fixture()]).then(function (r) {
      var list = r[0], fx = r[1];
      homeWindow(fx); feature1(); feature2(list); feature3(fx); jobs();
    }).catch(function (e) {
      console.warn('catalogue', e);
      $('#winThread').innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>';
    });
    document.addEventListener('gz:premium', function () { catalogue().then(function () { fixture().then(homeWindow); }); });
  };
  function homeWindow(fx) {
    var bots = [
      { name: 'Headphones hunt', t: '1:58 AM', rep: 'found ' + fx.picks.length + ' under $150, cart’s built.', st: 'found', on: true },
      { name: 'Standing desk', t: '9:12 PM', rep: 'no standing desk in the catalogue yet, still watching', st: 'watching' },
      { name: 'Coffee restock', t: 'Mon', rep: 'next run in 3 weeks', st: 'watching' },
      { name: 'Gift for Dana', t: 'Sun', rep: 'picked ck one for dana', st: 'done' }
    ];
    $('#winSide').innerHTML = '<div class="search">Search</div>' + bots.map(function (b, i) {
      return '<a class="bot' + (b.on ? ' on' : '') + '" href="results.html?q=' + encodeURIComponent(i ? b.name : OWNER_Q) + '">' + avatar(b.name, i + 1) + '<div class="who"><div class="row1"><span>' + esc(b.name) + '</span><span class="time">' + b.t + '</span></div><div class="rep">' + esc(b.rep) + '</div></div></a>';
    }).join('') + '<button class="newbot" type="button" data-newmission>+ New mission</button>';
    $('[data-newmission]', $('#winSide')).addEventListener('click', function () { newMission(); });
    var pick = fx.picks[0] && get(fx.picks[0].id);
    $('#winThread').innerHTML = '<div class="head">' + avatar('Headphones hunt', 1, 'sm') + 'Headphones hunt</div><div class="sys">Renamed to Headphones hunt</div>' + msgUser(OWNER_Q) +
      msgBot('<div class="steps">' + fx.thread.slice(0, 4).map(function (s) { return '<div class="s">' + esc(s) + '</div>'; }).join('') + '</div>') +
      msgBot('<p>found ' + fx.picks.length + ' under $150. ' + (pick ? esc(pick.title.toLowerCase()) + ' is the pick.' : '') + '</p><div class="cards' + (fx.picks.length > 2 ? ' three' : '') + '">' +
        fx.picks.map(function (p, i) { var x = get(p.id); return x ? card(x, { pick: i === 0, rank: i + 1, why: p.why }) : ''; }).join('') + '</div>') +
      msgBot('<p>' + esc(fx.note || '') + '</p><div class="chips" style="margin-top:8px"><a class="pill white sm" href="results.html?q=' + encodeURIComponent(OWNER_Q) + '&fixture=1">Open this thread</a><a class="pill grey sm" href="cart.html">See cart</a></div>');
  }
  function feature1() {
    var p = get(13);   // the closest real answer to "a standing desk under $300": the catalogue has no standing desk
    $('#f1').innerHTML = '<div class="ptop">' + grokAv('sm') + 'Grok</div><div class="thread">' + msgUser('a standing desk under $300 that ships to KL in 5 days') +
      msgBot('<div class="steps"><div class="s">reading your constraints: budget $300, 5 days</div><div class="s">no standing desk under $300 in any store yet</div></div>') +
      (p ? msgBot('<p>closest under $300: ' + esc(p.title.toLowerCase()) + ', ' + money(p.price) + ', ' + esc(p.shippingInformation.toLowerCase()) + '. want me to watch for a real standing desk?</p>') : '') + '</div>';
  }
  function feature2(list) {
    var counts = {}; list.forEach(function (p) { var m = merchant(p); counts[m] = (counts[m] || 0) + 1; });
    var shopNames = {}; list.forEach(function (p) { if (isShop(p)) shopNames[merchant(p)] = 'Shopify store'; });
    var top = Object.keys(counts).sort(function (a, b) { return (shopNames[b] ? 1 : 0) - (shopNames[a] ? 1 : 0) || counts[b] - counts[a]; }).slice(0, 6);
    $('#f2').innerHTML = '<div class="win-bar"><i></i><i></i><i></i><span class="t">Sellers on Grokazon</span></div><div style="padding:6px 16px 10px">' +
      top.map(function (m, i) { return '<div class="mrow">' + avatar(m, i + 1, 'sm') + '<div class="n">' + esc(m) + '<small>' + counts[m] + ' products</small></div><span class="tag' + (shopNames[m] ? ' ok' : '') + '">' + (shopNames[m] || 'seller') + '</span></div>'; }).join('') +
      '<div class="mrow"><span class="av sm w" aria-hidden="true">+</span><div class="n">Your Shopify store<small>joins with its own API key, never scraped</small></div><span class="tag ok">permitted API</span></div></div>';
  }
  function feature3(fx) { $('#f3').innerHTML = '<div class="name" style="font-size:12px;color:var(--mute);margin-bottom:6px">Grok · compare</div>' + compareTable(fx.compare); }
  var JOBS = [
    ['Price watch', 'Wait for the right price.', 'Name the item and the number. Grok checks every day and pings you the moment it drops.', 'tell me when apple airpods drop under $110', function () { var p = get(100); return 'watching apple store daily. today ' + money(p.price) + ', not there yet. i’ll ping you.'; }],
    ['Restock', 'Never run out.', 'Grok re-buys the things you use up, on your schedule, at the best price it finds that day.', 'restock my coffee every 3 weeks, best price', function () { var p = get(34); return 'set. ' + p.title.toLowerCase() + ' ' + money(p.price) + ', ' + p.shippingInformation.toLowerCase() + '. next run in 3 weeks.'; }],
    ['Gift under $50', 'Gifts without the scroll.', 'Say who it is for, what they like and the budget. Grok comes back with the one it would pick.', 'a gift under $50 for dana, she likes fragrance', function () { var p = get(6); return p.title.toLowerCase() + ', ' + money(p.price) + ', ' + p.rating + '★, ' + p.shippingInformation.toLowerCase() + '. add it?'; }],
    ['Best of category', 'The best one, explained.', 'Grok ranks a whole category on rating, returns and warranty, and shows its working.', 'best-rated laptop, any price', function () { var p = get(80); return p.title.toLowerCase() + ' leads on rating at ' + p.rating + '★, ' + money(p.price) + ', ' + p.warrantyInformation.toLowerCase() + '.'; }],
    ['Bundle for a trip', 'One ask, one cart.', 'Grok builds a set of things that go together and keeps the total under your budget.', 'sunglasses and a bag for a beach weekend under $80', function () { var a = get(156), b = get(175); return a.title.toLowerCase() + ' ' + money(a.price) + ' + ' + b.title.toLowerCase() + ' ' + money(b.price) + ' = ' + money(a.price + b.price) + '. under budget.'; }],
    ['Handle my returns', 'Returns, handled by a bot.', 'Tell Grok what you bought and where. It keeps the return window and the store\u2019s policy in view and reminds you before time runs out.', 'remind me before the beats flex return window closes', function () { var p = get(107); return 'beats store gives ' + p.returnPolicy.toLowerCase() + ' on ' + p.title.toLowerCase() + '. i\u2019ll remind you a day before it closes.'; }],
    ['Replace what broke', 'Fix it in one line.', 'Tell Grok what broke. It finds the same thing or a better one, and the fastest way to get it.', 'my iphone charger died, replace it', function () { var p = get(104); return 'same one: ' + p.title.toLowerCase() + ', ' + money(p.price) + '. heads up, it ' + p.shippingInformation.toLowerCase() + ', no x fast on this one.'; }]
  ];
  function jobs() {
    var row = $('#jobChips');
    row.innerHTML = JOBS.map(function (j, i) { return '<button type="button" class="chip' + (i ? '' : ' on') + '" data-j="' + i + '" aria-pressed="' + (i ? 'false' : 'true') + '">' + (i ? '' : avatar(j[0], 0, 'sm')) + esc(j[0]) + '</button>'; }).join('');
    var show = function (i) {
      var j = JOBS[i];
      $$('button', row).forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', k === i); b.innerHTML = (k === i ? avatar(JOBS[k][0], 0, 'sm') : '') + esc(JOBS[k][0]); });
      $('#jobDesc').innerHTML = '<b>' + esc(j[1]) + '</b> ' + esc(j[2]);
      var reply; try { reply = j[4](); } catch (e) { reply = 'on it. i’ll report back here.'; }   // demo examples may be switched off
      $('#jobPhone').innerHTML = '<div class="ptop">' + avatar(j[0], i + 1, 'sm') + esc(j[0]) + '</div><div class="thread">' + msgUser(j[3]) + msgBot('<p>' + esc(reply) + '</p>') + '</div>' +
        '<a class="pill white sm" style="margin-top:auto;align-self:center" href="results.html?q=' + encodeURIComponent(j[3]) + '">Try this mission</a>';
    };
    row.addEventListener('click', function (e) { var b = e.target.closest('[data-j]'); if (b) show(+b.getAttribute('data-j')); });
    show(0);
  }

  // RESULTS: the full-screen app window; thread = this search
  PAGES.results = function () {
    var P = new URLSearchParams(location.search), q = (P.get('q') || '').trim(), useFx = P.get('fixture') === '1', mid = P.get('m');
    seedMissions();
    var side = function () {
      var ms = missions();
      $('#side').innerHTML = '<div class="search">Missions</div>' + (q ? '<a class="bot' + (mid ? '' : ' on') + '" href="#">' + grokAv() + '<div class="who"><div class="row1"><span>This search</span><span class="time">now</span></div><div class="rep">' + esc(q.toLowerCase()) + '</div></div></a>' : '') +
        ms.map(function (m, i) { return botRow(m, i, m.id === mid); }).join('') + '<button class="newbot" type="button" id="nm">+ New mission</button>';
      $('#nm').addEventListener('click', function () { newMission(q); });
    };
    side(); document.addEventListener('gz:missions', side);
    catalogue().then(function (list) { return watchAll(list).then(side); }).catch(function () { });
    $('#follow').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#fq').value.trim(); if (v) location.href = 'results.html?q=' + encodeURIComponent(v); });
    var th = $('#thread');
    if (!q) {
      $('#winTitle').textContent = 'New search';
      th.insertAdjacentHTML('beforeend', msgBot('<p>what should i find? say what it is, your budget and when you need it.</p><div class="chips" style="margin-top:10px">' + exampleChips().map(function (t) { return '<a class="chip" href="results.html?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('') + '</div>'));
      catalogue().catch(function () { });
      return;
    }
    document.title = q + ' · Grokazon';
    $('#winTitle').textContent = q.length > 60 ? q.slice(0, 57) + '…' : q;
    $('#fq').placeholder = 'Ask a follow-up, or a new search';
    th.insertAdjacentHTML('beforeend', msgUser(q));
    th.insertAdjacentHTML('beforeend', msgBot('<button class="collapse" type="button" id="tog" aria-expanded="true"><span>Grok’s steps <span class="mono" id="stTm">· shopping 0:00</span></span><span class="tog">hide</span></button><div class="steps" id="steps"><div class="s run">reading your constraints</div></div>', 'stepmsg'));
    $('#tog').addEventListener('click', function () { var s = $('#steps'), o = s.hidden; s.hidden = !o; this.setAttribute('aria-expanded', o); $('.tog', this).textContent = o ? 'hide' : 'show'; });
    var steps = $('#steps'), t0 = Date.now(), tm = $('#stTm');
    // while Grok works (a new search takes ~15 s on grok-4.3): a running clock + what is really happening right now
    var clock = setInterval(function () { var s = Math.floor((Date.now() - t0) / 1000); tm.textContent = '· shopping ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 250);
    var waits = [[1500, 'pulling matches from the catalogue'], [3500, 'grok is comparing price, delivery and seller trust'], [12000, 'still comparing, new searches take about 15 seconds']].map(function (w) {
      return setTimeout(function () { $$('.s.run', steps).forEach(function (x) { x.classList.remove('run'); }); steps.insertAdjacentHTML('beforeend', '<div class="s run">' + esc(w[1]) + '</div>'); }, w[0]);
    });
    var stopClock = function () { clearInterval(clock); waits.forEach(clearTimeout); tm.textContent = '· done in ' + Math.max(1, Math.round((Date.now() - t0) / 1000)) + ' s'; };
    Promise.all([catalogue(), ask(q, useFx)]).then(async function (r) {
      stopClock();
      var a = r[1], lines = a.thread.slice();
      if (a.offline) lines.unshift(a.offline === 'no-api' || a.offline === 'down' ? 'the shopping helper is offline, so this is a saved answer (wireless headphones under $150), not your search' : 'grok could not answer (' + a.offline.toLowerCase() + '), so this is a saved answer for headphones');
      else if (a.engine === 'fixture') lines.unshift('saved answer (fixture), no live model call');
      steps.innerHTML = '';
      for (var i = 0; i < lines.length; i++) {
        $$('.s.run', steps).forEach(function (s) { s.classList.remove('run'); });
        steps.insertAdjacentHTML('beforeend', '<div class="s' + (i === lines.length - 1 ? '' : ' run') + (a.offline && i === 0 ? ' bad' : '') + '">' + esc(lines[i]) + '</div>');
        await sleep(450);
      }
      $$('.s.run', steps).forEach(function (s) { s.classList.remove('run'); });
      var picks = a.picks.filter(function (p) { return get(p.id); });
      if (!picks.length) { th.insertAdjacentHTML('beforeend', msgBot('<p>' + esc(a.note || 'nothing fits yet.') + '</p><p class="mute">want grok to keep watching? <button class="pill grey sm" type="button" id="watchIt">Make it a mission</button></p>')); $('#watchIt').addEventListener('click', function () { newMission(q); }); return; }
      th.insertAdjacentHTML('beforeend', msgBot('<p>' + picks.length + (picks.length === 1 ? ' pick' : ' picks') + '. ' + esc(get(picks[0].id).title.toLowerCase()) + ' is mine.</p><div class="cards' + (picks.length > 2 ? ' three' : '') + '">' + picks.map(function (p, i) { return card(get(p.id), { pick: i === 0, rank: i + 1, why: p.why }); }).join('') + '</div>'));
      await sleep(400);
      if (a.compare && a.compare.length) th.insertAdjacentHTML('beforeend', msgBot('<p>side by side:</p>' + compareTable(a.compare)));
      await sleep(300);
      th.insertAdjacentHTML('beforeend', msgBot('<p>' + esc(a.note || 'ready when you are.') + '</p><div class="chips" style="margin-top:10px"><button class="pill white sm" type="button" id="addAll">Add all to cart</button><button class="pill grey sm" type="button" id="addPick">Only the pick</button><button class="pill line sm" type="button" id="watchIt">Keep watching</button></div>' +
        '<p class="mute" style="margin-top:8px;font-size:12px">' + esc(a.engine === 'fixture' || a.offline ? 'saved answer' : 'answered by ' + a.engine + (a.cached ? ' · from the last 12 h' : '')) + '</p>'));
      $('#addAll').addEventListener('click', function () { picks.forEach(function (p) { addToCart(p.id, true); }); G.toast('Cart built: ' + picks.length + ' items'); setTimeout(function () { location.href = 'cart.html'; }, 600); });
      $('#addPick').addEventListener('click', function () { addToCart(picks[0].id, true); G.toast('Added the pick'); setTimeout(function () { location.href = 'cart.html'; }, 600); });
      $('#watchIt').addEventListener('click', function () { newMission(q); });
    }).catch(function (e) {
      console.warn(e); stopClock();
      steps.innerHTML = '<div class="s bad">the store did not load. refresh to try again.</div>';
    });
  };

  // MISSIONS: the app window, sidebar list only + New mission sheet
  PAGES.missions = function () {
    seedMissions();
    var draw = function () {
      var ms = missions();
      $('#mlist').innerHTML = ms.length ? ms.map(function (m, i) {
        var best = m.bestId && get(m.bestId);
        return '<div class="bot mission" style="max-width:none;width:100%;border-bottom:1px solid var(--line);border-radius:0;padding:14px 4px">' + avatar(m.name, i + 1, 'lg') +
          '<div class="who"><div class="row1"><span style="font-size:15px">' + esc(m.name) + (m.example ? ' <span class="tag">example</span>' : '') + (fresh(m) ? ' <span class="tag warn">' + esc(/^price drop/.test(m.change || '') ? m.change : 'new find') + '</span>' : '') + '</span><span class="time">' + ago(m.checked || m.at) + '</span></div>' +
          '<div class="rep" style="white-space:normal">' + esc(m.report || '') + '</div><div class="mute" style="font-size:12px;margin-top:2px">' + esc(m.what) + (m.budget ? ' · budget $' + m.budget : '') + (m.by ? ' · by ' + esc(m.by) : '') + ' · ' + esc(m.every) + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">' + statusTag(m.status) + '<a class="pill grey sm" href="results.html?q=' + encodeURIComponent(m.what) + '&m=' + m.id + '">Open thread</a>' + (best ? '<a class="pill line sm" href="product.html?id=' + best.id + '">Best so far</a>' : '') +
          '<button class="pill line sm" type="button" data-done="' + m.id + '">' + (m.status === 'done' ? 'Remove' : 'Mark done') + '</button></div></div></div>';
      }).join('') : '<div class="empty">No missions yet. Give Grok one.</div>';
    };
    var seenT;
    var run = function () {
      draw();
      return catalogue().then(function (list) {
        return watchAll(list).then(function (st) {
          var news = missions().filter(fresh).length;
          $('#mIntro').textContent = (st.live ? 'Grok re-checks every mission on its own, every hour, even when this page is closed.' : 'Grok checks every mission when you open this page.') +
            (news ? ' ' + news + (news === 1 ? ' mission has' : ' missions have') + ' news since your last visit.' : ' Nothing new since your last visit.');
          draw();
          // what changed stays marked for this visit; next visit only shows newer changes
          clearTimeout(seenT); seenT = setTimeout(function () { var ms = missions(), t = Date.now(); ms.forEach(function (m) { m.seenAt = t; }); saveMissions(ms, true); }, 1500);
        });
      }).catch(function () { G.toast('The store did not load'); });
    };
    $('#mlist').addEventListener('click', function (e) {
      var b = e.target.closest('[data-done]'); if (!b) return;
      var ms = missions(), m = ms.filter(function (x) { return x.id === b.getAttribute('data-done'); })[0]; if (!m) return;
      if (m.status === 'done') ms = ms.filter(function (x) { return x !== m; }); else { m.status = 'done'; m.report = 'done. ' + (m.report || ''); }
      saveMissions(ms); draw();
    });
    $$('[data-newmission]').forEach(function (b) { b.addEventListener('click', function () { newMission(); }); });
    document.addEventListener('gz:missions', run);
    if (new URLSearchParams(location.search).get('new') === '1') newMission();
    run();
  };

  // SELL: how a store joins + the request form (store address only; never a password, key or token)
  PAGES.sell = function () {
    catalogue().then(function () {
      var p = get(107);
      $('#sellCard').innerHTML = p ? '<div class="thread" style="padding:0">' + msgUser('wireless earphones under $60, here this week') +
        msgBot('<p>' + esc(p.title.toLowerCase()) + ' from ' + esc(merchant(p).toLowerCase()) + ' is the pick.</p><div class="cards">' + card(p, { pick: true, why: 'ships in 1-2 business days, 4.24 rating, 7 days returns', acts: false }) + '</div>' +
        '<div class="chips" style="margin-top:10px"><span class="pill white sm">Checkout at ' + esc(merchant(p)) + ' ↗</span></div>') + '</div>' +
        '' : '';
    }).catch(function () { $('#sellCard').innerHTML = '<div class="empty">The store did not load.</div>'; });
    var f = $('#applyForm'), err = $('#applyErr'), go = $('#applyGo');
    if (!API) { $('#applyNote').textContent = 'Requests open as soon as the Grokazon helper is online.'; go.disabled = true; go.textContent = 'Opening soon'; }
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var body = { store: f.store.value.trim(), x: f.x.value.trim(), products: f.products.value, note: f.note.value.trim() };
      if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(body.store)) { err.textContent = 'Enter your store address, like yourstore.myshopify.com.'; f.store.focus(); return; }
      go.disabled = true; go.textContent = 'Sending…';
      timed(API + '/merchants/apply', 10000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'The request did not go through.'); return j; }); })
        .then(function (j) {
          f.hidden = true;
          $('#applyDone').hidden = false;
          $('#applyDone').innerHTML = '<div class="thread" style="padding:0">' + msgBot('<p>got it. ' + esc(j.store) + ' is on the list. requests are read by hand while grokazon is a concept' + (body.x ? ', and the reply comes on X to @' + esc(body.x.replace(/^@/, '')) : '') + '.</p>') + '</div>';
        })
        .catch(function (e2) { err.textContent = /Failed to fetch|abort/i.test(e2.message || '') ? 'Could not reach Grokazon. Try again in a minute.' : e2.message; go.disabled = false; go.textContent = 'Send request'; });
    });
  };

  window.GZA = { catalogue: catalogue, get: get, card: card, addToCart: addToCart, missions: missions, cart: cart, saveCart: saveCart, money: money, was: was, stars: stars, starsTxt: starsTxt, xBadge: xBadge, eta: eta, fast: fast,
    merchant: merchant, isShop: isShop, shopTag: shopTag, stockTag: stockTag, grokAv: grokAv, avatar: avatar, msgBot: msgBot, msgUser: msgUser, fillTiers: fillTiers, timed: timed, API: API, OWNER_Q: OWNER_Q, exampleChips: exampleChips, newMission: newMission };
  var page = document.body.getAttribute('data-page');
  if (PAGES[page]) PAGES[page]();
})();
