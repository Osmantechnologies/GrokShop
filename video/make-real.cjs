// Image for the v0.8.0 post (1600x900): three real screenshots of the LIVE grokazon.app: a product with its real-listing
// link, the Grokshop checkout page, and Stripe's payment page in TEST mode (the preview order it creates is paid with
// Stripe's published test card; nothing is charged). node grokazon/video/make-real.cjs -> social/real.jpg
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'real'); fs.mkdirSync(OUT, { recursive: true });
const SITE = 'https://grokazon.app';
const b64 = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 960, height: 856 }, deviceScaleFactor: 1.6, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  const p = await ctx.newPage();
  // 1) a product with its reference link (AirPods Max -> the same product at a real store)
  await p.goto(SITE + '/product.html?id=101', { waitUntil: 'networkidle' }); await p.waitForSelector('.refl'); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('.buy').scrollIntoView({ block: 'start' })); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'ref.png') });
  // 2) checkout on Grokshop, address typed
  await p.evaluate(() => localStorage.setItem('gz.cart', JSON.stringify([{ id: 107, qty: 1 }])));
  await p.goto(SITE + '/checkout.html', { waitUntil: 'networkidle' }); await p.waitForSelector('#ksum .qt', { timeout: 15000 }); await p.waitForTimeout(400);
  await p.fill('input[name=name]', 'Sam Rivera'); await p.fill('input[name=line1]', '200 E Randolph St'); await p.fill('input[name=city]', 'Chicago'); await p.fill('input[name=state]', 'IL'); await p.fill('input[name=zip]', '60601');
  await p.screenshot({ path: path.join(OUT, 'checkout.png') });
  // 3) Stripe's payment page (test mode)
  await p.click('#place'); await p.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }); await p.waitForSelector('#cardNumber', { timeout: 45000 }); await p.waitForTimeout(1500);
  await p.fill('#cardNumber', '4242424242424242'); await p.fill('#cardExpiry', '12 / 34'); await p.fill('#cardCvc', '123'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'stripe.png') });
  const glyph = b64(path.join(__dirname, '..', 'assets', 'glyph.webp'), 'image/webp');
  const cols = [
    ['ref', 'Real products', ['Every item points at a real listing', 'Real price, checked the same day', 'Same product, or the closest one sold today']],
    ['checkout', 'Real checkout', ['Address, delivery dates, order total', 'One checkout across every seller', 'Your address carries over to payment']],
    ['stripe', 'Real payment page', ['Stripe handles the card, never Grokshop', 'Test mode for now: nothing is charged', 'Live payments when the first sellers are paid out']]
  ];
  const c = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await c.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
  <style>*{margin:0;box-sizing:border-box}body{width:1600px;height:900px;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff;padding:30px 40px;overflow:hidden}
  .top{display:flex;align-items:center;justify-content:space-between;height:60px;margin-bottom:20px}.mark{font-size:46px;font-weight:600;letter-spacing:-1.4px;display:flex;align-items:center}.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
  .ttl{font-size:30px;font-weight:500;color:#D5D9E2}.url{font-family:'Geist Mono',monospace;font-size:24px;color:#4AD8EC}
  .cols{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.col{background:#161616;border:1px solid rgba(255,255,255,.12);border-radius:18px;overflow:hidden;height:760px;display:flex;flex-direction:column}
  .col img{width:100%;height:470px;object-fit:cover;object-position:left top;display:block;border-bottom:1px solid rgba(255,255,255,.1)}
  .bd{padding:20px 24px;display:flex;flex-direction:column;gap:12px}.lab{font-size:24px;font-weight:600}
  ul{list-style:none;display:flex;flex-direction:column;gap:9px;font-size:20px;color:#D5D9E2;line-height:1.3}li::before{content:'\\2014  ';color:#555}</style></head><body>
  <div class="top"><div class="mark">gr<img src="${glyph}">kshop</div><div class="ttl">v0.8: real products, real checkout</div><div class="url">grokazon.app</div></div>
  <div class="cols">${cols.map(k => `<div class="col"><img src="${b64(path.join(OUT, k[0] + '.png'), 'image/png')}"><div class="bd"><div class="lab">${k[1]}</div><ul>${k[2].map(x => '<li>' + x + '</li>').join('')}</ul></div></div>`).join('')}</div>
  </body></html>`, { waitUntil: 'networkidle' });
  await c.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, '..', 'social', 'real.jpg');
  await c.screenshot({ path: out, type: 'jpeg', quality: 90 });
  await b.close(); console.log('real.jpg', fs.statSync(out).size);
})();
