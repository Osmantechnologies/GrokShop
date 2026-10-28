// Link-preview card (1200x630) + tab icons, from real pieces only: a screenshot of the live store page, the generated
// bot glyph and the wordmark/headline in Inter. node grokazon/video/make-og.cjs  -> assets/og.jpg, favicon.png, apple-touch-icon.png
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const A = path.join(__dirname, '..', 'assets');
const b64 = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch();
  // 1) a real screenshot of the store (local site, latest code)
  const s = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles', locale: 'en-US' })).newPage();
  await s.goto('http://localhost:5445/index.html', { waitUntil: 'networkidle' }); await s.waitForSelector('#rows .tile'); await s.waitForTimeout(600);
  const shotFile = path.join(__dirname, 'out', 'og-store.png'); fs.mkdirSync(path.dirname(shotFile), { recursive: true });
  await s.screenshot({ path: shotFile });
  // 2) the card
  const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  const glyph = b64(path.join(A, 'glyph.webp'), 'image/webp'), shot = b64(shotFile, 'image/png');
  await p.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff;overflow:hidden;position:relative}
  .shot{position:absolute;right:-90px;top:70px;width:760px;border-radius:18px;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 90px rgba(0,0,0,.7)}
  .fade{position:absolute;inset:0;background:linear-gradient(90deg,#0A0A0A 38%,rgba(10,10,10,.6) 62%,rgba(10,10,10,0) 85%)}
  .t{position:absolute;left:70px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:22px;width:500px}
  .mark{font-size:68px;font-weight:600;letter-spacing:-2px;display:flex;align-items:center}.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
  h1{font-size:54px;line-height:1.05;font-weight:500;letter-spacing:-1px}p{font-size:25px;color:#9aa0a6;line-height:1.3}
  .u{font-size:24px;color:#4AD8EC;font-family:ui-monospace,monospace}</style></head><body>
  <img class="shot" src="${shot}"><div class="fade"></div>
  <div class="t"><div class="mark">gr<img src="${glyph}">kshop</div><h1>Don't shop.<br>Send Grok.</h1><p>The everything store with Grok built in. Fast delivery included with X.</p><div class="u">grokazon.app</div></div>
  </body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(A, 'og.jpg'), type: 'jpeg', quality: 88 });
  await b.close();
  console.log('og.jpg', fs.statSync(path.join(A, 'og.jpg')).size);
})();
