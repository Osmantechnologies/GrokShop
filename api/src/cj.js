// CJ Dropshipping connector: real products held in CJ's US warehouses, sold by Grokshop, ordered from CJ once the
// buyer's order is placed. Docs: developers.cjdropshipping.com (API 2.0, read 2026-10-16).
//
//   Shelf     every hour the cron tops up the shelf in KV (cj:shelf): a product search per shelf line (US stock only,
//             verified inventory), then each product's details (US-stock variants). One catalogue item per variant,
//             so the cart needs no size/colour picker: "Yoga mat - Purple" is its own listing, like Amazon's.
//   Price     CJ's cost x CJ_MARKUP + CJ_ADD, rounded up to .99. Grokshop's own shipping rule still applies on top.
//   Orders    test orders (no Stripe, or Stripe test keys) go to CJ as SANDBOX orders: no money, nothing ships.
//             live orders are created at CJ unpaid (payType 3) unless CJ_AUTOPAY=1 (paid from the CJ balance).
//   Tracking  the cron reads each open CJ order and copies status + tracking number onto the Grokshop order.
//
// Env: secret CJ_API_KEY ; vars CJ_ON ("1" shows the shelf), CJ_SHELF (JSON [{q, dept}]), CJ_MARKUP, CJ_ADD,
//      CJ_RETURNS, CJ_AUTOPAY. Free CJ accounts may call the API once a second, so every call goes through one queue.
import { kv } from './missions.js';

const API = 'https://developers.cjdropshipping.com/api2.0/v1';
const base = (env) => (env.CJ_API_BASE && /^http:\/\/(127\.0\.0\.1|localhost):/.test(env.CJ_API_BASE) ? env.CJ_API_BASE : API);   // local QA stand-in only
const SHELF_DEFAULT = [
  { q: 'wireless earbuds', dept: 'electronics' }, { q: 'phone charger', dept: 'electronics' }, { q: 'smart watch', dept: 'electronics' },
  { q: 'kitchen gadget', dept: 'home' }, { q: 'led light', dept: 'home' }, { q: 'skin care', dept: 'beauty' },
  { q: 'yoga', dept: 'sports' }, { q: 'pet toy', dept: 'other' }
];
const PER_QUERY = 12, MAX_VARIANTS = 3, SHELF_HOURS = 24;

export function cjMode(env) { return env.CJ_API_KEY ? (env.CJ_ON === '1' ? 'on' : 'ready') : 'off'; }

/* ---------- calls: one at a time, at most one a second ---------- */
let QUEUE = Promise.resolve(), LAST = 0, TOKEN = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function queued(fn) {
  const p = QUEUE.then(async () => { const wait = LAST + 1100 - Date.now(); if (wait > 0) await sleep(wait); LAST = Date.now(); return fn(); });
  QUEUE = p.catch(() => { });
  return p;
}
async function token(env, fresh) {
  if (!fresh && TOKEN && Date.now() < TOKEN.exp) return TOKEN.t;
  if (!fresh) { const k = JSON.parse((await kv(env).get('cj:token')) || 'null'); if (k && Date.now() < k.exp) { TOKEN = k; return k.t; } }
  const j = await queued(() => fetch(base(env) + '/authentication/getAccessToken', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: env.CJ_API_KEY }) }).then(r => r.json()).catch(() => ({})));
  if (!j || !j.data || !j.data.accessToken) throw new Error('CJ sign-in failed: ' + ((j && j.message) || 'no answer'));
  const exp = Math.min(Date.parse(j.data.accessTokenExpiryDate) || 0, Date.now() + 30 * 86400e3) - 86400e3;   // tokens last 180 days; re-read monthly
  TOKEN = { t: j.data.accessToken, exp: exp > Date.now() ? exp : Date.now() + 86400e3 };
  await kv(env).put('cj:token', JSON.stringify(TOKEN));
  return TOKEN.t;
}
async function call(env, path, opt = {}, retried) {
  const t = await token(env, retried);
  const url = base(env) + path + (opt.query ? '?' + opt.query : '');
  const j = await queued(() => fetch(url, { method: opt.body ? 'POST' : (opt.method || 'GET'), headers: { 'CJ-Access-Token': t, 'content-type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined }).then(r => r.json()).catch(() => ({})));
  if (j && (j.code === 200 || j.result === true || j.success === true)) return j.data;
  if (!retried && j && /token/i.test(String(j.message || ''))) return call(env, path, opt, true);   // expired or revoked: sign in again once
  throw new Error('CJ: ' + ((j && j.message) || 'no answer') + (j && j.code ? ' (' + j.code + ')' : ''));
}

/* ---------- shape: one CJ variant -> one catalogue item ---------- */
const num = (v) => { const m = String(v == null ? '' : v).match(/\d+(\.\d+)?/g); return m ? Math.max(...m.map(Number)) : null; };   // "1.20-3.40" -> 3.40 (never under-price)
export function retail(env, cost) { const c = +cost; if (!(c > 0)) return null; return Math.ceil(c * (+env.CJ_MARKUP || 1.5) + (env.CJ_ADD != null ? +env.CJ_ADD : 3)) - 0.01; }
const usStock = (v) => (v.inventories || []).filter(i => i.countryCode === 'US').reduce((s, i) => s + (+i.totalInventory || 0), 0);
function shipLine(cycle) {
  const m = String(cycle || '').match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? 'Delivered in ' + m[1] + '-' + m[2] + ' days from a US warehouse' : 'Ships from a US warehouse';
}
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export function fromDetail(env, d, hit) {
  const imgs = (Array.isArray(d.productImageSet) ? d.productImageSet : [d.bigImage]).filter(u => /^https:\/\//.test(u || '')).slice(0, 6);
  const vs = (d.variants || []).map(v => ({ v, stock: usStock(v) })).filter(x => x.stock > 0 && x.v.vid && retail(env, x.v.variantSellPrice) != null)
    .sort((a, b) => a.v.variantSellPrice - b.v.variantSellPrice).slice(0, MAX_VARIANTS);
  const name = clean(d.productNameEn || hit.nameEn).slice(0, 140), many = vs.length > 1;
  return vs.map(({ v, stock }) => {
    const opt = clean(v.variantKey || ''), img = /^https:\/\//.test(v.variantImage || '') ? v.variantImage : imgs[0];
    return {
      id: 'c-' + v.vid, source: 'cj', merchant: 'Grokshop', brand: 'Grokshop', title: name + (opt && (many || !/^default$/i.test(opt)) ? ' - ' + opt : ''),
      description: clean(d.description || hit.description).slice(0, 1200), category: hit.cat || hit.dept, dept: hit.dept, tags: [hit.dept, String(hit.cat || '').toLowerCase()].filter(Boolean),
      price: retail(env, v.variantSellPrice), currency: 'USD', discountPercentage: 0, rating: null, reviews: [], stock, availabilityStatus: 'In Stock',
      shippingInformation: shipLine(hit.cycle), returnPolicy: env.CJ_RETURNS || '30 days return policy', warrantyInformation: null,
      images: [img].concat(imgs.filter(u => u !== img)), thumbnail: img, cj: { pid: d.pid, vid: v.vid, sku: v.variantSku || '' }
    };
  });
}

/* ---------- the shelf (KV cj:shelf), topped up by the hourly cron within a call budget ---------- */
async function loadShelf(env) { return JSON.parse((await kv(env).get('cj:shelf')) || 'null') || { at: 0, todo: [], items: [] }; }
export async function shelf(env) {   // the first round shows as it fills; later rounds swap in only when complete
  if (cjMode(env) !== 'on') return [];
  const s = await loadShelf(env); return s.items.length ? s.items : (s.next || []);
}
export async function refreshShelf(env, budget = 30) {
  if (!env.CJ_API_KEY) return { skipped: 'no key' };
  const s = await loadShelf(env); let used = 0;
  const lines = (() => { try { return JSON.parse(env.CJ_SHELF || 'null') || SHELF_DEFAULT; } catch (e) { return SHELF_DEFAULT; } })();
  if (!s.todo.length && Date.now() - s.at > SHELF_HOURS * 3600e3) {   // a new round: search every shelf line
    const todo = [], seen = new Set();
    for (const L of lines) {
      if (used >= budget) break;
      const q = new URLSearchParams({ keyWord: L.q, page: '1', size: String(PER_QUERY), countryCode: 'US', verifiedWarehouse: '1', startWarehouseInventory: '5' });
      q.append('features', 'enable_description'); q.append('features', 'enable_category');
      used++;
      const d = await call(env, '/product/listV2', { query: q.toString() }).catch(e => { console.log('cj search failed', L.q, String(e.message).slice(0, 120)); return null; });
      const list = d && d.content ? d.content.flatMap(c => c.productList || []) : [];
      for (const p of list) if (p.id && !seen.has(p.id)) { seen.add(p.id); todo.push({ pid: p.id, dept: L.dept, nameEn: p.nameEn, description: p.description || '', cycle: p.deliveryCycle || '', cat: p.threeCategoryName || '' }); }
    }
    s.todo = todo; s.next = []; s.at = Date.now();
  }
  while (s.todo.length && used < budget) {   // details, US-stock variants only
    const hit = s.todo.shift(); used++;
    const d = await call(env, '/product/query', { query: new URLSearchParams({ pid: hit.pid, countryCode: 'US' }).toString() }).catch(e => { console.log('cj detail failed', hit.pid, String(e.message).slice(0, 120)); return null; });
    if (d) (s.next = s.next || []).push(...fromDetail(env, d, hit));
  }
  if (!s.todo.length && s.next) { if (s.next.length || !s.items.length) s.items = s.next; delete s.next; }   // swap in the new round once it is complete
  await kv(env).put('cj:shelf', JSON.stringify(s));
  return { calls: used, left: s.todo.length, items: s.items.length };
}

/* ---------- orders ---------- */
const isCj = (l) => /^c-/.test(String(l.id));
export function cjLines(o) { return o.lines.filter(isCj); }
// the cheapest CJ shipping method from the US warehouse, preferring ones that arrive within a week
async function pickLogistic(env, cc, products) {
  const d = await call(env, '/logistic/freightCalculate', { body: { startCountryCode: 'US', endCountryCode: cc, products } });
  const opts = (Array.isArray(d) ? d : []).filter(x => x.logisticName).map(x => ({ name: x.logisticName, price: +x.logisticPrice || 0, days: num(x.logisticAging) || 99 }));
  if (!opts.length) throw new Error('CJ has no shipping method from the US warehouse to ' + cc);
  const week = opts.filter(x => x.days <= 7), pool = week.length ? week : opts;
  return pool.sort((a, b) => a.price - b.price)[0];
}
// called once the Grokshop order is placed (paid, or a test order). Never throws: problems are written on the order.
export async function placeCjOrder(env, o) {
  const lines = cjLines(o); if (!lines.length || o.cj) return o;
  const sandbox = o.mode !== 'live', to = o.shipTo || {}, cc = to.cc || 'US';
  o.cj = { sandbox, at: Date.now() };
  try {
    if (!sandbox && !(to.line1 && to.city && to.name)) throw new Error('the order has no full shipping address');
    const products = lines.map(l => ({ vid: String(l.id).slice(2), quantity: l.qty }));
    const ship = await pickLogistic(env, cc, products);
    const body = {
      orderNumber: o.id, isSandbox: sandbox ? 1 : 0, payType: !sandbox && env.CJ_AUTOPAY === '1' ? 2 : 3,
      shippingCountryCode: cc, shippingCountry: cc, shippingProvince: to.state || (sandbox ? 'Test' : ''), shippingCity: to.city || (sandbox ? 'Test' : ''), shippingZip: to.zip || '',
      shippingCustomerName: to.name || (sandbox ? 'Grokshop test order' : ''), shippingAddress: to.line1 || (sandbox ? 'Test order, nothing ships' : ''), shippingAddress2: to.line2 || '',
      logisticName: ship.name, fromCountryCode: 'US', platform: 'Api', remark: 'Grokshop ' + o.id,
      products: lines.map(l => ({ vid: String(l.id).slice(2), quantity: l.qty, storeLineItemId: o.id + '-' + l.n }))
    };
    const d = await call(env, '/shopping/order/createOrderV2', { body });
    Object.assign(o.cj, { orderId: d.orderId || '', status: d.orderStatus || 'CREATED', logistic: ship.name, postage: +d.postageAmount || ship.price, cost: +d.orderAmount || null, paid: body.payType === 2 });
    for (const l of lines) l.fulfil = 'cj';
    const open = JSON.parse((await kv(env).get('cj:open')) || '[]'); if (!open.includes(o.id)) { open.push(o.id); await kv(env).put('cj:open', JSON.stringify(open.slice(-500))); }
  } catch (e) { o.cj.error = String(e.message || e).slice(0, 200); console.log('cj order failed', o.id, o.cj.error); }
  const k = 'cj:recent', recent = JSON.parse((await kv(env).get(k)) || '[]'); if (!recent.includes(o.id)) { recent.unshift(o.id); await kv(env).put(k, JSON.stringify(recent.slice(0, 100))); }
  return o;
}
// the owner's view (admin page): every recent warehouse order, with CJ's status, cost and any problem
export async function cjOrders(env) {
  const ids = JSON.parse((await kv(env).get('cj:recent')) || '[]');
  const os = (await Promise.all(ids.slice(0, 50).map(async id => JSON.parse((await kv(env).get('order:' + id)) || 'null')))).filter(o => o && o.cj);
  return os.map(o => ({ id: o.id, at: o.paidAt || o.at, mode: o.mode, sandbox: o.cj.sandbox, cjOrder: o.cj.orderId || '', status: o.cj.status || '', paid: !!o.cj.paid, cost: o.cj.cost, total: o.total, logistic: o.cj.logistic || '', error: o.cj.error || '',
    tracking: (cjLines(o).find(l => l.tracking) || {}).tracking || '', items: cjLines(o).map(l => l.qty + ' x ' + l.title).join(', ').slice(0, 200) }));
}
// hourly: copy CJ's status + tracking onto open orders
const DONE = new Set(['DELIVERED', 'CANCELLED']);
export async function syncCjOrders(env, budget = 15) {
  if (!env.CJ_API_KEY) return { skipped: 'no key' };
  const open = JSON.parse((await kv(env).get('cj:open')) || '[]'), keep = []; let used = 0;
  for (const id of open) {
    if (used >= budget) { keep.push(id); continue; }
    const o = JSON.parse((await kv(env).get('order:' + id)) || 'null'); if (!o || !o.cj || !o.cj.orderId) continue;
    used++;
    const d = await call(env, '/shopping/order/getOrderDetail', { query: new URLSearchParams({ orderId: o.cj.orderId }).toString() }).catch(() => null);
    if (d) {
      o.cj.status = d.orderStatus || o.cj.status; o.cj.checked = Date.now();
      for (const l of cjLines(o)) {
        if (d.trackNumber && l.status === 'ordered') { l.status = 'shipped'; l.shippedAt = Date.now(); l.tracking = String(d.trackNumber).slice(0, 60); l.carrier = d.logisticName || o.cj.logistic || ''; }
        if (d.orderStatus === 'DELIVERED' && l.status === 'shipped') l.status = 'delivered';
      }
      await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: 400 * 86400 });
    }
    if (!d || !DONE.has(o.cj.status)) keep.push(id);
  }
  await kv(env).put('cj:open', JSON.stringify(keep));
  return { checked: used, open: keep.length };
}
