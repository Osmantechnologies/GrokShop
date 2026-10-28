// Tutorial image for X (1600x900): four real screenshots of the LIVE grokazon.app (read only: no order, no sign-in, no
// listing is created) in a 2x2 grid with numbered steps. node grokazon/video/make-tutorial.cjs -> social/tutorial.jpg
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'tut'); fs.mkdirSync(OUT, { recursive: true });
const SITE = 'https://grokazon.app';
const Q = 'Find me the best wireless headphones under $150, delivered this week.';
const b64 = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  const p = await ctx.newPage();
  const shot = (n, clip) => p.screenshot({ path: path.join(OUT, n + '.png'), clip });
  // 1) the store, with Sign in with X top right
  await p.goto(SITE + '/index.html', { waitUntil: 'networkidle' }); await p.waitForSelector('#rows .tile'); await p.waitForTimeout(500);
  await shot('1', { x: 560, y: 0, width: 720, height: 405 });   // the top bar: search, Hello sign in with X, Returns, Cart
  // 2) telling Grok what you need
  await p.fill('#q', Q); await p.waitForTimeout(200);
  await shot('2', { x: 20, y: 150, width: 720, height: 405 });   // the Grok bar with the question typed
  // 3) Grok's picks with the why
  await p.goto(SITE + '/results.html?q=' + encodeURIComponent(Q), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#addAll', { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const c = document.querySelector('#thread .pcard.is-pick'); c.scrollIntoView({ block: 'center' }); });
  await p.waitForTimeout(500); await shot('3', { x: 0, y: 0, width: 1280, height: 720 });
  // 4) missions that keep watching (the new-mission sheet over the missions page)
  await p.goto(SITE + '/missions.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.click('[data-newmission]'); await p.fill('#mf input[name=what]', 'Sony headphones under $100'); await p.fill('#mf input[name=budget]', '100'); await p.waitForTimeout(300);
  await shot('4', { x: 0, y: 0, width: 1280, height: 720 });
  // the card
  const glyph = b64(path.join(__dirname, '..', 'assets', 'glyph.webp'), 'image/webp');
  const steps = [['1', 'Sign in with X', 'Your X plan unlocks free X fast delivery.'], ['2', 'Tell Grok what you need', 'What it is, your budget, when you need it.'],
    ['3', 'Grok shops every seller', 'Picks come with the why, side by side.'], ['4', 'Give Grok a mission', 'It keeps watching for the right price.']];
  const c = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await c.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
  <style>*{margin:0;box-sizing:border-box}body{width:1600px;height:900px;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff;padding:26px 40px;overflow:hidden}
  .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;height:54px}.mark{font-size:44px;font-weight:600;letter-spacing:-1.4px;display:flex;align-items:center}.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
  .ttl{font-size:30px;font-weight:500;color:#D5D9E2}.url{font-family:'Geist Mono',monospace;font-size:24px;color:#4AD8EC}
  .grid{display:grid;grid-template-columns:672px 672px;gap:18px;justify-content:center}.cell{border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#161616;height:378px;display:flex;flex-direction:column}
  .cell img.s{width:100%;height:302px;object-fit:cover;object-position:top;display:block;border-bottom:1px solid rgba(255,255,255,.1)}
  .cap{flex:1;display:flex;align-items:center;gap:14px;padding:0 18px}
  .cap b{font-family:'Geist Mono',monospace;font-size:20px;color:#000;background:#4AD8EC;border-radius:9999px;width:36px;height:36px;display:grid;place-items:center;flex:none}
  .cap .h{font-size:21px;font-weight:600}.cap .d{font-size:16px;color:#9aa0a6}</style></head><body>
  <div class="top"><div class="mark">gr<img src="${glyph}">kazon</div><div class="ttl">How to shop with Grok in 4 steps</div><div class="url">grokazon.app</div></div>
  <div class="grid">${steps.map(s => `<div class="cell"><img class="s" src="${b64(path.join(OUT, s[0] + '.png'), 'image/png')}"><div class="cap"><b>${s[0]}</b><div><div class="h">${s[1]}</div><div class="d">${s[2]}</div></div></div></div>`).join('')}</div>
  </body></html>`, { waitUntil: 'networkidle' });
  await c.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, '..', 'social', 'tutorial.jpg');
  await c.screenshot({ path: out, type: 'jpeg', quality: 90 });
  await b.close(); console.log('tutorial.jpg', fs.statSync(out).size);
})();
