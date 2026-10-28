// "Real products soon" image (1600x900): the live store grid (real screenshot of grokazon.app, softened) behind the
// announcement. node grokazon/video/make-soon.cjs -> social/real-soon.jpg
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'soon'); fs.mkdirSync(OUT, { recursive: true });
const b64 = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles', locale: 'en-US' })).newPage();
  await p.goto('https://grokazon.app/search.html?deals=1', { waitUntil: 'networkidle' }); await p.waitForSelector('#grid .tile');
  await p.evaluate(() => window.scrollTo(0, 120)); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, 'grid.png') });
  const glyph = b64(path.join(__dirname, '..', 'assets', 'glyph.webp'), 'image/webp');
  const c = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await c.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
  <style>*{margin:0;box-sizing:border-box}body{width:1600px;height:900px;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff;overflow:hidden;position:relative}
  .bg{position:absolute;inset:-30px;background:url(${b64(path.join(OUT, 'grid.png'), 'image/png')}) center/cover;filter:blur(7px) saturate(.9);opacity:.55}
  .shade{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(10,10,10,.55) 0%,rgba(10,10,10,.92) 70%)}
  .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;text-align:center}
  .mark{font-size:64px;font-weight:600;letter-spacing:-2px;display:flex;align-items:center}.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
  h1{font-size:92px;font-weight:500;letter-spacing:-2.5px;line-height:1}p{font-size:30px;color:#D5D9E2;max-width:980px;line-height:1.35}
  .pill{font-family:'Geist Mono',monospace;font-size:26px;color:#000;background:#4AD8EC;border-radius:9999px;padding:14px 28px}
  .x{font-size:22px;color:#9aa0a6}</style></head><body><div class="bg"></div><div class="shade"></div>
  <div class="t"><div class="mark">gr<img src="${glyph}">kshop</div><h1>Real products, soon.</h1>
  <p>We're onboarding the first real sellers now. Have something to sell? List it on Grokshop and let Grok bring you buyers.</p>
  <div class="pill">grokazon.app/seller.html</div><div class="x">@AdeliaCmartins</div></div></body></html>`, { waitUntil: 'networkidle' });
  await c.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, '..', 'social', 'real-soon.jpg');
  await c.screenshot({ path: out, type: 'jpeg', quality: 90 });
  await b.close(); console.log('real-soon.jpg', fs.statSync(out).size);
})();
