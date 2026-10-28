// Headless QA of the GROKAZON store at 430x932 and 1280x800: node grokazon/qa/shots.cjs [--live]
// Needs the site on :5445 (preview "grokazon") and the helper on :8806 (preview "grokazon-api", wrangler dev: local KV).
// Default: no model spend (Grok results use ?fixture=1). --live also runs one real /ask and the helper-down fallback.
// Store flow: home -> search + filters -> product -> cart -> test checkout -> order page -> Your orders -> return with
// Grok; Seller Central listing (photo upload) -> review queue approve -> listed in the store; Ask Grok; missions; sell
// form; X sign-in preview + a signed-in test session. Every page: zero console errors, nothing wider than the screen,
// no broken images, no password/card fields on Grokazon, the footer concept line. Screens land in qa/shots/.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const SITE = 'http://localhost:5445', API = 'http://127.0.0.1:8806', LIVE = process.argv.includes('--live');
const Q = 'Find me the best wireless headphones under $150, delivered this week.';
const ADMIN = fs.readFileSync(path.join(os.homedir(), 'keys', 'grokazon', 'admin-token.txt'), 'utf8').trim();
const PHOTO = path.join(os.tmpdir(), 'grokazon-qa-photo.webp');
// a real product photo from the catalogue stands in for a seller's own shot
const photoReady = fetch('https://cdn.dummyjson.com/product-images/home-decoration/plant-pot/1.webp').then(r => r.arrayBuffer()).then(b => fs.writeFileSync(PHOTO, Buffer.from(b)));

(async () => {
  await photoReady;
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  let pass = true, n = 0; const errs = [];
  const check = (name, ok, extra) => { n++; if (!ok) pass = false; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
  for (const [vp, w, h] of [['phone', 430, 932], ['desktop', 1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: vp === 'phone' ? 2 : 1, isMobile: vp === 'phone', hasTouch: vp === 'phone', timezoneId: vp === 'phone' ? 'Asia/Kuala_Lumpur' : 'America/New_York', locale: vp === 'phone' ? 'en-MY' : 'en-US' });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && page.url().startsWith(SITE)) errs.push(vp + ' ' + page.url().split('/').pop().slice(0, 50) + ': ' + m.text()); });
    page.on('pageerror', e => errs.push(vp + ' pageerror: ' + e.message));
    const facts = () => page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('loading') !== 'lazy').map(i => i.src).slice(0, 3),
      pay: document.querySelectorAll('input[type=password]:not(#ak), input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvv" i]').length,
      foot: (document.querySelector('footer.foot') || {}).innerText || ''
    }));
    const common = async (name) => {
      const f = await facts();
      check(`${vp} ${name}: fits the screen`, f.sw <= w, 'scrollWidth ' + f.sw);
      check(`${vp} ${name}: no broken images`, !f.broken.length, f.broken.join(' '));
      check(`${vp} ${name}: no card or password fields`, f.pay === 0);
      check(`${vp} ${name}: footer has @grokazonapp, no concept or catalogue lines`, /@grokazonapp/.test(f.foot) && !/Not affiliated|DummyJSON|mock\.shop|v0\./.test(f.foot));
    };
    const shot = async (name, full) => { await page.screenshot({ path: path.join(out, `${name}-${vp}.png`) }); if (full) await page.screenshot({ path: path.join(out, `${name}-${vp}-full.png`), fullPage: true }); };

    // 1) store home
    await page.goto(SITE + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rows .tile', { timeout: 20000 });
    const home = await page.evaluate(() => ({ h1: document.querySelector('.banner h1').innerText, sub: document.querySelector('.banner .sub').innerText, ph: document.querySelector('#q').placeholder,
      dcards: [...document.querySelectorAll('.dcard')].map(d => d.querySelectorAll('img').length), rows: document.querySelectorAll('#rows .row').length, tiles: document.querySelectorAll('#rows .tile').length,
      belt: !!document.querySelector('.belt .sbar input') && !!document.querySelector('#cartN') && !!document.querySelector('#xin'), strip: document.querySelectorAll('.strip a').length,
      tiers: document.querySelectorAll('.tier').length, faq: document.querySelectorAll('.faq details').length, thread: [...document.querySelectorAll('#thread .tq blockquote')].map(x => x.innerText), quote: document.querySelector('.quote blockquote').innerText }));
    check(`${vp} home: headline + store line + owner placeholder`, home.h1.replace(/\s+/g, ' ') === "Don't shop. Send Grok." && home.sub === 'The everything store with Grok built in. Fast delivery included with X.' && home.ph === Q, JSON.stringify([home.h1, home.sub]));
    check(`${vp} home: Amazon top bar (search, account, cart) + departments strip`, home.belt && home.strip >= 12, 'strip ' + home.strip);
    check(`${vp} home: 4 department cards with photos, product rows`, home.dcards.length === 4 && home.dcards.every(k => k === 4) && home.rows >= 3 && home.tiles >= 30, JSON.stringify([home.dcards, home.rows, home.tiles]));
    check(`${vp} home: X tiers, thread, Graham quote, FAQ`, home.tiers === 3 && home.thread.length === 3 && home.thread[1].startsWith('Maybe we should start a competitor to Amazon') && home.quote.includes('Your usage restrictions are my opportunity.') && home.faq === 6);
    await shot('index', true);
    await common('home');
    const city = vp === 'phone' ? 'Kuala Lumpur' : 'New York';
    check(`${vp} Deliver to: guessed from this device (${city})`, (await page.textContent(vp === 'phone' ? '.dlvm' : '.deliver')).includes(city));
    await page.click(vp === 'phone' ? '.dlvm' : '.deliver'); await page.waitForSelector('#wf');
    await page.fill('#wf [name=city]', 'Austin'); await page.selectOption('#wf [name=cc]', 'US'); await page.click('#wf button[type=submit]'); await page.waitForTimeout(300);
    check(`${vp} Deliver to: set by hand`, (await page.textContent(vp === 'phone' ? '.dlvm' : '.deliver')).includes('Austin'));

    // 2) search + filters + departments
    await page.fill('.sbar input', 'headphones'); await page.press('.sbar input', 'Enter');
    await page.waitForURL(/search\.html/); await page.waitForSelector('#grid .tile');
    const s1 = await page.evaluate(() => ({ count: document.querySelectorAll('#grid .tile').length, bar: document.querySelector('#sbar').innerText, strip: document.querySelector('#grokstrip').innerText }));
    check(`${vp} search: results grid + "Ask Grok to pick"`, s1.count >= 3 && /results for/.test(s1.bar) && /Ask Grok to pick/.test(s1.strip), JSON.stringify(s1).slice(0, 160));
    await shot('search', true);
    await page.click('[data-f="max:100"]'); await page.waitForTimeout(200);
    const s2 = await page.evaluate(() => [...document.querySelectorAll('#grid .tile .price')].map(p => parseFloat(p.childNodes[0].textContent.replace('$', ''))));
    check(`${vp} search: price filter keeps only items under $100`, s2.length >= 1 && s2.every(p => p <= 100), JSON.stringify(s2));
    await page.goto(SITE + '/search.html?dept=grocery', { waitUntil: 'networkidle' }); await page.waitForSelector('#grid .tile');
    check(`${vp} department page: Grocery`, (await page.textContent('#sbar')).includes('Grocery') && (await page.$$('#grid .tile')).length >= 6);
    await page.goto(SITE + '/search.html?deals=1', { waitUntil: 'networkidle' }); await page.waitForSelector('#grid .tile');
    check(`${vp} deals page: every tile shows its real discount`, await page.evaluate(() => [...document.querySelectorAll('#grid .tile')].every(t => t.querySelector('.off'))));
    await common('search');

    // 3) product: Amazon anatomy (gallery, facts, buy box)
    await page.evaluate(() => localStorage.removeItem('gz.cart'));
    await page.goto(SITE + '/product.html?id=107', { waitUntil: 'networkidle' }); await page.waitForSelector('.buy');
    const pr = await page.evaluate(() => ({ h1: document.querySelector('.facts h1').innerText, buy: document.querySelector('.buy').innerText }));
    check(`${vp} product: buy box (price, X fast date, stock, Add to cart, Buy now, seller, returns)`, pr.h1.includes('Beats') && /\$49\.00/.test(pr.buy) && /X fast delivery/.test(pr.buy) && /In Stock|left in stock/.test(pr.buy) && /Add to cart/.test(pr.buy) && /Buy now/.test(pr.buy) && /Sold by\s+Beats store/.test(pr.buy) && /7 days return policy/.test(pr.buy), pr.buy.replace(/\s+/g, ' ').slice(0, 200));
    check(`${vp} product: reference link to the same product at a real store`, /Same product elsewhere/.test(pr.buy) && /at Apple/.test(pr.buy));
    await shot('product', true);
    await page.selectOption('#qty', '2'); await page.click('#addc');
    await common('product');
    await page.goto(SITE + '/product.html?id=s-audio-3085', { waitUntil: 'networkidle' }); await page.waitForSelector('.buy');
    const sp = await page.evaluate(() => ({ tags: document.querySelector('.facts .badges').innerText, stars: document.querySelector('.facts .stars').innerText, dl: document.querySelector('.buy .dl').innerText }));
    const spRev = await page.evaluate(() => (document.querySelector('.revs') || {}).innerText || '');
    check(`${vp} Shopify store product: no source/test label, rating only from verified Grokazon reviews, the store's own delivery promise`, !/test store|Shopify/i.test(sp.tags) && (/no ratings yet/.test(sp.stars) || /Verified purchase/.test(spRev)) && /business day|Ships in|delivery/i.test(sp.dl) && !/set by the seller/.test(sp.dl), JSON.stringify(sp));
    await page.click('#addc');
    await page.goto(SITE + '/product.html?id=99999', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    check(`${vp} product: unknown id says so`, (await page.textContent('#pdp')).includes('not in the store'));

    // 4) one cart -> test checkout -> order page -> Your orders -> return with Grok
    await page.goto(SITE + '/cart.html', { waitUntil: 'networkidle' }); await page.waitForSelector('#checkout');
    const ct = await page.evaluate(() => ({ items: document.querySelectorAll('.citem2').length, sum: document.querySelector('.sumbox').innerText, sellers: document.querySelector('#clist p').innerText }));
    check(`${vp} cart: 2 sellers, one checkout, subtotal $178.00, one plain preview note`, ct.items === 2 && /\$178\.00/.test(ct.sum) && /2 sellers, one checkout/.test(ct.sellers) && /Preview (checkout: no payment is taken|payments: pay with card)/.test(ct.sum) && !/Test checkout/.test(ct.sum), JSON.stringify(ct).slice(0, 200));
    await page.waitForSelector('.qt', { timeout: 10000 });
    const qt = await page.evaluate(() => document.querySelector('.sumbox').innerText);
    check(`${vp} cart: items, shipping per seller (free over $35), no test-order tax line, order total`, /Items/.test(qt) && /Shipping · Beats store\s+FREE/.test(qt) && !/test orders/.test(qt) && /Order total: \$178\.00/.test(qt), qt.replace(/\s+/g, ' ').slice(0, 220));
    await shot('cart', true);
    await common('cart');
    await page.click('#checkout'); await page.waitForURL(/checkout\.html/, { timeout: 20000 }); await page.waitForSelector('#kaddr'); await page.waitForSelector('#ksum .qt', { timeout: 10000 });
    const ck = await page.evaluate(() => ({ t: document.querySelector('#kmain').innerText, s: document.querySelector('#ksum').innerText, cards: document.querySelectorAll('#kmain input[autocomplete^="cc-"], #kmain input[name*="card" i]').length }));
    check(`${vp} checkout page: address, delivery by seller with dates, payment method, order total, no card fields`, /Shipping address/.test(ck.t) && /Ships from Beats store/.test(ck.t) && /Arrives by/.test(ck.t) && /Payment method/.test(ck.t) && /Order total: \$178\.00/.test(ck.s) && ck.cards === 0, ck.s.replace(/\s+/g, ' ').slice(0, 160));
    await page.click('#place'); check(`${vp} checkout: asks for the missing address fields`, /Add your full name/.test(await page.textContent('#kerr')));
    await page.fill('#kaddr input[name=name]', 'QA Buyer'); await page.fill('#kaddr input[name=line1]', '500 Congress Ave'); await page.fill('#kaddr input[name=city]', 'Austin'); await page.fill('#kaddr input[name=state]', 'TX'); await page.fill('#kaddr input[name=zip]', '78701');
    await shot('checkout', true); await common('checkout');
    const viaStripe = /Continue to payment/.test(await page.textContent('#place'));
    await page.click('#place');
    if (viaStripe) {   // Stripe TEST mode: the published test card, the address already filled from Grokazon's page
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }); await page.waitForSelector('#cardNumber', { timeout: 45000 }); await page.waitForTimeout(1500);
      const pre = await page.evaluate(() => [...document.querySelectorAll('input')].map(i => i.value).join(' | '));
      check(`${vp} Stripe test page: address carried over from Grokazon's checkout`, /QA Buyer/.test(pre) && /500 Congress Ave/.test(pre) && /Austin/.test(pre), pre.slice(0, 120));
      await page.fill('#email', 'qa-buyer@example.com').catch(() => { });
      await page.fill('#cardNumber', '4242424242424242'); await page.fill('#cardExpiry', '12 / 34'); await page.fill('#cardCvc', '123');
      const bn = await page.$('#billingName'); if (bn && await bn.isVisible()) await bn.fill('QA Buyer');
      await page.click('.SubmitButton, button[type=submit]');
    }
    await page.waitForURL(/order\.html\?id=GZ-/, { timeout: 60000 }); await page.waitForSelector('.ord'); await page.waitForTimeout(800);
    const od = await page.evaluate(() => ({ t: document.querySelector('#obox').innerText, cart: document.querySelector('#cartN').textContent }));
    check(`${vp} preview order placed: thank you, nothing charged, cart emptied, ship to the address typed at checkout`, /order placed/.test(od.t) && /preview order/.test(od.t) && /nothing was charged/.test(od.t) && /GZ-/.test(od.t) && od.cart === '0' && /QA Buyer, Austin, United States/.test(od.t), od.t.slice(0, 160));
    await shot('order', true);
    await page.goto(SITE + '/orders.html', { waitUntil: 'networkidle' }); await page.waitForSelector('[data-ret]');
    await shot('orders');
    await page.click('[data-ret]'); await page.click('[data-why]');
    await page.waitForFunction(() => /return started|does not take returns|window closed/.test(document.querySelector('#olist').innerText), null, { timeout: 15000 });
    check(`${vp} return with Grok: checks the seller's window and starts the return`, /return started with beats store, 7 days left/.test(await page.textContent('#olist')));
    await shot('orders-return');
    await page.click('[data-rev*=":1:"]'); await page.waitForSelector('#sp');
    await page.click('#sp [data-s="4"]'); await page.fill('#rt', 'Warm sound, big cushions. QA review.'); await page.click('#rs');
    await page.waitForFunction(() => /you rated it/.test(document.querySelector('#olist').innerText), null, { timeout: 15000 });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(SITE + '/product.html?id=s-audio-3085', { waitUntil: 'networkidle' }); await page.waitForSelector('.buy');
    const rv = await page.evaluate(() => ({ revs: (document.querySelector('.revs') || {}).innerText || '', stars: document.querySelector('.facts .stars').innerText }));
    check(`${vp} verified review shows on the product and sets its rating`, /Verified purchase/.test(rv.revs) && /Warm sound/.test(rv.revs) && !/no ratings yet/.test(rv.stars), JSON.stringify(rv).slice(0, 200));
    await page.goto(SITE + '/orders.html', { waitUntil: 'networkidle' }); await page.waitForSelector('.ord');
    await common('orders');

    // 5) Seller Central: list a product with a photo -> in review -> owner approves -> in the store
    await page.goto(SITE + '/seller.html', { waitUntil: 'networkidle' });
    await page.click('#lGo'); check(`${vp} seller: refuses a listing without photos`, (await page.textContent('#lErr')).length > 5);
    const title = 'QA Terracotta Plant Pot ' + vp + ' ' + Date.now().toString(36);
    await page.fill('#lForm [name=title]', title); await page.fill('#lForm [name=description]', 'Hand-thrown terracotta pot, 15 cm across, drainage hole. QA listing.');
    await page.fill('#lForm [name=price]', '24'); await page.fill('#lForm [name=stock]', '12'); await page.selectOption('#lForm [name=dept]', 'home'); await page.fill('#lForm [name=store]', 'QA Pottery');
    await page.setInputFiles('#lPhotos', PHOTO); await page.waitForSelector('#lThumbs img');
    await shot('seller', true);
    await page.click('#lGo'); await page.waitForFunction(() => !document.querySelector('[data-tab="mine"]').hidden && document.querySelector('#mineList .lrow'), null, { timeout: 20000 });
    check(`${vp} seller: listing sent and shown as "in review"`, (await page.textContent('#mineList')).includes('in review'));
    check(`${vp} seller: never asks for passwords, bank details or private tokens`, await page.evaluate(() => [...document.querySelectorAll('input')].every(i => i.type !== 'password' && !/password|bank|iban|routing/i.test(i.name + i.placeholder))));
    await page.click('[data-to="shopify"]'); await page.fill('#sForm [name=domain]', 'qa-store.myshopify.com'); await page.fill('#sForm [name=token]', 'shpat_0123456789abcdef'); await page.click('#sForm button[type=submit]'); await page.waitForFunction(() => document.querySelector('#sErr').textContent.length > 5, null, { timeout: 10000 }).catch(() => {});
    check(`${vp} seller: a private Shopify token is refused`, /private Shopify token/.test(await page.textContent('#sErr')));
    await common('seller');
    await page.goto(SITE + '/admin.html', { waitUntil: 'networkidle' }); await page.fill('#ak', ADMIN); await page.click('#akForm button');
    await page.waitForSelector('#queue .lrow'); await page.waitForSelector('#stats table', { timeout: 10000 });
    check(`${vp} review page shows the server's daily counts`, await page.evaluate(() => /Page views/.test(document.querySelector('#stats').innerText) && /Orders/.test(document.querySelector('#stats').innerText)));
    const row = page.locator('#queue .lrow', { hasText: title });
    await row.locator('button', { hasText: 'Approve' }).click(); await page.waitForTimeout(800);
    await shot('admin');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(SITE + '/search.html?q=' + encodeURIComponent('terracotta plant pot'), { waitUntil: 'networkidle' }); await page.waitForSelector('#grid .tile');
    check(`${vp} approved listing is in the store with its photo and seller`, await page.evaluate(t => [...document.querySelectorAll('#grid .tile')].some(x => x.innerText.includes(t) && x.innerText.includes('QA Pottery') && x.querySelector('img').src.includes('/img/')), title));

    const lhref = await page.evaluate(t => { const x = [...document.querySelectorAll('#grid .tile')].find(e => e.innerText.includes(t)); return x && x.querySelector('a.ti').getAttribute('href'); }, title);
    await page.goto(SITE + '/' + lhref, { waitUntil: 'networkidle' }); await page.waitForSelector('#addc'); await page.click('#addc');
    await page.goto(SITE + '/cart.html', { waitUntil: 'networkidle' }); await page.waitForSelector('.qt'); await page.click('#checkout');
    await page.waitForURL(/checkout\.html/); await page.waitForSelector('#ksum .qt', { timeout: 10000 });   // the address is remembered from the first checkout
    const via2 = /Continue to payment/.test(await page.textContent('#place')); await page.click('#place');
    if (via2) { await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }); await page.waitForSelector('#cardNumber', { timeout: 45000 }); await page.waitForTimeout(1200); await page.fill('#email', 'qa-buyer@example.com').catch(() => { }); await page.fill('#cardNumber', '4242424242424242'); await page.fill('#cardExpiry', '12 / 34'); await page.fill('#cardCvc', '123'); const bn2 = await page.$('#billingName'); if (bn2 && await bn2.isVisible()) await bn2.fill('QA Buyer'); await page.click('.SubmitButton, button[type=submit]'); }
    await page.waitForURL(/order\.html\?id=GZ-/, { timeout: 60000 }); await page.waitForSelector('.ord');
    await page.goto(SITE + '/seller.html', { waitUntil: 'networkidle' }); await page.click('[data-to="ship"]'); await page.waitForSelector('[data-ship]', { timeout: 15000 });
    check(`${vp} seller sees the order to ship (with delivery place and test-order warning)`, await page.evaluate(t => { const s = document.querySelector('#shipList').innerText; return s.includes(t) && /Austin/.test(s) && /Preview order · do not ship/.test(s); }, title));
    await page.fill('.trk', '1Z999QA'); await page.click('[data-ship]'); await page.waitForFunction(() => /shipped · 1Z999QA/.test(document.querySelector('#shipList').innerText), null, { timeout: 15000 });
    await shot('seller-orders');
    await page.goto(SITE + '/orders.html', { waitUntil: 'networkidle' }); await page.waitForSelector('.ord');
    check(`${vp} buyer sees it shipped with tracking`, /shipped · 1Z999QA/.test(await page.textContent('#olist')));

    // 6) Ask Grok (fixture: no model spend)
    await page.goto(SITE + '/results.html?q=' + encodeURIComponent(Q) + '&fixture=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#addAll', { timeout: 30000 }); await page.waitForTimeout(600);
    const res = await page.evaluate(() => ({ cards: document.querySelectorAll('#thread .pcard').length, pick: document.querySelectorAll('#thread .tag.pick').length, cmp: document.querySelectorAll('#thread .cmp tbody tr').length, first: document.querySelector('#steps .s').innerText, tm: document.querySelector('#stTm').textContent }));
    check(`${vp} Ask Grok: steps, picks with why, compare, saved-answer label, clock`, res.cards >= 2 && res.pick === 1 && res.cmp === res.cards && /saved answer/.test(res.first) && /done in \d+ s/.test(res.tm), JSON.stringify(res));
    await shot('results', true);
    await common('results');

    // 7) missions (watched hourly by the helper), Meet Grok page, sell page
    await page.goto(SITE + '/missions.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#mlist .mission').length >= 2 && !document.querySelector('#mIntro').innerText.includes('Checking'), null, { timeout: 15000 });
    check(`${vp} missions: reports + hourly line`, /every hour/.test(await page.textContent('#mIntro')) && (await page.$$eval('#mlist .rep', els => els.every(e => /found|watching/.test(e.innerText)))));
    await shot('missions');
    await page.goto(SITE + '/about.html', { waitUntil: 'networkidle' }); await page.waitForSelector('#winThread .pcard', { timeout: 20000 });
    check(`${vp} Meet Grok page: app window, 7 mission chips`, (await page.$$('#jobChips .chip')).length === 7);
    await common('about');
    await page.goto(SITE + '/sell.html', { waitUntil: 'networkidle' }); await page.waitForSelector('#sellCard .pcard');
    await page.fill('#applyForm input[name=store]', 'qa-' + vp + '.myshopify.com'); await page.click('#applyGo'); await page.waitForSelector('#applyDone:not([hidden])', { timeout: 15000 });
    check(`${vp} sell page: merchant request saved`, (await page.textContent('#applyDone')).includes('is on the list'));

    for (const pg of ['privacy', 'terms']) { await page.goto(SITE + '/' + pg + '.html', { waitUntil: 'networkidle' }); check(`${vp} ${pg} page`, (await page.textContent('.legal-page h1')).length > 3); await common(pg); }
    await page.goto(SITE + '/index.html', { waitUntil: 'domcontentloaded' });
    check(`${vp} link preview + icon tags`, await page.evaluate(() => !!document.querySelector('meta[property="og:image"][content$="og.jpg"]') && !!document.querySelector('meta[name="twitter:card"][content="summary_large_image"]') && !!document.querySelector('link[rel=icon]')));

    // 8) X: preview switch (keys not set locally), then a signed-in test session
    await page.goto(SITE + '/product.html?id=107', { waitUntil: 'networkidle' }); await page.waitForSelector('.buy');
    // X sign-in is on: the button goes to x.com's own consent screen (not followed further: that is the owner's account)
    await page.route('https://x.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>x consent</title>' }));
    await page.click('#xin'); await page.waitForSelector('#gow');
    check(`${vp} sign-in sheet offers X and a wallet`, /Connect a wallet/.test(await page.evaluate(() => document.querySelector('.sheet .panel').innerText)));
    await Promise.all([page.waitForURL(/x\.com\/i\/oauth2\/authorize/, { timeout: 15000 }), page.click('#gox')]);
    const xu = new URL(page.url());
    check(`${vp} Sign in with X goes to X's consent screen (read-only scopes, PKCE)`, xu.searchParams.get('scope') === 'users.read tweet.read' && xu.searchParams.get('code_challenge_method') === 'S256' && !!xu.searchParams.get('client_id'), xu.searchParams.get('redirect_uri'));
    await page.unroute('https://x.com/**');
    await page.goto(SITE + '/product.html?id=107', { waitUntil: 'networkidle' }); await page.evaluate(() => localStorage.setItem('gz.xpremium', 'true'));
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.buy');
    check(`${vp} X Premium preview flips the delivery line to free`, /FREE X fast delivery/.test(await page.textContent('.buy .dl')));
    await page.evaluate(() => localStorage.removeItem('gz.xpremium'));
    const sid = await page.evaluate(a => fetch(a + '/auth/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'Premium' }) }).then(r => r.json()).then(j => j.sid), API);
    await page.goto(SITE + '/product.html?id=107&from=x#gzs=' + sid, { waitUntil: 'networkidle' }); await page.waitForSelector('.buy'); await page.waitForTimeout(800);
    const si = await page.evaluate(() => ({ acct: document.querySelector('#xin').innerText, hash: location.hash, dl: document.querySelector('.buy .dl').innerText }));
    check(`${vp} signed in with X: @handle in the top bar, real plan gives free X fast delivery`, /@grokazon_qa/.test(si.acct) && !si.hash && /FREE X fast delivery/.test(si.dl), JSON.stringify(si));
    await shot('signed-in');
    await page.click('#xin'); await page.waitForSelector('#xout'); await page.click('#xout'); await page.waitForTimeout(300);
    check(`${vp} sign out shows Sign in with the X logo`, /Sign in with/.test(await page.textContent('#xin')) && !!(await page.$('#xin .xlogo')));

    if (LIVE && vp === 'desktop') {
      await page.goto(SITE + '/results.html?q=' + encodeURIComponent('a gift under $50 for someone who likes fragrance, fast'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#addAll, #watchIt', { timeout: 90000 });
      const lv = await page.evaluate(() => ({ cards: document.querySelectorAll('#thread .pcard').length, by: (document.querySelector('#thread').innerText.match(/answered by [^\n]+/) || [''])[0] }));
      check('desktop Ask Grok (live /ask): model answer with cards', lv.cards >= 1 && /answered by/.test(lv.by), JSON.stringify(lv));
      const before = errs.length;
      await page.route('**/config.js*', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()) + "\nwindow.GZ_CONFIG.API='http://127.0.0.1:9';" }); });
      await page.goto(SITE + '/results.html?q=' + encodeURIComponent('a phone case'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#addAll', { timeout: 30000 });
      check('desktop Ask Grok (helper down): saved answer and says so', /helper is offline/.test(await page.textContent('#steps .s')));
      await page.unroute('**/config.js*'); errs.splice(before);
    }
    await ctx.close();
  }
  check('zero console errors', errs.length === 0, errs.slice(0, 6).join(' | '));
  await browser.close();
  console.log((pass ? 'ALL PASS ' : 'SOME FAILED ') + n + ' checks; shots in ' + out);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
