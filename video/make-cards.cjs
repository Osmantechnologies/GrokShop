// Renders the video's text cards as 1920x1080 PNGs with the site's own font (Inter) and the generated bot glyph:
// opener + closer (solid), and one numbered lower-third caption per tour step (transparent). node grokazon/video/make-cards.cjs
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'cards'); fs.mkdirSync(OUT, { recursive: true });
const GLYPH = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'glyph.webp')).toString('base64');
const STEPS = {
  store: 'An everything store with Grok built in.',
  ask: 'Tell Grok what you need. It shops every seller and shows why.',
  product: 'Fast delivery, free with your X subscription.',
  cart: 'One cart across sellers. One checkout.',
  returns: 'Returns, handled by a Grok Bot.',
  seller: 'Anyone can sell. Every listing is reviewed.',
  thread: 'Named in one thread on X.'
};
const css = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}html,body{width:1920px;height:1080px;font-family:Inter,sans-serif;color:#fff}
.full{background:#0A0A0A;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;text-align:center}
.mark{font-size:120px;font-weight:600;letter-spacing:-3px;display:flex;align-items:center}
.mark img{width:.74em;height:.74em;border-radius:50%;margin:0 .03em}
.big{font-size:64px;font-weight:500;letter-spacing:-1px}.sub{font-size:34px;color:#7D8187}
.url{font-family:'Geist Mono',monospace;font-size:38px;color:#4AD8EC}
.lt{position:absolute;left:64px;bottom:64px;display:flex;align-items:center;gap:22px;padding:22px 34px 22px 22px;border-radius:9999px;background:rgba(10,10,10,.86);border:1px solid rgba(255,255,255,.14);box-shadow:0 20px 60px rgba(0,0,0,.5);font-size:36px;font-weight:500;letter-spacing:-.3px}
.lt b{font-family:'Geist Mono',monospace;font-weight:500;font-size:28px;color:#000;background:#4AD8EC;border-radius:9999px;padding:8px 16px}
.lt img{width:46px;height:46px;border-radius:50%}</style>`;
const mark = `<div class="mark">gr<img src="${GLYPH}">kazon</div>`;
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const shoot = async (name, body, transparent) => {
    await p.setContent(`<!doctype html><html><head>${css}</head><body style="background:${transparent ? 'transparent' : '#0A0A0A'}">${body}</body></html>`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, name + '.png'), omitBackground: !!transparent });
  };
  await shoot('opener', `<div class="full">${mark}<div class="big">Amazon is blocking Grok Bots.</div><div class="sub">So here is a store built for them.</div></div>`);
  await shoot('closer', `<div class="full">${mark}<div class="big">Don't shop. Send Grok.</div><div class="url">grokazon.app</div><div class="sub">@grokazonapp</div></div>`);
  let i = 1;
  for (const [id, text] of Object.entries(STEPS)) await shoot('lt-' + id, `<div class="lt"><img src="${GLYPH}"><b>${String(i++).padStart(2, '0')}</b>${text}</div>`, true);
  await b.close(); console.log('cards', fs.readdirSync(OUT).join(' '));
})();
