// Records the Grokazon demo tour headlessly (no visible window): node grokazon/video/record.cjs
// Product-demo recipe: Playwright + CDP screencast at 1600x900 x1.2 (= 1920x1080 frames), a drawn-in cursor + click ring,
// a 1px ticker so holds get frames. The local site (latest code) talks to the LIVE helper (real Grok, real catalogue).
// Writes video/out/frames/*.jpg + frames.txt (ffmpeg concat with real durations) + marks.json (caption windows) +
// cleanup.json (the test order / browser id to delete from live storage afterwards).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out'), FR = path.join(OUT, 'frames');
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const SITE = 'http://localhost:5445', LIVE_API = 'https://grokshop-api.YOUR-ACCOUNT.workers.dev';
const Q = 'Find me the best wireless headphones under $150, delivered this week.';

(async () => {
  // pre-warm Grok's answer so the tour shows a fresh live answer without a long wait
  await fetch(LIVE_API + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ q: Q }) }).then(r => r.json()).then(j => console.log('prewarm', j.engine, (j.picks || []).length)).catch(e => console.log('prewarm failed', e.message));
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  const page = await ctx.newPage();
  await page.route('**/config.js*', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()) + "\nwindow.GZ_CONFIG.API='" + LIVE_API + "';" }); });
  await page.addInitScript(() => {
    try { localStorage.setItem('gz.seeded', 'true'); } catch (e) { }   // no example missions synced to the live server
    addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div'); c.id = '__cur';
      c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);transition:none';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      const t = document.createElement('div'); t.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:99999;pointer-events:none'; document.body.appendChild(t);
      let k = 0; setInterval(() => { t.style.background = (k++ % 2) ? 'rgba(0,0,0,.01)' : 'rgba(0,0,0,.02)'; }, 50);
      const p = JSON.parse(sessionStorage.getItem('__cur') || '[800,450]'); c.style.left = p[0] + 'px'; c.style.top = p[1] + 'px';
    });
    window.__move = (x, y) => { const c = document.getElementById('__cur'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; } sessionStorage.setItem('__cur', JSON.stringify([x, y])); };
    window.__ring = (x, y) => { const r = document.createElement('div'); r.style.cssText = `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #4AD8EC;z-index:99998;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`; document.body.appendChild(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 500); };
  });

  // screencast
  const cdp = await ctx.newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const i = frames.length; fs.writeFileSync(path.join(FR, String(i).padStart(5, '0') + '.jpg'), Buffer.from(f.data, 'base64'));
    frames.push(f.metadata.timestamp); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => { });
  });
  let cur = [800, 450], t0 = 0;
  const marks = [], mark = (id) => marks.push({ id, t: frames.length ? frames[frames.length - 1] - t0 : 0 });
  const wait = (ms) => page.waitForTimeout(ms);
  const glide = async (x, y, ms = 650) => {
    const steps = Math.max(8, Math.round(ms / 33)), [sx, sy] = cur;
    for (let i = 1; i <= steps; i++) { const e = i / steps, k = e < .5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2; const px = sx + (x - sx) * k, py = sy + (y - sy) * k; await page.mouse.move(px, py); await page.evaluate(([a, b]) => window.__move(a, b), [px, py]); await wait(ms / steps); }
    cur = [x, y];
  };
  const at = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const click = async (sel, ms) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await at(sel); await glide(x, y, ms); await page.evaluate(([a, b]) => window.__ring(a, b), [x, y]); await wait(160); await page.locator(sel).first().click(); };
  const scrollBy = async (dy, ms = 1400) => { const steps = Math.round(ms / 33); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await wait(ms / steps); } };

  await page.goto(SITE + '/index.html', { waitUntil: 'networkidle' }); await page.waitForSelector('#rows .tile'); await wait(800);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await wait(300); t0 = frames[0] || 0;

  // 1) the store
  mark('store'); await wait(1600);
  await glide(560, 620, 900); await scrollBy(700, 1600); await wait(900); await scrollBy(-700, 1100); await wait(300);
  // 2) tell Grok
  mark('ask');
  await click('#q', 800); await page.keyboard.type(Q, { delay: 34 }); await wait(500);
  await click('#heroForm .go', 500);
  await page.waitForURL(/results\.html/); await page.waitForSelector('#addAll', { timeout: 60000 }); await wait(900);
  await glide(900, 520, 600); await scrollBy(900, 2200); await wait(1500); await scrollBy(500, 1200); await wait(1500);
  // 3) the pick -> product page
  mark('product');
  await click('#thread .pcard.is-pick .ti', 900); await page.waitForSelector('.buy'); await wait(1800);
  await click('#addc', 800); await wait(900);
  // 4) one cart, one checkout
  mark('cart');
  await click('.cartb', 800); await page.waitForSelector('#checkout'); await wait(1500);
  await click('#checkout', 800); await page.waitForURL(/order\.html\?id=GZ-/, { timeout: 30000 }); await page.waitForSelector('.ord'); await wait(2200);
  const orderId = new URL(page.url()).searchParams.get('id');
  // 5) returns by a Grok Bot
  mark('returns');
  await click('.belt .orders', 800); await page.waitForSelector('[data-ret]'); await wait(900);
  await click('[data-ret]', 800); await wait(700); await click('[data-why="Changed my mind"]', 700);
  await page.waitForFunction(() => /return started/.test(document.querySelector('#olist').innerText), null, { timeout: 20000 }); await wait(2200);
  // 6) sellers
  mark('seller');
  await click('.strip a[href="seller.html"]', 900); await page.waitForSelector('#lForm'); await wait(700);
  await click('#lForm [name=title]', 600); await page.keyboard.type('Walnut desk organiser, 3 trays', { delay: 40 }); await wait(1600);
  // 7) the thread that named it
  mark('thread');
  await click('.belt .mark', 800); await page.waitForSelector('#rows .tile'); await wait(500);
  await page.evaluate(() => document.querySelector('#thread').scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(4200);
  mark('end');
  await cdp.send('Page.stopScreencast'); await wait(200);

  const device = await page.evaluate(() => JSON.parse(localStorage.getItem('gz.device') || '""'));
  fs.writeFileSync(path.join(OUT, 'cleanup.json'), JSON.stringify({ order: orderId, device }, null, 2));
  // ffmpeg concat list with the real gaps between frames
  const lines = [];
  frames.forEach((ts, i) => { const d = (frames[i + 1] != null ? frames[i + 1] - ts : 1 / 30); lines.push(`file 'frames/${String(i).padStart(5, '0')}.jpg'`, `duration ${Math.max(0.001, d).toFixed(4)}`); });
  lines.push(`file 'frames/${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
  console.log('frames', frames.length, 'length', (frames[frames.length - 1] - t0).toFixed(1) + 's', 'order', orderId);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
