/* GROKSHOP store pages (Amazon's structure, Grok inside): home, search, product, cart, order, orders, seller, admin.
   Uses the shared helpers from common.js (window.GZ) and app.js (window.GZA). body[data-page] picks the page. */
(function () {
  'use strict';
  var G = window.GZ, A = window.GZA, C = G.C, $ = G.$, $$ = G.$$, esc = G.esc, API = A.API;
  var money = A.money, get = A.get;
  var DNAME = {}; G.DEPTS.forEach(function (d) { DNAME[d[0]] = d[1]; }); DNAME.other = 'More';

  /* ---------- shared pieces ---------- */
  function sellerOf(p) { return A.merchant(p); }
  // the delivery line under every price: X fast (free with any X plan) or the seller's own promise
  function deliv(p) {
    if (A.fast(p)) {
      var d = A.eta(p);
      return G.premium() ? '<b>FREE X fast delivery</b> ' + esc(d) : 'X fast delivery ' + esc(d) + ' <span class="mute">free with X Premium</span>';
    }
    return esc(p.shippingInformation || 'Delivery set by the seller at checkout');
  }
  // full photographs (Shopify stores, sellers' own shots) fill their tile edge to edge; catalogue cut-outs sit on a light tile
  function photo(p) { return p.source === 'shopify' || p.source === 'seller'; }
  function tile(p, o) {
    o = o || {}; var off = p.discountPercentage >= 5 ? Math.round(p.discountPercentage) : 0, w = A.was(p);
    return '<article class="tile">' + (off ? '<span class="off">-' + off + '%</span>' : '') +
      '<a class="ph' + (photo(p) ? ' cover' : '') + '" href="product.html?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(p.thumbnail) + '" alt="' + esc(p.title) + '" loading="lazy" width="300" height="300"></a>' +
      '<div class="bd"><a class="ti" href="product.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.title) + '</a><span class="seller">' + esc(sellerOf(p)) + '</span>' + A.stars(p) +
      '<div class="price">' + money(p.price) + (w ? '<small>' + money(w) + '</small>' : '') + '</div><div class="dl">' + deliv(p) + '</div>' +
      '<div class="tags">' + A.shopTag(p) + (p.source === 'seller' ? '<span class="tag">Grokshop seller</span>' : '') + '</div>' +
      (o.add === false ? '' : '<div class="add"><button class="pill white sm" type="button" data-add="' + esc(p.id) + '">Add to cart</button></div>') + '</div></article>';
  }
  function words(s) { return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(function (w) { return w.length > 1 && !/^(the|and|for|with|me|my|find|best|under|below|a|an|of|to|in|on|this|that|please|delivered|week|buy|get|some|cheap|good)$/.test(w); }); }
  // what people type -> words the products use (counted at a lower weight than the shopper's own words)
  var SYN = { headphones: ['earphones', 'earbuds', 'airpods', 'headphone'], headphone: ['earphones', 'earbuds', 'airpods'], earbuds: ['earphones', 'airpods'], earphones: ['earbuds', 'airpods'], phone: ['smartphones', 'iphone'], laptop: ['laptops', 'notebook'], perfume: ['fragrances', 'eau'], sofa: ['sofas', 'couch'], couch: ['sofa'], desk: ['desks'], coffee: ['espresso', 'beans'], speaker: ['speakers', 'homepod'] };
  function budgetOf(q) { var m = String(q || '').toLowerCase().match(/(?:under|below|less than|max|up to)\s*\$?\s*(\d[\d,]*)/) || String(q || '').match(/\$\s*(\d[\d,]*)/); return m ? +m[1].replace(/,/g, '') : 0; }
  // store search: words in the title count most, then category/tags/seller, then the description
  function score(p, ws) {
    if (!ws.length) return 1;
    var t = p.title.toLowerCase(), c = (p.category + ' ' + (p.tags || []).join(' ') + ' ' + p.brand + ' ' + sellerOf(p)).toLowerCase(), d = (p.description || '').toLowerCase(), s = 0;
    ws.forEach(function (w) {
      var st = w.replace(/s$/, ''); if (t.indexOf(st) >= 0) s += 3; if (c.indexOf(st) >= 0) s += 2; if (d.indexOf(st) >= 0) s += 1;
      (SYN[w] || []).forEach(function (y) { var sy = y.replace(/s$/, ''); if (t.indexOf(sy) >= 0) s += 2; else if (c.indexOf(sy) >= 0) s += 1; });
    });
    return s;
  }
  function loading(el) { el.innerHTML = '<div class="empty">Loading the store…</div>'; }
  function apiDown(el, what) { el.innerHTML = '<div class="empty">' + esc(what) + ' needs the Grokshop server, which did not answer. Refresh to try again.</div>'; }
  function health() { return API ? A.timed(API + '/health', 8000).then(function (r) { return r.json(); }).catch(function () { return {}; }) : Promise.resolve({}); }
  function post(path, body) {
    return A.timed(API + path, 30000, { method: 'POST', headers: G.authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
  }
  function getJ(path) { return A.timed(API + path, 20000, { headers: G.authHeaders() }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); }); }
  document.addEventListener('gz:premium', function () { $$('[data-redraw]').forEach(function (el) { el.dispatchEvent(new CustomEvent('redraw')); }); });

  var PAGES = {};

  /* ---------- STORE HOME ---------- */
  PAGES.store = function () {
    $('#heroForm').addEventListener('submit', function (e) { e.preventDefault(); location.href = 'results.html?q=' + encodeURIComponent($('#q').value.trim() || A.OWNER_Q); });
    $('#heroChips').innerHTML = A.exampleChips().map(function (t) { return '<a class="chip" href="results.html?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('');
    if (C.ART && C.ART.glyph) $('#glyph').innerHTML = '<img src="' + esc(C.ART.glyph) + '" alt="">';
    var qs = $('#quoteSrc'); if (qs) qs.href = C.ARTICLE;
    A.fillTiers();
    $$('[data-signin]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); G.signIn(); }); });
    $$('[data-top]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { $('#q').focus(); }, 350); }); });
    var body = $('#rows'); body.setAttribute('data-redraw', '');
    var draw = function (list) {
      var withImg = list.filter(function (p) { return p.thumbnail && p.price < 5000; });
      var top = function (arr, n) { return arr.slice(0, n); };
      var byRating = function (a, b) { return (b.rating || 0) - (a.rating || 0); };
      // banner photos: the three deepest real discounts
      var deals = withImg.filter(function (p) { return p.discountPercentage >= 10; }).sort(function (a, b) { return b.discountPercentage - a.discountPercentage; });
      $('#shots').innerHTML = top(deals, 3).map(function (p) { return '<a href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="' + esc(p.title) + '"><img src="' + esc(p.images[0] || p.thumbnail) + '" alt=""></a>'; }).join('');
      $('#dcards').innerHTML = ['electronics', 'home', 'grocery', 'fashion'].map(function (d) {
        var ps = withImg.filter(function (p) { return p.dept === d; }).sort(byRating).slice(0, 4);
        return '<div class="dcard"><h3>' + esc(DNAME[d]) + '</h3><div class="q4">' + ps.map(function (p) { return '<a' + (photo(p) ? ' class="cover"' : '') + ' href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="' + esc(p.title) + '"><img src="' + esc(p.thumbnail) + '" alt="" loading="lazy"></a>'; }).join('') + '</div><a class="more" href="search.html?dept=' + d + '">See more in ' + esc(DNAME[d]) + '</a></div>';
      }).join('');
      var rails = [
        ['Today\u2019s deals', 'Real discounts from the sellers\u2019 own prices.', 'search.html?deals=1', top(deals, 12)],
        ['X fast delivery, top rated', 'Arrives within a working week, free with any X plan.', 'search.html?fast=1&sort=rating', top(withImg.filter(function (p) { return A.fast(p) && p.rating >= 4.3; }).sort(byRating), 12)],
        ['From independent stores', 'Shopify stores and Grokshop sellers.', 'search.html?indie=1', top(withImg.filter(function (p) { return p.source === 'shopify' || p.source === 'seller'; }).sort(function (a, b) { return (a.source === 'seller' ? -1 : 0) - (b.source === 'seller' ? -1 : 0); }), 12)],
        ['Beauty and fragrance', '', 'search.html?dept=beauty', top(withImg.filter(function (p) { return p.dept === 'beauty'; }).sort(byRating), 12)]
      ];
      body.innerHTML = rails.map(function (r) { return r[3].length ? '<section class="row"><div class="rh"><div><h2>' + esc(r[0]) + '</h2>' + (r[1] ? '<p>' + esc(r[1]) + '</p>' : '') + '</div><a href="' + r[2] + '">See all</a></div><div class="rail">' + r[3].map(function (p) { return tile(p); }).join('') + '</div></section>' : ''; }).join('');
    };
    loading(body);
    A.catalogue().then(function (list) { draw(list); body.addEventListener('redraw', function () { draw(list); }); }).catch(function () { body.innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>'; });
  };

  /* ---------- SEARCH / DEPARTMENT ---------- */
  PAGES.search = function () {
    var P = new URLSearchParams(location.search), q = (P.get('q') || '').trim();
    var st = { dept: P.get('dept') || '', deals: P.get('deals') === '1', fast: P.get('fast') === '1', indie: P.get('indie') === '1', r4: P.get('r4') === '1', max: +(P.get('max') || budgetOf(q) || 0), sort: P.get('sort') || 'featured' };
    var box = $('#grid'); box.setAttribute('data-redraw', ''); loading(box);
    var nlq = q && (q.split(/\s+/).length >= 4 || /\$|under|by |this week|best/i.test(q));
    $('#grokstrip').innerHTML = q ? A.grokAv() + '<p>' + (nlq ? '<b>Grok can shop this for you.</b> It reads your budget and deadline, compares price, delivery and seller trust, and builds the cart.' : '<b>Not sure which one?</b> Grok compares them for you and says why.') + '</p><a class="pill white sm" href="results.html?q=' + encodeURIComponent(q) + '">Ask Grok to pick</a>' : A.grokAv() + '<p><b>Tell Grok what you need</b> and it shops every store here for you.</p><a class="pill white sm" href="results.html">Ask Grok</a>';
    A.catalogue().then(function (list) {
      var draw = function () {
        var ws = words(q).filter(function (w) { return !/^\d+$/.test(w); });
        var rows = list.map(function (p) { return { p: p, s: score(p, ws) }; }).filter(function (x) {
          var p = x.p;
          return (!ws.length || x.s >= 2) && (!st.dept || p.dept === st.dept) && (!st.deals || p.discountPercentage >= 10) && (!st.fast || A.fast(p)) && (!st.indie || p.source === 'shopify' || p.source === 'seller') && (!st.r4 || (p.rating || 0) >= 4) && (!st.max || p.price <= st.max);
        });
        var sorts = { featured: function (a, b) { return b.s - a.s || (b.p.rating || 0) - (a.p.rating || 0); }, low: function (a, b) { return a.p.price - b.p.price; }, high: function (a, b) { return b.p.price - a.p.price; }, rating: function (a, b) { return (b.p.rating || 0) - (a.p.rating || 0); }, deal: function (a, b) { return b.p.discountPercentage - a.p.discountPercentage; } };
        rows.sort(sorts[st.sort] || sorts.featured);
        var title = q ? '\u201c' + esc(q) + '\u201d' : st.deals ? 'Today\u2019s deals' : st.dept ? esc(DNAME[st.dept] || st.dept) : st.indie ? 'Independent stores' : 'All products';
        $('#sbar').innerHTML = '<span><b>' + rows.length + '</b> results for <b>' + title + '</b>' + (st.max ? ' under <b>' + money(st.max) + '</b>' : '') + '</span>' +
          '<label>Sort <select id="sort"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="rating">Customer rating</option><option value="deal">Biggest discount</option></select></label>';
        $('#sort').value = st.sort; $('#sort').addEventListener('change', function () { st.sort = this.value; draw(); });
        var chip = function (on, label, act) { return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-f="' + act + '">' + label + '</button>'; };
        $('#filters').innerHTML = '<h4>Department</h4>' + chip(!st.dept, 'All', 'dept:') + G.DEPTS.map(function (d) { return chip(st.dept === d[0], esc(d[1]), 'dept:' + d[0]); }).join('') +
          '<h4>Delivery</h4>' + chip(st.fast, 'X fast delivery', 'fast') + '<h4>Price</h4>' + [25, 50, 100, 250].map(function (m) { return chip(st.max === m, 'Under $' + m, 'max:' + m); }).join('') + chip(!st.max, 'Any price', 'max:0') +
          '<h4>More</h4>' + chip(st.deals, 'Deals', 'deals') + chip(st.r4, '4\u2605 & up', 'r4') + chip(st.indie, 'Independent stores', 'indie');
        box.innerHTML = rows.length ? rows.slice(0, 120).map(function (x) { return tile(x.p); }).join('') : '<div class="empty" style="grid-column:1/-1">Nothing matches yet. Try other words, or <a href="missions.html?new=1" style="color:var(--accent)">give Grok a mission</a> to keep watching.</div>';
        var u = new URLSearchParams(); if (q) u.set('q', q); ['dept', 'sort'].forEach(function (k) { if (st[k] && !(k === 'sort' && st[k] === 'featured')) u.set(k, st[k]); }); ['deals', 'fast', 'indie', 'r4'].forEach(function (k) { if (st[k]) u.set(k, '1'); }); if (st.max && st.max !== budgetOf(q)) u.set('max', st.max);
        history.replaceState(null, '', 'search.html' + (u.toString() ? '?' + u : ''));
      };
      $('#filters').addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]'); if (!b) return; var f = b.getAttribute('data-f');
        if (/^dept:/.test(f)) st.dept = f.slice(5); else if (/^max:/.test(f)) st.max = +f.slice(4); else st[f] = !st[f];
        draw();
      });
      box.addEventListener('redraw', draw); draw();
      if (q) ebaySection(q);
    }).catch(function () { box.innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>'; });
  };
  // eBay results: their own section, in eBay's order (eBay's rule), seller + feedback shown, shipping separate
  function rememberEbay(items) { var m = G.store('gz.ebay') || {}; items.forEach(function (p) { m[p.id] = p; }); var keys = Object.keys(m); if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(function (k) { delete m[k]; }); G.store('gz.ebay', m); }
  function ebayTile(p) {
    return '<article class="tile ebay"><a class="ph cover" href="product.html?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(p.thumbnail) + '" alt="' + esc(p.title) + '" title="' + esc(p.title) + '" loading="lazy" width="300" height="300"></a>' +
      '<div class="bd"><span class="tag ebaytag">eBay</span><a class="ti" href="product.html?id=' + encodeURIComponent(p.id) + '" title="' + esc(p.title) + '">' + esc(p.title) + '</a>' +
      '<span class="seller">' + esc(p.ebay.seller) + (p.ebay.feedbackPct ? ' · ' + esc(p.ebay.feedbackPct) + '% positive' : '') + (p.ebay.feedbackScore ? ' (' + esc(p.ebay.feedbackScore) + ')' : '') + '</span>' +
      '<div class="price">' + money(p.price) + '</div><div class="dl">' + esc(p.shippingInformation) + '</div>' + (p.condition ? '<div class="dl mute">' + esc(p.condition) + '</div>' : '') + '</div></article>';
  }
  function ebaySection(q) {
    if (!API) return;
    getJ('/ebay/search?q=' + encodeURIComponent(q)).then(function (j) {
      if (j.mode === 'off' || !j.items.length) return;
      rememberEbay(j.items);
      var host = $('#ebayRow'); if (!host) { host = document.createElement('section'); host.id = 'ebayRow'; host.className = 'row'; $('#grid').insertAdjacentElement('afterend', host); }
      host.innerHTML = '<div class="rh"><div><h2>From eBay</h2><p>In eBay\u2019s own order' + (j.mode === 'sandbox' ? ' · eBay test listings (sandbox)' : '') + '. Sold by eBay sellers.</p></div><a href="https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259" target="_blank" rel="noopener">eBay User Agreement</a></div><div class="grid">' + j.items.map(ebayTile).join('') + '</div>';
    }).catch(function () { });
  }

  /* ---------- PRODUCT ---------- */
  PAGES.product = function () {
    var id = new URLSearchParams(location.search).get('id') || '', box = $('#pdp'); loading(box);
    var live = /^e-/.test(id) && API ? getJ('/ebay/item?id=' + encodeURIComponent(id)).then(function (j) { if (j.item) rememberEbay([j.item]); }).catch(function () { }) : Promise.resolve();
    Promise.all([A.catalogue(), live]).then(function () {
      var p = get(id);
      if (!p) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">This product is not in the store. <a href="search.html" style="color:var(--accent)">Search the store</a> or <a href="results.html" style="color:var(--accent)">ask Grok</a>.</div>'; return; }
      document.title = p.title + ' · Grokshop';
      var w = A.was(p), m = sellerOf(p), out = !/in stock/i.test(p.availabilityStatus || '') || p.stock === 0;
      var bullets = String(p.description || '').split(/(?<=[.!?])\s+/).filter(function (x) { return x.length > 12; }).slice(0, 5);
      var draw = function () {
        box.innerHTML = '<div class="crumbs"><a href="search.html?dept=' + esc(p.dept) + '">' + esc(DNAME[p.dept] || 'Store') + '</a> › ' + esc(p.category.replace(/-/g, ' ')) + '</div>' +
          '<div class="gal"><div class="main"><img id="mainImg" src="' + esc(p.images[0] || p.thumbnail) + '" alt="' + esc(p.title) + '" width="600" height="600"></div>' +
          (p.images.length > 1 ? '<div class="thumbs">' + p.images.map(function (src, i) { return '<button type="button" class="' + (i ? '' : 'on') + '" data-src="' + esc(src) + '" aria-label="Photo ' + (i + 1) + '"><img src="' + esc(src) + '" alt="" loading="lazy"></button>'; }).join('') + '</div>' : '') + '</div>' +
          '<div class="facts"><h1>' + esc(p.title) + '</h1>' + (p.source === 'ebay' ? '<div class="by"><span class="tag ebaytag">eBay</span> Sold by <b>' + esc(p.ebay.seller) + '</b> on eBay' + (p.ebay.feedbackPct ? ' · ' + esc(p.ebay.feedbackPct) + '% positive feedback' : '') + (p.ebay.feedbackScore ? ' (' + esc(p.ebay.feedbackScore) + ')' : '') + (p.condition ? ' · ' + esc(p.condition) : '') + '</div>' : '<div class="by">Sold by <a href="search.html?q=' + encodeURIComponent(m.replace(/ store$/, '')) + '">' + esc(m) + '</a></div>' + A.stars(p)) +
          '<div class="badges" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' + A.xBadge(p) + A.shopTag(p) + (p.source === 'seller' ? '<span class="tag">Grokshop seller</span>' : '') + '</div><hr>' +
          '<div class="price" style="font-size:28px">' + money(p.price) + (w ? '<small>' + money(w) + '</small>' : '') + '</div>' + (p.discountPercentage >= 5 ? '<div class="mute" style="font-size:13px">' + Math.round(p.discountPercentage) + '% off the seller\u2019s list price</div>' : '') + '<hr>' +
          '<h3 style="font-size:16px;margin-bottom:8px">About this item</h3>' + (bullets.length ? '<ul class="bullets">' + bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : '<p class="mute">' + esc(p.description || '') + '</p>') +
          '<div class="askg">' + A.grokAv('sm') + ' <b style="font-weight:500">Ask Grok about this</b><span class="mute" style="font-size:13px"> · compares it with everything else in the store</span><form class="ask" id="askAbout"><input id="aq" placeholder="is there something better for less?" aria-label="Ask Grok about this" maxlength="200"><button class="go" type="submit" aria-label="Ask Grok">↑</button></form></div>' +
          (p.reviews.length ? '<div class="revs"><b style="font-weight:500">Customer reviews</b>' + p.reviews.map(function (r) { return '<div class="r"><span class="stars"><span class="s5">' + A.starsTxt(r.rating) + '</span></span> ' + (r.verified ? '<span class="tag ok">Verified purchase' + (r.test ? ' · test order' : '') + '</span> ' : '') + esc(r.comment) + '<br><small>' + esc(r.reviewerName) + ' · ' + esc(String(r.date).slice(0, 10)) + '</small></div>'; }).join('') + '</div>' : '') + '</div>' +
          '<aside class="buy"><div class="buy-ti">' + esc(p.title) + '</div><div class="price">' + money(p.price) + '</div><div class="dl">' + deliv(p) + '</div>' +
          '<button class="linkb" type="button" data-where-set style="text-align:left">Deliver to ' + esc(G.whereLabel()) + ' \u203a</button>' +
          '<div class="instock' + (out ? ' out' : '') + '">' + esc(out ? 'Out of stock' : (p.stock != null && p.stock < 10 ? 'Only ' + p.stock + ' left in stock' : 'In Stock')) + '</div>' +
          (out ? '' : '<label class="mute" style="font-size:13px">Quantity <select id="qty">' + [1, 2, 3, 4, 5].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label>' +
            '<button class="pill white block" type="button" id="addc">Add to cart</button><button class="pill grey block" type="button" id="buyn" style="background:var(--accent);color:#000">Buy now</button>') +
          (p.source === 'ebay' && p.ebay.url ? '<a class="pill line block" href="' + esc(p.ebay.url) + '" target="_blank" rel="noopener">See this item on eBay \u2197</a>' : '') +
          '<dl><dt>Ships from</dt><dd>' + esc(m) + '</dd><dt>Sold by</dt><dd>' + esc(m) + '</dd><dt>Returns</dt><dd>' + esc(p.returnPolicy || 'Set by the seller') + '</dd>' + (p.warrantyInformation ? '<dt>Warranty</dt><dd>' + esc(p.warrantyInformation) + '</dd>' : '') + '</dl>' +
          (p.ref && /^https:\/\//.test(p.ref.url) ? '<div class="refl"><span class="mute">' + (p.ref.match === 'same' ? 'Same product elsewhere' : 'Real-world reference') + '</span><a href="' + esc(p.ref.url) + '" target="_blank" rel="noopener nofollow">' + esc(p.ref.name) + ' at ' + esc(p.ref.retailer) + ' ↗</a>' + (p.ref.price ? '<small>' + money(p.ref.price) + ' there' + (p.ref.checked ? ', checked ' + esc(p.ref.checked) : '') + '</small>' : '') + '</div>' : '') +
          '<div class="secure">Secure checkout on Grokshop: card details are typed on the payment provider\u2019s page, never stored here.</div></aside>';
        $$('.thumbs button', box).forEach(function (b) { b.addEventListener('click', function () { $('#mainImg').src = b.getAttribute('data-src'); $$('.thumbs button', box).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
        $('#askAbout').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#aq').value.trim() || 'is there something better for less?'; location.href = 'results.html?q=' + encodeURIComponent(v + ' (about the ' + p.title + ')'); });
        $('[data-where-set]', box).addEventListener('click', G.whereSheet);
        var addN = function () { var n = +($('#qty') || { value: 1 }).value; for (var i = 0; i < n; i++) A.addToCart(p.id, true); };
        if (!out) {
          $('#addc').addEventListener('click', function () { addN(); G.toast('Added to cart: ' + p.title); });
          $('#buyn').addEventListener('click', function () { addN(); location.href = 'checkout.html'; });
        }
      };
      box.setAttribute('data-redraw', ''); box.addEventListener('redraw', draw); draw();
      document.addEventListener('gz:where', draw);
    }).catch(function () { box.innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>'; });
  };

  /* ---------- CART: one cart, one checkout ---------- */
  PAGES.cart = function () {
    var list = $('#clist'), sum = $('#csum'); loading(list);
    var payMode = 'off';
    var draw = function () {
      var items = A.cart().map(function (x) { return { p: get(x.id), qty: x.qty || 1 }; }).filter(function (x) { return x.p; });
      if (!items.length) { list.innerHTML = '<h1>Your cart is empty</h1><p class="mute">Search the store, or tell Grok what you need and it builds the cart.</p><div class="chips" style="margin-top:12px"><a class="pill white sm" href="results.html">Ask Grok</a><a class="pill grey sm" href="search.html?deals=1">Today\u2019s deals</a></div>'; sum.innerHTML = ''; return; }
      var n = items.reduce(function (s, x) { return s + x.qty; }, 0), total = items.reduce(function (s, x) { return s + x.p.price * x.qty; }, 0);
      list.innerHTML = '<h1>Shopping cart</h1><p class="mute" style="font-size:13px;margin:0 0 6px">' + (function (k) { return k + (k === 1 ? ' seller' : ' sellers'); })(new Set(items.map(function (x) { return sellerOf(x.p); })).size) + ', one checkout.</p>' + items.map(function (x) {
        var p = x.p;
        return '<div class="citem2"><a class="ph" href="product.html?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(p.thumbnail) + '" alt="" loading="lazy"></a><div><a class="ti" href="product.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.title) + '</a>' +
          '<div class="meta">Sold by ' + esc(sellerOf(p)) + ' · ' + deliv(p) + '</div><div class="row2"><div class="qty"><button type="button" data-q="' + esc(p.id) + '" data-d="-1" aria-label="One less">−</button><span>' + x.qty + '</span><button type="button" data-q="' + esc(p.id) + '" data-d="1" aria-label="One more">+</button></div>' +
          '<button class="linkb" type="button" data-del="' + esc(p.id) + '">Delete</button><span class="lp">' + money(p.price * x.qty) + '</span></div></div></div>';
      }).join('');
      var fastN = items.filter(function (x) { return A.fast(x.p); }).length, me = G.me();
      var qt = lastQuote, lines = qt ? '<dl class="qt"><dt>Items</dt><dd>' + money(qt.items) + '</dd>' + qt.groups.map(function (g) { return '<dt>Shipping · ' + esc(g.seller) + '</dt><dd title="' + esc(g.why) + '">' + (g.shipping ? money(g.shipping) : '<b class="free">FREE</b>') + '</dd>'; }).join('') +
        (payMode !== 'off' && taxOn ? '<dt>Estimated tax</dt><dd>calculated at payment</dd>' : '') + '</dl><div class="tot">Order total: <b>' + money(qt.total) + '</b></div>' : '<div class="tot">Subtotal (' + n + (n === 1 ? ' item' : ' items') + '): <b>' + money(total) + '</b></div>';
      sum.innerHTML = lines + '<div class="mute" style="font-size:12px">Shipping: free over $35 per seller, free X fast delivery with an X plan, otherwise $4.99 per seller.</div>' +
        (fastN ? '<div class="mute" style="font-size:13px">' + (me && me.fast ? fastN + ' item' + (fastN === 1 ? '' : 's') + ' with free X fast delivery (' + esc(me.planName) + ').' : fastN + (fastN === 1 ? ' item qualifies' : ' items qualify') + ' for X fast delivery, free with any X plan. <button class="linkb" type="button" data-signin>Sign in with <span class=\"xlogo\" role=\"img\" aria-label=\"X\"></span></button>') + '</div>' : '') +
        '<div class="mute" style="font-size:13px">Deliver to <button class="linkb" type="button" data-where-set>' + esc(G.whereLabel()) + (G.where().cc ? ', ' + esc(G.regionName(G.where().cc)) : '') + ' \u203a</button></div>' +
        '<button class="pill white block" type="button" id="checkout">Proceed to checkout</button>' +
        (payMode === 'off' ? '<div class="paynote">Preview checkout: no payment is taken and nothing ships.</div>' : payMode === 'test' ? '<div class="paynote">Preview payments: pay with card <b class="mono">4242 4242 4242 4242</b>, any future date, any CVC. You won\u2019t be charged.</div>' : '') +
        '<div class="mute" style="font-size:12px">Card and address are entered on the payment provider\u2019s secure page, not on Grokshop.</div>';
      $('[data-signin]', sum) && $('[data-signin]', sum).addEventListener('click', G.signIn);
      $('#checkout').addEventListener('click', go); $('[data-where-set]', sum).addEventListener('click', G.whereSheet);
    };
    var lastQuote = null, taxOn = false, qT;
    // the server prices shipping with the same rule checkout uses
    var requote = function () {
      clearTimeout(qT); qT = setTimeout(function () {
        if (!API || !A.cart().length) { lastQuote = null; return; }
        post('/orders/quote', { lines: A.cart().map(function (x) { return { id: x.id, qty: x.qty || 1 }; }) }).then(function (q) { lastQuote = q; draw(); }).catch(function () { });
      }, 80);
    };
    var go = function () {
      if (!API) { G.toast('Checkout needs the Grokshop server.'); return; }
      location.href = 'checkout.html'; return;
      var b = $('#checkout'); b.disabled = true; b.textContent = 'Starting checkout…';
      var w = G.where();
      post('/orders/checkout', { lines: A.cart().map(function (x) { return { id: x.id, qty: x.qty || 1 }; }), xfast: G.premium(), where: { city: w.city || '', zip: w.zip || '', cc: w.cc || '' } }).then(function (j) {
        if (j.mode === 'test') A.saveCart([]);
        location.href = j.url;
      }).catch(function (e) { G.toast(e.message); b.disabled = false; b.textContent = 'Proceed to checkout'; });
    };
    list.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]'), q = e.target.closest('[data-q]'), c = A.cart();
      if (d) { A.saveCart(c.filter(function (x) { return String(x.id) !== d.getAttribute('data-del'); })); draw(); }
      if (q) { c.forEach(function (x) { if (String(x.id) === q.getAttribute('data-q')) x.qty = Math.min(9, (x.qty || 1) + +q.getAttribute('data-d')); }); A.saveCart(c.filter(function (x) { return x.qty > 0; })); draw(); }
    });
    list.setAttribute('data-redraw', ''); list.addEventListener('redraw', function () { draw(); requote(); }); document.addEventListener('gz:where', draw);
    list.addEventListener('click', function (e) { if (e.target.closest('[data-del],[data-q]')) requote(); });
    Promise.all([A.catalogue(), health()]).then(function (r) { payMode = r[1].payments || 'off'; taxOn = !!r[1].tax; draw(); requote(); if (new URLSearchParams(location.search).get('go') === '1' && A.cart().length) { history.replaceState(null, '', 'cart.html'); } })
      .catch(function () { list.innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>'; });
  };


  /* ---------- CHECKOUT: shipping address, delivery, payment, review -> place your order ---------- */
  var KCC = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'SG', 'MY', 'JP', 'DE', 'FR', 'NL'];
  PAGES.checkout = function () {
    var main = $('#kmain'), sum = $('#ksum'); loading(main);
    var payMode = 'off', taxOn = false, quote = null, placing = false;
    var items = function () { return A.cart().map(function (x) { return { p: get(x.id), qty: x.qty || 1 }; }).filter(function (x) { return x.p; }); };
    var saved = function () { return G.store('gz.addr') || {}; };
    var fld = function (name, label, val, extra) { return '<label class="fld">' + label + '<input name="' + name + '" value="' + esc(val || '') + '"' + (extra || '') + '></label>'; };
    var draw = function () {
      var its = items();
      if (!its.length) { main.innerHTML = '<h1>Checkout</h1><p class="mute">Your cart is empty.</p><div class="chips" style="margin-top:12px"><a class="pill white sm" href="search.html?deals=1">Today\u2019s deals</a><a class="pill grey sm" href="results.html">Ask Grok</a></div>'; sum.innerHTML = ''; return; }
      var a = saved(), w = G.where(), cc = a.cc || w.cc || 'US', n = its.reduce(function (s, x) { return s + x.qty; }, 0);
      var groups = [], byS = {}; its.forEach(function (x) { var s = sellerOf(x.p); if (!byS[s]) { byS[s] = []; groups.push(s); } byS[s].push(x); });
      var qg = {}; ((quote && quote.groups) || []).forEach(function (g) { qg[g.seller] = g; });
      var ccs = KCC.concat(KCC.indexOf(cc) < 0 ? [cc] : []).map(function (c) { return [c, G.regionName(c)]; }).sort(function (x, y) { return x[1] < y[1] ? -1 : 1; });
      main.innerHTML = '<h1>Checkout <span class="mute" style="font-size:16px;font-weight:400">(' + n + (n === 1 ? ' item' : ' items') + ')</span></h1>' +
        '<section class="ksec"><h2><b>1</b>Shipping address</h2><form id="kaddr" autocomplete="on" novalidate>' +
          fld('name', 'Full name', a.name, ' autocomplete="name" maxlength="60" required') +
          fld('line1', 'Address', a.line1, ' autocomplete="address-line1" maxlength="100" placeholder="Street address" required') +
          fld('line2', 'Apartment, suite, unit (optional)', a.line2, ' autocomplete="address-line2" maxlength="100"') +
          '<div class="fld2">' + fld('city', 'City', a.city || w.city, ' autocomplete="address-level2" maxlength="60" required') + fld('state', 'State / region', a.state, ' autocomplete="address-level1" maxlength="40"') + '</div>' +
          '<div class="fld2">' + fld('zip', 'ZIP / postcode', a.zip || w.zip, ' autocomplete="postal-code" maxlength="12" required') +
          '<label class="fld">Country<select name="cc" autocomplete="country">' + ccs.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === cc ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="kerr" id="kerr" role="alert"></div></form></section>' +
        '<section class="ksec"><h2><b>2</b>Delivery</h2>' + groups.map(function (s) {
          var g = qg[s];
          return '<div class="kgrp"><div class="kgh"><span>Ships from <b>' + esc(s) + '</b></span><span class="mute">' + (g ? (g.shipping ? money(g.shipping) + ' shipping' : '<b class="free">FREE</b> · ' + esc(String(g.why).replace(/^free /, ''))) : '') + '</span></div>' +
            byS[s].map(function (x) { var p = x.p, e = A.eta(p); return '<div class="kitem"><img src="' + esc(p.thumbnail) + '" alt="" loading="lazy"><div><div class="ti">' + esc(p.title) + '</div><div class="meta">' + (e ? '<b class="ok">Arrives by ' + esc(e) + '</b> \u00b7 ' : '') + 'Qty ' + x.qty + ' \u00b7 ' + money(p.price * x.qty) + '</div></div></div>'; }).join('') + '</div>';
        }).join('') + '</section>' +
        '<section class="ksec"><h2><b>3</b>Payment method</h2>' + (payMode === 'off'
          ? '<div class="kpay"><span class="dot" aria-hidden="true"></span><div><b>Grokshop preview pay</b><small>No card needed. Placing the order charges nothing and nothing ships.</small></div></div>'
          : '<div class="kpay"><span class="dot" aria-hidden="true"></span><div><b>Credit or debit card</b><small>You enter it on Stripe\u2019s secure page right after you place the order' + (payMode === 'test' ? '. Preview payments: card 4242 4242 4242 4242, any future date, any CVC. You won\u2019t be charged.' : '.') + '</small></div></div>') + '</section>';
      var qt = quote;
      sum.innerHTML = '<button class="pill white block" type="button" id="place">' + (payMode === 'off' ? 'Place your order' : 'Continue to payment') + '</button>' +
        '<div class="mute" style="font-size:12px">By placing your order you agree to Grokshop\u2019s <a href="terms.html">terms</a> and <a href="privacy.html">privacy notice</a>.</div>' +
        (qt ? '<dl class="qt"><dt>Items (' + n + ')</dt><dd>' + money(qt.items) + '</dd><dt>Shipping</dt><dd>' + (qt.shipping ? money(qt.shipping) : '<b class="free">FREE</b>') + '</dd>' + (payMode !== 'off' && taxOn ? '<dt>Estimated tax</dt><dd>calculated at payment</dd>' : '') + '</dl><div class="tot">Order total: <b>' + money(qt.total) + '</b></div>' : '<div class="mute">Pricing your order\u2026</div>') +
        '<a class="linkb" href="cart.html" style="font-size:13px">\u2039 Back to cart</a>';
      $('#place').addEventListener('click', place);
      $('#kaddr').addEventListener('input', function (e) { if (e.target.value.trim()) e.target.classList.remove('bad'); if (!$$('#kaddr .bad').length) $('#kerr').textContent = ''; });
    };
    var place = function () {
      if (placing) return;
      var f = $('#kaddr'), v = function (k) { return String((f.elements[k] || {}).value || '').trim(); };
      var to = { name: v('name'), line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), zip: v('zip'), cc: v('cc') };
      var miss = [['name', 'your full name'], ['line1', 'a street address'], ['city', 'a city'], ['zip', 'a ZIP or postcode']].filter(function (m) { return !to[m[0]]; });
      $$('#kaddr input').forEach(function (i) { i.classList.toggle('bad', !!miss.filter(function (m) { return m[0] === i.name; }).length); });
      if (miss.length) { $('#kerr').textContent = 'Add ' + miss.map(function (m) { return m[1]; }).join(', ') + '.'; f.elements[miss[0][0]].focus(); return; }
      $('#kerr').textContent = ''; G.store('gz.addr', to);
      placing = true; var b = $('#place'); b.disabled = true; b.textContent = payMode === 'off' ? 'Placing your order\u2026' : 'Opening payment\u2026';
      post('/orders/checkout', { lines: A.cart().map(function (x) { return { id: x.id, qty: x.qty || 1 }; }), where: { city: to.city, zip: to.zip, cc: to.cc }, shipTo: to }).then(function (j) {
        if (j.mode === 'test') A.saveCart([]);
        location.href = j.url;
      }).catch(function (e) { G.toast(e.message); placing = false; b.disabled = false; b.textContent = payMode === 'off' ? 'Place your order' : 'Continue to payment'; });
    };
    Promise.all([A.catalogue(), health()]).then(function (r) {
      payMode = r[1].payments || 'off'; taxOn = !!r[1].tax; draw();
      if (!API || !A.cart().length) return;
      post('/orders/quote', { lines: A.cart().map(function (x) { return { id: x.id, qty: x.qty || 1 }; }) }).then(function (q) { quote = q; var keep = {}; $$('#kaddr input, #kaddr select').forEach(function (i) { keep[i.name] = i.value; }); draw(); $$('#kaddr input, #kaddr select').forEach(function (i) { if (keep[i.name] != null) i.value = keep[i.name]; }); }).catch(function () { });
    }).catch(function () { main.innerHTML = '<div class="empty">The store did not load. Refresh to try again.</div>'; });
  };

  /* ---------- ORDER placed ---------- */
  function orderCard(o, withReturns) {
    var placed = new Date(o.paidAt || o.at), paid = o.status === 'placed';
    return '<div class="ord"><div class="oh"><span>Order placed<b>' + placed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</b></span><span>Total<b>' + money(o.total) + '</b>' + (o.shipping != null ? '<small class="mute">items ' + money(o.items) + ' + shipping ' + (o.shipping ? money(o.shipping) : 'free') + (o.tax ? ' + tax ' + money(o.tax) : '') + '</small>' : '') + '</span><span>Order #<b class="mono">' + esc(o.id) + '</b></span><span>Status<b>' + esc(o.mode === 'test' ? 'Preview order · nothing ships' : o.mode === 'stripe-test' ? (o.status === 'placed' ? 'Preview order · test card, nothing ships' : o.status) : o.status) + '</b></span>' + (o.shipTo && (o.shipTo.city || o.shipTo.cc) ? '<span>Ship to<b>' + esc([o.shipTo.name, o.shipTo.city, o.shipTo.cc ? G.regionName(o.shipTo.cc) : ''].filter(Boolean).join(', ')) + '</b></span>' : '') + '</div><div class="ol">' +
      o.lines.map(function (l) {
        return '<div class="citem2"><a class="ph" href="product.html?id=' + encodeURIComponent(l.id) + '"><img src="' + esc(l.thumbnail) + '" alt="" loading="lazy"></a><div><a class="ti" href="product.html?id=' + encodeURIComponent(l.id) + '">' + esc(l.title) + '</a>' +
          '<div class="meta">Sold by ' + esc(l.seller) + ' · Qty ' + l.qty + ' · ' + money(l.price * l.qty) + (l.shipsIn ? ' · ' + esc(l.shipsIn) : '') + '</div>' +
          (withReturns && paid ? '<div class="row2">' + (l.status === 'ordered' || l.status === 'shipped' ? '<button class="pill grey sm" type="button" data-ret="' + esc(o.id) + ':' + l.n + '">Return with Grok</button>' : '<span class="tag ok">' + esc(l.status) + '</span>') +
            (l.status === 'shipped' ? '<span class="tag ok">shipped' + (l.carrier ? ' · ' + esc(l.carrier) : '') + (l.tracking ? ' · ' + esc(l.tracking) : '') + '</span>' : l.status === 'ordered' ? '<span class="mute" style="font-size:12px">' + esc(l.returns || 'returns set by the seller') + '</span>' : '') +
            (l.reviewed ? '<span class="mute" style="font-size:12px">you rated it ' + A.starsTxt(l.reviewed) + '</span>' : '<button class="linkb" type="button" data-rev="' + esc(o.id) + ':' + l.n + ':' + esc(l.title) + '">Write a review</button>') + '</div><div class="bubble-reply" id="rr-' + esc(o.id) + '-' + l.n + '"></div>' : '') + '</div></div>';
      }).join('') + '</div></div>';
  }
  PAGES.order = function () {
    var P = new URLSearchParams(location.search), id = P.get('id') || '', box = $('#obox'); loading(box);
    if (!API) return apiDown(box, 'Your order');
    getJ('/orders/confirm?id=' + encodeURIComponent(id)).then(function (o) {
      if (o.status === 'placed') A.saveCart([]);
      box.innerHTML = '<div class="thread" style="padding:0">' + A.msgBot('<p>' + (o.status === 'placed' ? 'order placed, thank you. ' + (o.mode === 'test' || o.mode === 'stripe-test' ? 'this was a preview order' + (o.mode === 'stripe-test' ? ' paid with a test card' : '') + ': nothing was charged and nothing ships.' : 'each seller ships their part and you get the updates here.') : 'waiting for the payment to confirm. refresh in a moment.') + '</p>') + '</div>' + orderCard(o, false) +
        '<div class="chips" style="margin-top:6px"><a class="pill white sm" href="orders.html">Your orders</a><a class="pill grey sm" href="index.html">Keep shopping</a></div>';
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  /* ---------- YOUR ORDERS + returns by a Grok bot ---------- */
  PAGES.orders = function () {
    var box = $('#olist'); loading(box);
    if (!API) return apiDown(box, 'Your orders');
    var draw = function () {
      getJ('/orders').then(function (j) {
        box.innerHTML = j.orders.length ? j.orders.map(function (o) { return orderCard(o, true); }).join('') : '<div class="empty">No orders yet' + (G.me() ? '' : ' in this browser. Sign in with X to see orders from your other devices') + '. <a href="index.html" style="color:var(--accent)">Start shopping</a>.</div>';
      }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    };
    box.addEventListener('click', function (e) {
      var rv = e.target.closest('[data-rev]');
      if (rv) {
        var pr = rv.getAttribute('data-rev').split(':'), stars = 5;
        G.sheet('<h3>Review: ' + esc(pr.slice(2).join(':')) + '</h3><p>Only people who bought it here can review it, so every review says Verified purchase.</p><div class="starpick" id="sp">' + [1, 2, 3, 4, 5].map(function (k) { return '<button type="button" data-s="' + k + '" aria-label="' + k + ' stars">★</button>'; }).join('') + '</div>' +
          '<label class="fld">What should other shoppers know?<textarea id="rt" maxlength="500" rows="4" style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:12px;padding:12px;color:var(--ink);font:inherit"></textarea></label><p class="err" id="re"></p><div class="acts"><button class="pill grey sm" type="button" data-close>Cancel</button><button class="pill white sm" type="button" id="rs">Post review</button></div>',
          function (s, close) {
            var paint = function () { $$('#sp button', s).forEach(function (b2) { b2.classList.toggle('on', +b2.getAttribute('data-s') <= stars); }); }; paint();
            $('#sp', s).addEventListener('click', function (ev) { var b2 = ev.target.closest('[data-s]'); if (b2) { stars = +b2.getAttribute('data-s'); paint(); } });
            $('#rs', s).addEventListener('click', function () {
              post('/reviews', { order: pr[0], line: +pr[1], rating: stars, text: $('#rt', s).value }).then(function () { close(); G.toast('Thanks. Your review is on the product page.'); try { sessionStorage.removeItem('gz.cat.v6'); } catch (er) { } draw(); })
                .catch(function (er) { $('#re', s).textContent = er.message; });
            });
          });
        return;
      }
      var b = e.target.closest('[data-ret]'); if (!b) return;
      var parts = b.getAttribute('data-ret').split(':'), slot = $('#rr-' + parts[0] + '-' + parts[1]);
      slot.innerHTML = '<div class="thread" style="padding:0">' + A.msgBot('<p>why are you sending it back?</p><div class="chips" style="margin-top:8px">' + ['Doesn\u2019t fit', 'Not as described', 'Arrived damaged', 'Changed my mind'].map(function (r) { return '<button class="chip" type="button" data-why="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>') + '</div>';
      slot.addEventListener('click', function (ev) {
        var w = ev.target.closest('[data-why]'); if (!w) return;
        slot.innerHTML = '<div class="thread" style="padding:0">' + A.msgBot('<div class="steps"><div class="s run">checking the seller\u2019s return window</div></div>') + '</div>';
        post('/orders/return', { order: parts[0], line: +parts[1], reason: w.getAttribute('data-why') }).then(function (r) {
          slot.innerHTML = '<div class="thread" style="padding:0">' + A.msgBot('<p>' + esc(r.note) + '</p>') + '</div>';
          if (r.line && r.line.status !== 'ordered') { b.outerHTML = '<span class="tag ok">' + esc(r.line.status) + '</span>'; }
        }).catch(function (er) { slot.innerHTML = '<div class="empty">' + esc(er.message) + '</div>'; });
      });
    });
    draw();
  };

  /* ---------- SELLER CENTRAL ---------- */
  // phone photos are big: shrink to 1200 px JPEG in the browser before upload (a photo, not drawn art)
  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); var q = .85, d = c.toDataURL('image/jpeg', q);
        while (d.length > 900000 && q > .4) { q -= .1; d = c.toDataURL('image/jpeg', q); }
        res(d);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That file is not a photo.')); };
      img.src = url;
    });
  }
  PAGES.seller = function () {
    var photos = [];
    $('#scWho').innerHTML = G.me() ? 'Selling as <b>@' + esc(G.me().username) + '</b>. Your listings follow your X account.' : 'Selling from this browser. <button class="linkb" type="button" id="scIn">Sign in with <span class=\"xlogo\" role=\"img\" aria-label=\"X\"></span></button> so buyers see who you are and your listings follow your account.';
    var si = $('#scIn'); if (si) si.addEventListener('click', G.signIn);
    $$('.sc .tabs .chip').forEach(function (b) { b.addEventListener('click', function () { $$('.sc .tabs .chip').forEach(function (x) { x.classList.toggle('on', x === b); }); $$('[data-tab]').forEach(function (p) { p.hidden = p.getAttribute('data-tab') !== b.getAttribute('data-to'); }); if (b.getAttribute('data-to') === 'mine') mine(); }); });
    $('#lDept').innerHTML = G.DEPTS.map(function (d) { return '<option value="' + d[0] + '">' + esc(d[1]) + '</option>'; }).join('') + '<option value="other">Other</option>';
    $('#lPhotos').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files, 0, 4 - photos.length);
      Promise.all(files.map(shrink)).then(function (ds) { photos = photos.concat(ds).slice(0, 4); $('#lThumbs').innerHTML = photos.map(function (d) { return '<img src="' + d + '" alt="">'; }).join(''); }).catch(function (e) { G.toast(e.message); });
      this.value = '';
    });
    var f = $('#lForm'), err = $('#lErr');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (!API) { err.textContent = 'Listing needs the Grokshop server.'; return; }
      if (!photos.length) { err.textContent = 'Add at least one photo of the real product.'; return; }
      var b = $('#lGo'); b.disabled = true; b.textContent = 'Sending for review…';
      post('/seller/listings', { title: f.title.value, description: f.description.value, price: f.price.value, stock: f.stock.value, dept: f.dept.value, shipsIn: f.shipsIn.value, returns: f.returns.value, store: f.store.value, images: photos })
        .then(function () { f.reset(); photos = []; $('#lThumbs').innerHTML = ''; G.toast('Sent for review. It goes live once approved.'); $('.sc .tabs [data-to="mine"]').click(); })
        .catch(function (er) { err.textContent = er.message; }).then(function () { b.disabled = false; b.textContent = 'Send for review'; });
    });
    var mine = function () {
      var box = $('#mineList'); if (!API) return apiDown(box, 'Your listings');
      loading(box);
      getJ('/seller/listings').then(function (j) {
        box.innerHTML = j.listings.length ? j.listings.map(function (L) { return '<div class="lrow"><img src="' + esc(API + '/img/' + L.images[0]) + '" alt=""><div>' + esc(L.title) + '<small>' + money(L.price) + ' · ' + esc(DNAME[L.dept] || 'More') + ' · stock ' + L.stock + '</small></div><div class="acts"><span class="tag ' + (L.status === 'live' ? 'ok' : L.status === 'declined' ? 'warn' : '') + '">' + esc(L.status) + '</span>' + (L.status === 'live' ? '<a class="pill grey sm" href="product.html?id=' + esc(L.id) + '">View</a>' : '') + '</div></div>'; }).join('') : '<div class="empty">No listings yet.</div>';
      }).catch(function (er) { box.innerHTML = '<div class="empty">' + esc(er.message) + '</div>'; });
    };
    var sf = $('#sForm'), serr = $('#sErr');
    sf.addEventListener('submit', function (e) {
      e.preventDefault(); serr.textContent = '';
      if (!API) { serr.textContent = 'Connecting needs the Grokshop server.'; return; }
      // a private token never leaves this browser
      if (/^shp(at|ss|ca|pa)_/.test(sf.token.value.trim())) { serr.textContent = 'That is a private Shopify token. Never share it. Use the PUBLIC Storefront token from the Headless channel.'; sf.token.value = ''; return; }
      post('/seller/shopify', { domain: sf.domain.value, token: sf.token.value, shipsIn: sf.shipsIn.value, returns: sf.returns.value })
        .then(function (j) { sf.hidden = true; $('#sDone').hidden = false; $('#sDone').innerHTML = '<div class="thread" style="padding:0">' + A.msgBot('<p>got it. ' + esc(j.store) + ' is in review. once approved, its products show up in the store and in my answers within 30 minutes.</p>') + '</div>'; })
        .catch(function (er) { serr.textContent = er.message; });
    });
    if (location.hash === '#shopify') $('.sc .tabs [data-to="shopify"]').click();
    // orders to ship: every placed order with this seller's items (test orders say so)
    var ordersTab = $('.sc .tabs [data-to="ship"]'), shipBox = $('#shipList');
    var shipSeq = 0, shipAt = 0;
    var ships = function () {
      if (!API) return apiDown(shipBox, 'Orders');
      var my = ++shipSeq; shipAt = Date.now();
      getJ('/seller/orders').then(function (j) {
        if (my !== shipSeq) return;   // a newer load is on its way; never redraw over someone typing
        ordersTab.innerHTML = 'Orders to ship' + (j.toShip ? ' <b class="newN">' + j.toShip + '</b>' : '');
        shipBox.innerHTML = j.orders.length ? j.orders.map(function (o) {
          var to = o.shipTo || {};
          return '<div class="ord" style="margin-top:12px"><div class="oh"><span>Order #<b class="mono">' + esc(o.id) + '</b></span><span>Placed<b>' + new Date(o.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</b></span><span>Ship to<b>' + esc([to.name, to.line1, to.city, to.state, to.zip, to.cc].filter(Boolean).join(', ') || 'shown once paid') + '</b></span>' + (o.mode !== 'live' ? '<span>Status<b>Preview order · do not ship</b></span>' : '') + '</div><div class="ol">' +
            o.lines.map(function (l) { return '<div class="lrow"><img src="' + esc(l.thumbnail) + '" alt=""><div>' + esc(l.title) + '<small>Qty ' + l.qty + ' · ' + money(l.price * l.qty) + '</small></div><div class="acts">' + (l.status === 'ordered' ? '<input class="trk" placeholder="tracking number (optional)" maxlength="60" id="t-' + esc(o.id) + '-' + l.n + '"><button class="pill white sm" type="button" data-ship="' + esc(o.id) + ':' + l.n + '">Mark shipped</button>' : '<span class="tag ok">' + esc(l.status) + (l.tracking ? ' · ' + esc(l.tracking) : '') + '</span>') + '</div></div>'; }).join('') + '</div></div>';
        }).join('') : '<div class="empty">No orders yet. When someone buys your product, it shows up here with the delivery address.</div>';
      }).catch(function (er) { shipBox.innerHTML = '<div class="empty">' + esc(er.message) + '</div>'; });
    };
    shipBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ship]'); if (!b) return; var p2 = b.getAttribute('data-ship').split(':'), t = $('#t-' + p2[0] + '-' + p2[1]);
      b.disabled = true; post('/seller/orders/ship', { order: p2[0], line: +p2[1], tracking: t ? t.value : '' }).then(function () { G.toast('Marked shipped. The buyer sees it in Your orders.'); ships(); }).catch(function (er) { G.toast(er.message); b.disabled = false; });
    });
    ordersTab.addEventListener('click', function () { if (Date.now() - shipAt > 5000) ships(); }); ships();
    // payouts: Stripe Connect. Sellers finish setup on Stripe's own pages; Grokshop never sees bank details.
    var payBox = $('#payBox');
    var pays = function () {
      if (!API) return apiDown(payBox, 'Payouts');
      getJ('/seller/payouts').then(function (p) {
        var msg = {
          off: '<p>Payouts switch on together with payments. You can list products now; once payments are live, connect a Stripe account here so each sale is paid to you.</p>',
          none: '<p>Get paid for every sale. Grokshop takes the payment at checkout and Stripe sends your part (your items and your shipping) to your bank. You set this up on Stripe\u2019s own page; Grokshop never sees your bank details.</p><button class="pill white" type="button" id="payGo">Set up payouts with Stripe</button>',
          started: '<p>Almost there: Stripe still needs ' + (p.due ? p.due + ' detail' + (p.due === 1 ? '' : 's') : 'a few details') + ' before it can pay you.</p><button class="pill white" type="button" id="payGo">Continue on Stripe</button>',
          ready: '<p><span class="tag ok">Payouts ready</span> Each sale is sent to your Stripe account after the shopper pays.</p><button class="pill grey" type="button" id="payDash">Open your Stripe dashboard</button>'
        }[p.status] || '';
        payBox.innerHTML = '<h3 style="font-size:18px;margin-bottom:6px">Payouts</h3>' + msg;
        var go = $('#payGo'); if (go) go.addEventListener('click', function () { go.disabled = true; post('/seller/payouts/start', { cc: (G.where().cc || 'US') }).then(function (j) { location.href = j.url; }).catch(function (e) { G.toast(e.message); go.disabled = false; }); });
        var dash = $('#payDash'); if (dash) dash.addEventListener('click', function () { post('/seller/payouts/dashboard', {}).then(function (j) { window.open(j.url, '_blank', 'noopener'); }).catch(function (e) { G.toast(e.message); }); });
      }).catch(function (e) { payBox.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    };
    $('.sc .tabs [data-to="payouts"]').addEventListener('click', pays);
    if (location.hash === '#payouts') { $('.sc .tabs [data-to="payouts"]').click(); }
  };

  /* ---------- REVIEW (owner only; the password lives in C:\Users\User\keys\grokazon\admin-token.txt) ---------- */
  PAGES.admin = function () {
    var box = $('#queue'), key = function () { try { return sessionStorage.getItem('gz.admin') || ''; } catch (e) { return ''; } };
    var call = function (path, body) {
      return A.timed(API + path, 20000, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': key() }, body: JSON.stringify(body) } : { headers: { 'x-admin-token': key() } })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Not allowed.'); return j; }); });
    };
    var draw = function () {
      if (!key()) { box.innerHTML = ''; return; }
      loading(box);
      call('/admin/stats').then(function (st) {
        var cols = [['views', 'Page views'], ['searches', 'Grok searches'], ['orders', 'Orders'], ['signins', 'X sign-ins'], ['listings', 'New listings'], ['reviews', 'Reviews']];
        $('#stats').innerHTML = '<div class="panel" style="margin-top:14px;overflow-x:auto"><h3 style="font-size:18px">Last 14 days (counted by the server)</h3><table class="stbl"><thead><tr><th>Day</th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
          st.days.map(function (d) { return '<tr><td class="p">' + esc(d.day) + '</td>' + cols.map(function (c) { return '<td class="p">' + (d[c[0]] || 0) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      }).catch(function () { });
      call('/admin/queue').then(function (q) {
        var sec = function (title, rows) { return '<div class="panel" style="margin-top:14px"><h3 style="font-size:18px">' + title + '</h3>' + (rows || '<div class="empty">Nothing here.</div>') + '</div>'; };
        box.innerHTML = sec('Product listings (' + q.listings.filter(function (l) { return l.status === 'in review'; }).length + ' waiting)', q.listings.map(function (L) {
          return '<div class="lrow"><img src="' + esc(API + '/img/' + L.images[0]) + '" alt=""><div>' + esc(L.title) + '<small>' + money(L.price) + ' · ' + esc(L.seller) + (L.sellerX ? ' (@' + esc(L.sellerX) + ' on X)' : '') + ' · ' + esc(L.shippingInformation || 'no delivery time') + ' · ' + esc(L.returnPolicy || 'no return line') + '</small><small>' + esc((L.description || '').slice(0, 160)) + '</small></div><div class="acts"><span class="tag">' + esc(L.status) + '</span><button class="pill white sm" type="button" data-d="listing:' + esc(L.id) + ':1">Approve</button><button class="pill line sm" type="button" data-d="listing:' + esc(L.id) + ':0">Decline</button></div></div>';
        }).join('')) + sec('Shopify stores', q.shopify.map(function (R) {
          return '<div class="lrow"><span class="av sm w">S</span><div>' + esc(R.id) + '.myshopify.com<small>token ' + esc(R.token || '') + ' · ' + esc(R.shipsIn || 'no delivery time') + ' · ' + esc(R.returns || 'no return line') + (R.sellerX ? ' · @' + esc(R.sellerX) : '') + '</small></div><div class="acts"><span class="tag">' + esc(R.status) + '</span><button class="pill white sm" type="button" data-d="shopify:' + esc(R.id) + ':1">Approve</button><button class="pill line sm" type="button" data-d="shopify:' + esc(R.id) + ':0">Decline</button></div></div>';
        }).join('')) + sec('Warehouse orders (CJ, US warehouse)', (q.warehouse || []).map(function (W) {
          var st = W.error ? '<span class="tag warn">problem</span>' : '<span class="tag">' + esc(W.status || 'sent') + '</span>';
          return '<div class="lrow"><span class="av sm w">W</span><div>' + esc(W.id) + (W.cjOrder ? ' · CJ ' + esc(W.cjOrder) : '') + '<small>' + (W.sandbox ? 'CJ sandbox (test, nothing ships)' : W.paid ? 'live · paid from your CJ balance' : 'live · waiting for you to pay it in CJ') + ' · ' + esc(String(new Date(W.at).toISOString()).slice(0, 10)) + (W.cost != null ? ' · CJ cost ' + money(W.cost) : '') + ' · buyer paid ' + money(W.total || 0) + (W.logistic ? ' · ' + esc(W.logistic) : '') + (W.tracking ? ' · tracking ' + esc(W.tracking) : '') + '</small><small>' + esc(W.error || W.items) + '</small></div><div class="acts">' + st + '</div></div>';
        }).join('')) + sec('Merchant requests (Sell page form)', q.merchants.map(function (M) { return '<div class="lrow"><span class="av sm w">M</span><div>' + esc(M.store) + '<small>' + esc(M.x ? '@' + M.x : 'no X handle') + ' · ' + esc(M.products || '') + ' products · ' + esc(String(M.at).slice(0, 10)) + '</small><small>' + esc(M.note || '') + '</small></div><div></div></div>'; }).join(''));
      }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    };
    $('#akForm').addEventListener('submit', function (e) { e.preventDefault(); try { sessionStorage.setItem('gz.admin', $('#ak').value.trim()); } catch (er) { } $('#ak').value = ''; draw(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]'); if (!b) return; var p = b.getAttribute('data-d').split(':');
      b.disabled = true; call('/admin/decide', { kind: p[0], id: p[1], ok: p[2] === '1' }).then(function (r) { G.toast(p[1] + ': ' + r.status); try { sessionStorage.removeItem('gz.cat.v6'); } catch (er) { } draw(); }).catch(function (er) { G.toast(er.message); b.disabled = false; });
    });
    if (!API) return apiDown(box, 'Review');
    draw();
  };

  var page = document.body.getAttribute('data-page');
  if (PAGES[page]) PAGES[page]();
})();
