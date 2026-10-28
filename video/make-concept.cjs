// Image for the "concept, and we're shipping" post (1600x900): three real screenshots of the LIVE grokazon.app (read only:
// the cart is filled in this headless browser only; no order is placed) under Live now / Still a demo / Next.
// node grokazon/video/make-concept.cjs -> social/concept.jpg
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'concept'); fs.mkdirSync(OUT, { recursive: true });
const SITE = 'https://grokazon.app', Q = 'Find me the best wireless headphones under $150, delivered this week.';
const b64 = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 960, height: 856 }, deviceScaleFactor: 1.6, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  const p = await ctx.newPage();
  // live: Grok's pick with the why
  await p.goto(SITE + '/results.html?q=' + encodeURIComponent(Q), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#addAll', { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#thread .pcard.is-pick').scrollIntoView({ block: 'center' })); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'live.png') });
  // still a demo: the cart's test-checkout note (cart filled in this browser only)
  await p.goto(SITE + '/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('gz.cart', JSON.stringify([{ id: 107, qty: 1 }, { id: 's-audio-3106', qty: 1 }])));
  await p.goto(SITE + '/cart.html', { waitUntil: 'networkidle' }); await p.waitForSelector('.testnote'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'demo.png') });
  // next: real sellers (Seller Central)
  await p.goto(SITE + '/seller.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'next.png') });
  const glyph = b64(path.join(__dirname, '..', 'assets', 'glyph.webp'), 'image/webp');
  const cols = [
    ['live', 'Live now', '#1F8A65', ['Grok shops and explains every pick', 'Sign in with X', 'Missions check every hour', 'Returns handled by a Grok Bot', 'Seller Central + verified reviews']],
    ['demo', 'Still a demo', '#F4B942', ['Sample catalogue + Shopify test stores', 'Checkout in test mode', 'Nothing is charged, nothing ships']],
    ['next', 'Next', '#4AD8EC', ['The first real sellers', 'Live payments', 'Sellers paid out automatically']]
  ];
  const c = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await c.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
  <style>*{margin:0;box-sizing:border-box}body{width:1600px;height:900px;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff;padding:30px 40px;overflow:hidden}
  .top{display:flex;align-items:center;justify-content:space-between;height:60px;margin-bottom:20px}.mark{font-size:46px;font-weight:600;letter-spacing:-1.4px;display:flex;align-items:center}.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
  .ttl{font-size:30px;font-weight:500;color:#D5D9E2}.url{font-family:'Geist Mono',monospace;font-size:24px;color:#4AD8EC}
  .cols{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.col{background:#161616;border:1px solid rgba(255,255,255,.12);border-radius:18px;overflow:hidden;height:760px;display:flex;flex-direction:column}
  .col img{width:100%;height:440px;object-fit:cover;object-position:left top;display:block;border-bottom:1px solid rgba(255,255,255,.1)}
  .bd{padding:22px 24px;display:flex;flex-direction:column;gap:14px}.lab{display:inline-flex;align-self:flex-start;align-items:center;gap:10px;font-size:22px;font-weight:600;padding:8px 16px;border-radius:9999px;background:rgba(255,255,255,.06)}
  .lab i{width:12px;height:12px;border-radius:50%;display:block}ul{list-style:none;display:flex;flex-direction:column;gap:10px;font-size:21px;color:#D5D9E2;line-height:1.25}li::before{content:'\\2014  ';color:#555}</style></head><body>
  <div class="top"><div class="mark">gr<img src="${glyph}">kshop</div><div class="ttl">A concept, shipping in public</div><div class="url">grokazon.app</div></div>
  <div class="cols">${cols.map(k => `<div class="col"><img src="${b64(path.join(OUT, k[0] + '.png'), 'image/png')}"><div class="bd"><span class="lab"><i style="background:${k[2]}"></i>${k[1]}</span><ul>${k[3].map(x => '<li>' + x + '</li>').join('')}</ul></div></div>`).join('')}</div>
  </body></html>`, { waitUntil: 'networkidle' });
  await c.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, '..', 'social', 'concept.jpg');
  await c.screenshot({ path: out, type: 'jpeg', quality: 90 });
  await b.close(); console.log('concept.jpg', fs.statSync(out).size);
})();
