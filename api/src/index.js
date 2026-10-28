// GROKSHOP helper (Cloudflare Worker). Routes:
//   GET  /health            what is wired (model, engine, fixture)
//   POST /ask {q}           filter the catalogue in code, then ONE model call -> {thread, picks, compare, note}
//   POST /ask?fixture=1     the saved headphones answer (no model spend)
//   GET  /match?q=          the filter only, no model (missions use it to report "best so far")
//   POST /missions {device, missions}   sync this browser's missions; GET /missions?device= their reports
//   POST /merchants/apply {store, x, note}  a store asks to join (no tokens or passwords are ever asked for)
//   GET  /catalogue         the merged catalogue the site shows: Shopify stores (Storefront API) + the demo catalogue
//   POST /checkout {lines:[{id,qty}]}  a real cart at that Shopify store -> {url} of its own checkout
//   GET  /auth/x/start?return=  /auth/x/callback   Sign in with X (xauth.js); GET /me, POST /auth/logout
//   POST /auth/wallet/nonce {address}  POST /auth/wallet/verify {address, signature, message}   Sign in with a Solana wallet (wallet.js)
//   store (store.js)        POST /orders/checkout, GET /orders, /orders/confirm, POST /orders/return,
//                           POST|GET /seller/listings, POST /seller/shopify, GET /img/<id>, admin /admin/queue + /admin/decide
//   cron (hourly)           re-check every due mission, no model call (see missions.js); top up the CJ US-warehouse shelf
//                           and copy CJ tracking onto orders (cj.js)
import { matchCatalogue, slim, trustLine, merchantOf } from './match.js';
import FIXTURE from '../fixtures/headphones.json';
import REFS from '../data/refs.json';   // id -> a real listing of the same (or a comparable) product, checked by hand-run research (docs/REAL-PRODUCTS-NOW.md)
import { syncMissions, getMissions, runAll, kv, originOk } from './missions.js';
import { listShops, shopProducts, createCheckout } from './shopify.js';
import { xReady, start as xStart, callback as xCallback, sessionOf, logout, testSession } from './xauth.js';
import { nonce as walletNonce, verify as walletVerify } from './wallet.js';
import { ownerKey, checkout, confirm, listOrders, requestReturn, createListing, myListings, requestShopify, approvedListings, image, isAdmin, queue, decide, quoteFor, sellerOrders, markShipped, addReview, allReviews } from './store.js';
import { bump, flush, recent } from './stats.js';
import { payoutStatus, startPayouts, payoutDashboard } from './payouts.js';
import { ebayMode, searchEbay, ebayItem } from './ebay.js';
import { cjMode, shelf as cjShelf, refreshShelf, syncCjOrders } from './cj.js';

const MEM = new Map();          // 12 h answer cache + per-IP counters (per isolate; slice 2 moves this to KV)
const TTL = 12 * 3600 * 1000;
let CAT = null, CAT_AT = 0;

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allow = String(env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = !origin || originOk(env, origin);
  return { 'Access-Control-Allow-Origin': ok ? (origin || '*') : 'null', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type, authorization, x-gz-device, x-admin-token', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const json = (o, status, h) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...(h || {}), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// departments, like Amazon's: from the demo category, the Shopify store, or the seller's own choice
const DEPT_OF = { smartphones: 'electronics', laptops: 'electronics', tablets: 'electronics', 'mobile-accessories': 'electronics', furniture: 'home', 'home-decoration': 'home', 'kitchen-accessories': 'home',
  groceries: 'grocery', beauty: 'beauty', fragrances: 'beauty', 'skin-care': 'beauty', tops: 'fashion', sunglasses: 'fashion', 'sports-accessories': 'sports', motorcycle: 'motors', vehicle: 'motors' };
const SHOP_DEPT = { audio: 'electronics', gadgets: 'electronics', coffee: 'grocery', furniture: 'home' };
function deptOf(p) {
  if (p.dept) return p.dept;
  if (p.source === 'shopify') return SHOP_DEPT[p.shop] || 'other';
  return DEPT_OF[p.category] || (/^(mens|womens)-/.test(p.category) ? 'fashion' : 'other');
}
let BASE = '';

// the catalogue = approved seller listings + Grokshop's US-warehouse shelf (CJ) + every connected Shopify store + the demo catalogue (DummyJSON),
// refreshed every 30 min per isolate.
// A store that fails to answer is skipped for that round (logged), never invented.
let SHOP_INFO = [], CJ_COUNT = 0;
async function catalogue(env) {
  if (CAT && Date.now() - CAT_AT < 30 * 60 * 1000) return CAT;
  const demoP = env.DEMO_CATALOGUE === '0' ? Promise.resolve({ products: [] }).then(j => j.products) : fetch(env.CATALOGUE || 'https://dummyjson.com/products?limit=0', { cf: { cacheTtl: 3600 } }).then(r => { if (!r.ok) throw new Error('catalogue answered ' + r.status); return r.json(); })
    .then(j => { const skip = String(env.DEMO_SKIP || '').split(',').map(s => s.trim()).filter(Boolean); return j.products.filter(p => !skip.includes(p.category)).map(p => ({ ...p, source: 'demo', currency: 'USD' })); });
  const shops = await listShops(env);
  const got = await Promise.allSettled(shops.map(s => shopProducts(s)));
  const fromShops = [];
  SHOP_INFO = shops.map((s, i) => {
    const ok = got[i].status === 'fulfilled', ps = ok ? got[i].value : [];
    if (!ok) console.log('shop failed', s.key, String(got[i].reason).slice(0, 200));
    fromShops.push(...ps);
    return { key: s.key, name: ps[0] ? ps[0].merchant : (s.name || s.key), test: !!s.test, products: ps.length, ok };
  });
  const demo = await demoP.catch(e => { if (fromShops.length) return []; throw e; });
  const sellers = await approvedListings(env, env.PUBLIC_API || BASE).catch(() => []);
  const cj = await cjShelf(env).catch(e => { console.log('cj shelf failed', String(e.message || e).slice(0, 160)); return []; });
  CJ_COUNT = cj.length;
  const reviews = await allReviews(env).catch(() => new Map());
  // demo + Shopify test-store products carry a reference link to a real listing; REF_ONLY=1 hides the ones without one,
  // and the real listing's price replaces the sample price
  const withRef = fromShops.concat(demo).map(p => { const r = REFS[String(p.id)]; return r && r.url ? { ...p, ref: r, price: r.price > 0 ? r.price : p.price } : (env.REF_ONLY === '1' ? null : p); }).filter(Boolean);
  CAT = sellers.concat(cj, withRef).map(p => {
    const ours = reviews.get(String(p.id)) || [];
    if (!ours.length) return { ...p, dept: deptOf(p) };
    const all = (p.reviews || []).concat(ours.sort((a, b) => b.date.localeCompare(a.date)));
    return { ...p, dept: deptOf(p), reviews: all, rating: +(all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(2) };
  });
  CAT_AT = Date.now();
  return CAT;
}

function cacheGet(env, k) { const v = MEM.get(k); if (v && Date.now() - v.at < TTL) return v.val; MEM.delete(k); return null; }
function cacheSet(k, val) { MEM.set(k, { at: Date.now(), val }); if (MEM.size > 500) MEM.delete(MEM.keys().next().value); }
function rate(req, env) {
  // through Netlify's /api pass-through the visitor's address arrives in x-nf-client-connection-ip
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('CF-Connecting-IP'); if (!ip) return true;   // local wrangler dev: unlimited
  const k = 'ip:' + new Date().toISOString().slice(0, 10) + ':' + ip, n = (MEM.get(k) || { val: 0 }).val;
  if (n >= parseInt(env.ASK_PER_IP || '20', 10)) return false;
  MEM.set(k, { at: Date.now(), val: n + 1 }); return true;
}

const SYSTEM = `You are Grok, the shopping agent inside Grokshop. A shopper typed a request. You get the candidate products our code already pulled from the merchants' catalogue (real fields only).
Pick up to 3 products that best fit the request: budget first (never pick over budget unless nothing fits, and then say so), then delivery speed if they asked for it, then fit, rating, seller terms (returns, warranty), price.
Reply with ONE JSON object and nothing else:
{"thread": [2-4 short lowercase step lines in Grok Bot's voice that report what you checked, e.g. "beats flex ships in 1-2 business days, airpods in 3-5"],
 "picks": [{"id": <candidate id>, "rank": 1, "why": "one plain sentence, citing real fields (price, shipping, rating, returns)"}],
 "compare": [{"id": <same ids as picks>, "spec": "the one key spec from the description, under 8 words"}],
 "note": "one lowercase closing line, e.g. \\"cart's ready, checkout at beats store when you are\\""}
Rules: use only facts present in the candidate data; never invent specs, counts, prices or delivery dates; ids must be candidate ids; if no candidate fits, return "picks": [] and explain in the thread what to change.`;

function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON in the answer');
  return JSON.parse(s.slice(a, b + 1));
}

async function callModel(env, user) {
  if (env.XAI_API_KEY) {
    try { return await callGrok(env, user); }
    catch (e) { if (!env.ANTHROPIC_API_KEY) throw e; console.log('grok failed, claude backup', String(e.message || e).slice(0, 160)); }
  }
  return callClaude(env, user);
}
async function callGrok(env, user) {
  {   // Grok through xAI's OpenAI-compatible endpoint
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.XAI_API_KEY },
      body: JSON.stringify({ model: env.XAI_MODEL || 'grok-4.3', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], response_format: { type: 'json_object' } })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && (j.error.message || j.error)) || ('xAI answered ' + r.status)); e.status = r.status; throw e; }
    return { text: j.choices[0].message.content, engine: j.model || env.XAI_MODEL || 'grok-4.3' };
  }
}
async function callClaude(env, user) {
  if (!env.ANTHROPIC_API_KEY) { const e = new Error('no model key is set'); e.status = 503; throw e; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ASK_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, output_config: { effort: env.ASK_EFFORT || 'low' }, system: SYSTEM, messages: [{ role: 'user', content: user }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Anthropic answered ' + r.status)); e.status = r.status; throw e; }
  if (j.stop_reason === 'refusal') throw new Error('the model declined this request');
  return { text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), engine: j.model || env.ASK_MODEL };
}

function plainError(e) {
  const raw = String((e && e.message) || e), st = e && e.status;
  if (/credit balance/i.test(raw)) return 'Grok is out of credit right now.';
  if (st === 401 || st === 403) return 'The model key is not accepted.';
  if (st === 429 || st === 529 || /overloaded/i.test(raw)) return 'Grok is busy. Try again in a minute.';
  return 'Grok hit an error: ' + raw.replace(/(sk-ant-|xai-)[A-Za-z0-9_-]+/g, '[key]').slice(0, 140);
}

async function ask(env, q) {
  const products = await catalogue(env);
  const m = matchCatalogue(products, q);
  const cands = m.inBudget.concat(m.over), byId = new Map(cands.map(p => [String(p.id), p]));
  const a = m.ask;
  const lead = [
    'reading your constraints' + (a.max != null ? ': budget $' + a.max : '') + (a.fast ? ', fast delivery' : ''),
    'searching ' + m.merchants + ' sellers' + (CJ_COUNT ? ' and the grokshop us warehouse' : ''),
    m.considered ? 'comparing ' + m.considered + ' matches on price, shipping, seller trust and rating' + (m.over.length && !m.inBudget.length ? ' (none within budget)' : '') : 'no product matches those words'
  ];
  if (!cands.length) return { q, engine: 'filter', thread: lead.concat(['try other words, or a wider budget']), picks: [], compare: [], note: "nothing to cart yet.", considered: 0 };
  const user = 'Shopper request: ' + JSON.stringify(q) + '\nBudget ceiling: ' + (a.max != null ? '$' + a.max : 'none given') + (a.fast ? '\nThey want it fast.' : '') +
    '\nToday: ' + new Date().toISOString().slice(0, 10) + '\nCandidates within budget: ' + JSON.stringify(m.inBudget.map(slim)) + '\nJust over budget (alternatives only): ' + JSON.stringify(m.over.map(slim));
  let out, engine, tries = 0;
  for (;;) {
    const r = await callModel(env, user);
    engine = r.engine;
    try { out = parseJson(r.text); break; } catch (e) { if (++tries > 1) throw e; }
  }
  // keep only real candidates; every number on screen comes from the catalogue, not the model
  const picks = (Array.isArray(out.picks) ? out.picks : []).filter(p => byId.has(String(p.id))).slice(0, 3).map((p, i) => { const x = byId.get(String(p.id)); return { id: x.id, rank: i + 1, why: String(p.why || '').slice(0, 240) }; });
  const specOf = new Map((Array.isArray(out.compare) ? out.compare : []).map(c => [String(c.id), String(c.spec || '').slice(0, 80)]));
  const compare = picks.map(p => { const x = byId.get(String(p.id)); return { id: p.id, merchant: merchantOf(x), price: '$' + x.price.toFixed(2), delivery: x.shippingInformation || 'set by the store at checkout', trust: trustLine(x), spec: specOf.get(String(p.id)) || '' }; });
  const thread = lead.concat((Array.isArray(out.thread) ? out.thread : []).map(s => String(s).slice(0, 160)).slice(0, 4), [picks.length + (picks.length === 1 ? ' pick' : ' picks')]);
  return { q, engine, thread, picks, compare, note: String(out.note || '').slice(0, 160), considered: m.considered };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), h = cors(req, env);
    if (!BASE) BASE = url.origin;   // where seller photos are served from (/img/<id>)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    try {
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
        return json({ ok: true, service: 'grokazon-api', engine: env.XAI_API_KEY ? (env.XAI_MODEL || 'grok-4.3') : (env.ANTHROPIC_API_KEY ? (env.ASK_MODEL || 'claude-sonnet-5-5') : 'none'), fixture: env.ALLOW_FIXTURE === '1', xLogin: xReady(env), payments: env.STRIPE_SECRET_KEY ? (/^sk_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'test') : 'off', review: !!env.ADMIN_TOKEN, tax: env.STRIPE_TAX === '1', ebay: ebayMode(env), cj: cjMode(env), demo: env.DEMO_CATALOGUE !== '0' }, 200, { ...h, 'Access-Control-Allow-Origin': '*' });
      }
      if (req.method === 'GET' && url.pathname === '/match') {
        const q = (url.searchParams.get('q') || '').slice(0, 300); if (!q.trim()) return json({ error: 'Say what to look for.' }, 400, h);
        const m = matchCatalogue(await catalogue(env), q);
        return json({ q, max: m.ask.max, considered: m.considered, ids: m.inBudget.map(p => p.id), best: m.inBudget.length ? m.inBudget.reduce((a, b) => (a.price <= b.price ? a : b)).id : null }, 200, h);
      }
      // eBay (sandbox until eBay approves production): live search in eBay's own order, and one item's details
      if (req.method === 'GET' && (url.pathname === '/ebay/search' || url.pathname === '/ebay/item')) {
        if (ebayMode(env) === 'off') return json({ mode: 'off', items: [] }, 200, h);
        try {
          if (url.pathname === '/ebay/item') { const it = await ebayItem(env, url.searchParams.get('id') || ''); return it ? json({ mode: ebayMode(env), item: it }, 200, h) : json({ error: 'Not found' }, 404, h); }
          const q = (url.searchParams.get('q') || '').trim().slice(0, 200); if (q.length < 2) return json({ mode: ebayMode(env), items: [] }, 200, h);
          return json({ mode: ebayMode(env), items: await searchEbay(env, q) }, 200, h);
        } catch (e) { return json({ error: String(e.message || e).slice(0, 160) }, 502, h); }
      }
      if (req.method === 'GET' && url.pathname === '/catalogue') {
        const products = await catalogue(env);
        return new Response(JSON.stringify({ products, shops: SHOP_INFO, at: CAT_AT }), { headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' } });   // the browser keeps it per session; approvals show at once
      }
      if (req.method === 'POST' && url.pathname === '/checkout') {
        const b = await req.json().catch(() => ({}));
        const products = await catalogue(env), byId = new Map(products.map(p => [String(p.id), p]));
        const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 30).map(l => ({ p: byId.get(String(l.id)), qty: l.qty })).filter(l => l.p && l.p.source === 'shopify');
        if (!lines.length) return json({ error: 'Nothing in this cart can be checked out at a store.' }, 400, h);
        const key = lines[0].p.shop;
        if (lines.some(l => l.p.shop !== key)) return json({ error: 'One store per checkout.' }, 400, h);
        const shop = (await listShops(env)).find(s => s.key === key);
        if (!shop) return json({ error: 'That store is not connected any more.' }, 410, h);
        try { return json({ url: await createCheckout(shop, lines.map(l => ({ variantId: l.p.variantId, qty: l.qty }))), store: lines[0].p.merchant, test: !!shop.test }, 200, h); }
        catch (e) { return json({ error: 'The store could not start a checkout: ' + String(e.message || e).slice(0, 120) }, 502, h); }
      }
      const who = await sessionOf(req, env), owner = ownerKey(who, req.headers.get('x-gz-device') || '');
      const origin = req.headers.get('Origin') || '', allow = String(env.ALLOW_ORIGINS || '').split(',').map(x => x.trim());
      const site = originOk(env, origin) ? origin : allow[0];
      if (req.method === 'POST' && url.pathname === '/orders/quote') { const b = await req.json().catch(() => ({})); return json(quoteFor(await catalogue(env), b, who), 200, h); }
      if (req.method === 'POST' && url.pathname === '/orders/checkout') { const b = await req.json().catch(() => ({})); const r = await checkout(env, await catalogue(env), b, owner, site, who); if (r.status === 200) { bump('orders'); ctx.waitUntil(flush(env)); } return json(r.body, r.status, h); }
      if (url.pathname.startsWith('/seller/payouts')) {
        if (!owner) return json({ error: 'Missing browser id.' }, 400, h);
        try {
          if (req.method === 'GET') return json(await payoutStatus(env, owner), 200, h);
          const b = await req.json().catch(() => ({}));
          const r = url.pathname.endsWith('/dashboard') ? await payoutDashboard(env, owner) : await startPayouts(env, owner, who, site, b.cc);
          return json(r.body, r.status, h);
        } catch (e) { return json({ error: 'Stripe: ' + String(e.message || e).slice(0, 140) }, 502, h); }
      }
      if (req.method === 'GET' && url.pathname === '/seller/orders') { const r = await sellerOrders(env, owner); return json(r.body, r.status, h); }
      if (req.method === 'POST' && url.pathname === '/seller/orders/ship') { const b = await req.json().catch(() => ({})); const r = await markShipped(env, b, owner); return json(r.body, r.status, h); }
      if (req.method === 'POST' && url.pathname === '/reviews') { const b = await req.json().catch(() => ({})); const r = await addReview(env, b, owner, who); if (r.status === 200) { CAT = null; bump('reviews'); ctx.waitUntil(flush(env)); } return json(r.body, r.status, h); }
      if (req.method === 'POST' && url.pathname === '/hit') { bump('views'); ctx.waitUntil(flush(env)); return new Response(null, { status: 204, headers: h }); }
      if (req.method === 'GET' && url.pathname === '/admin/stats') { if (!isAdmin(req, env)) return json({ error: 'Not allowed.' }, 403, h); return json({ days: await recent(env, 14) }, 200, h); }
      if (req.method === 'GET' && url.pathname === '/orders/confirm') { const r = await confirm(env, url.searchParams.get('id') || '', owner); return json(r.body, r.status, h); }
      if (req.method === 'GET' && url.pathname === '/orders') { const r = await listOrders(env, owner); return json(r.body, r.status, h); }
      if (req.method === 'POST' && url.pathname === '/orders/return') { const b = await req.json().catch(() => ({})); const r = await requestReturn(env, b, owner); return json(r.body, r.status, h); }
      if (url.pathname === '/seller/listings') {
        if (!owner) return json({ error: 'Missing browser id.' }, 400, h);
        if (req.method === 'POST') { if (!rate(req, env)) return json({ error: 'Too many requests today.' }, 429, h); const b = await req.json().catch(() => ({})); const r = await createListing(env, b, owner, who); if (r.status === 200) { bump('listings'); ctx.waitUntil(flush(env)); } return json(r.body, r.status, h); }
        const r = await myListings(env, owner); return json(r.body, r.status, h);
      }
      if (req.method === 'POST' && url.pathname === '/seller/shopify') { if (!owner) return json({ error: 'Missing browser id.' }, 400, h); const b = await req.json().catch(() => ({})); const r = await requestShopify(env, b, owner, who); return json(r.body, r.status, h); }
      if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
        const r = await image(env, url.pathname.slice(5));
        return r ? new Response(r.value, { headers: { 'content-type': (r.metadata && r.metadata.type) || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } }) : json({ error: 'Not found' }, 404, h);
      }
      if (url.pathname === '/admin/queue' || url.pathname === '/admin/decide') {
        if (!isAdmin(req, env)) return json({ error: 'Not allowed.' }, 403, h);
        if (req.method === 'GET') return json(await queue(env), 200, h);
        const b = await req.json().catch(() => ({})); const r = await decide(env, b); CAT = null; return json(r.body, r.status, h);
      }
      if (req.method === 'POST' && (url.pathname === '/auth/wallet/nonce' || url.pathname === '/auth/wallet/verify')) {
        if (!rate(req, env)) return json({ error: 'Too many sign-in attempts today.' }, 429, h);
        const b = await req.json().catch(() => ({})); const r = url.pathname.endsWith('/nonce') ? await walletNonce(env, b) : await walletVerify(env, b); if (r.status === 200 && r.body.sid) ctx.waitUntil(flush(env)); return json(r.body, r.status, h);
      }
      if (req.method === 'GET' && url.pathname === '/auth/x/start') return xStart(req, env, url);
      if (req.method === 'GET' && url.pathname === '/auth/x/callback') return xCallback(req, env, url);
      if (req.method === 'GET' && url.pathname === '/me') { const s = await sessionOf(req, env); if (!s) return json({ error: 'Not signed in.' }, 401, h); const { sid, ...me } = s; return json(me, 200, h); }
      if (req.method === 'POST' && url.pathname === '/auth/logout') return json({ ok: await logout(req, env) }, 200, h);
      if (req.method === 'POST' && url.pathname === '/auth/test' && !req.headers.get('CF-Connecting-IP')) { const b = await req.json().catch(() => ({})); return json({ sid: await testSession(env, b.plan) }, 200, h); }   // local QA only
      if (url.pathname === '/missions') {
        let r;
        // signed in with X: missions belong to the X account (every device); otherwise to this browser's random id
        const who = await sessionOf(req, env), dev = (d) => who ? (who.wallet ? 'w' + who.wallet : 'x' + who.xId) : (/^[xw]/.test(d) ? '' : d);
        if (req.method === 'POST') { const body = await req.json().catch(() => ({})); r = await syncMissions(env, { ...body, device: dev(String(body.device || '')) }, await catalogue(env)); }
        else if (req.method === 'GET') r = await getMissions(env, dev(url.searchParams.get('device') || ''), await catalogue(env));
        else return json({ error: 'Not found' }, 404, h);
        return json(r.body, r.status, h);
      }
      if (req.method === 'POST' && (url.pathname === '/cj/refresh' || url.pathname === '/cj/sync') && !req.headers.get('CF-Connecting-IP')) {   // local dev only: run the hourly CJ jobs now
        const b = await req.json().catch(() => ({}));
        const r = url.pathname === '/cj/sync' ? await syncCjOrders(env, b.budget || 10) : await refreshShelf(env, b.budget || 25);
        CAT = null; return json(r, 200, h);
      }
      if (req.method === 'POST' && url.pathname === '/missions/run' && !req.headers.get('CF-Connecting-IP')) {   // local dev only: run the hourly check now
        return json(await runAll(env, await catalogue(env)), 200, h);
      }
      if (req.method === 'POST' && url.pathname === '/merchants/apply') {
        const b = await req.json().catch(() => ({}));
        const store = String(b.store || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store) || store.length > 120) return json({ error: 'Enter your store address, like yourstore.myshopify.com.' }, 400, h);
        const x = String(b.x || '').trim().replace(/^@/, '').slice(0, 30);
        if (x && !/^[A-Za-z0-9_]{1,15}$/.test(x)) return json({ error: 'That X handle does not look right.' }, 400, h);
        if (!rate(req, env)) return json({ error: 'Too many requests from this connection today.' }, 429, h);
        const rec = { store, x, products: String(b.products || '').slice(0, 20), note: String(b.note || '').slice(0, 300), at: new Date().toISOString() };
        await kv(env).put('apply:' + Date.now() + ':' + store, JSON.stringify(rec));
        return json({ ok: true, store }, 200, h);
      }
      if (req.method === 'POST' && url.pathname === '/ask') {
        if (url.searchParams.get('fixture') === '1' && env.ALLOW_FIXTURE === '1') return json({ ...FIXTURE, engine: 'fixture', cached: false }, 200, h);
        const body = await req.json().catch(() => ({}));
        const q = String(body.q || '').trim().slice(0, 300);
        if (q.length < 3) return json({ error: 'Tell Grok what to find.' }, 400, h);
        const key = 'ask:' + (env.XAI_API_KEY ? 'x' : 'a') + ':' + q.toLowerCase().replace(/\s+/g, ' ');
        const hit = cacheGet(env, key); if (hit) return json({ ...hit, cached: true }, 200, h);
        if (!rate(req, env)) return json({ error: 'That is today\'s limit for this connection. Come back tomorrow.' }, 429, h);
        const t0 = Date.now();
        let ans;
        try { ans = await ask(env, q); } catch (e) { return json({ error: plainError(e) }, 502, h); }
        bump('searches'); ctx.waitUntil(flush(env));
        ans.ms = Date.now() - t0;
        if (ans.picks.length || ans.engine === 'filter') cacheSet(key, ans);
        return json({ ...ans, cached: false }, 200, h);
      }
      return json({ error: 'Not found' }, 404, h);
    } catch (e) {
      return json({ error: plainError(e) }, 500, h);
    }
  },
  // hourly Cron Trigger (wrangler.toml [triggers]): missions keep watching while nobody has the page open
  async scheduled(event, env, ctx) {
    // CJ first (about 35 calls at most, one a second), then the catalogue the missions check against
    const cjJobs = cjMode(env) === 'off' ? Promise.resolve() : refreshShelf(env, 25).then(r => { if (r.calls) CAT = null; }).then(() => syncCjOrders(env, 10)).catch(e => console.log('cj cron failed', String(e.message || e).slice(0, 160)));
    ctx.waitUntil(cjJobs.then(() => catalogue(env)).then(products => runAll(env, products)).then(() => flush(env, true)));
  }
};
