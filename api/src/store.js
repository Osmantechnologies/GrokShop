// The Amazon side of Grokshop: one cart, one checkout, orders, returns, seller listings, and the owner's review queue.
//
// Orders     POST /orders/checkout {lines:[{id,qty}]}  -> Stripe Checkout (test mode) when STRIPE_SECRET_KEY is set:
//                                                          card + address are typed on Stripe's page, never on Grokshop.
//                                                          Without the key: a TEST order (no payment, nothing ships).
//            GET  /orders/confirm?sid=   GET /orders   POST /orders/return {order, line, reason}
// Listings   POST /seller/listings {title, description, price, stock, dept, shipsIn, returns, images:[dataURL]}
//            GET  /seller/listings   POST /seller/shopify {domain, token, shipsIn, returns}   GET /img/<id>
// Review     GET  /admin/queue   POST /admin/decide {kind, id, ok}     (header x-admin-token = secret ADMIN_TOKEN)
// Prices always come from the catalogue on the server, never from the browser.
import { kv } from './missions.js';
import { payOut, payoutStatus } from './payouts.js';
import { placeCjOrder, cjOrders } from './cj.js';

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const DEV_RE = /^[a-f0-9]{24}$/;
export const DEPTS = ['electronics', 'home', 'grocery', 'beauty', 'fashion', 'sports', 'motors', 'other'];

// whose orders / listings: the signed-in X account, else this browser's random id
export function ownerKey(who, device) { return who ? (who.wallet ? 'w' + who.wallet : 'x' + who.xId) : (DEV_RE.test(device || '') ? 'd' + device : ''); }   // an X account, a wallet, or this browser

/* ---------- shipping: Grokshop's own rule, per seller ----------
   Free when every item from that seller ships within a working week (X fast) and the shopper is signed in with a paid
   X plan; free on $35+ from one seller; otherwise $4.99 per seller. Tax is added by the payment page (Stripe Tax) when
   the owner turns it on (STRIPE_TAX=1); test orders carry no tax. */
const FREE_OVER = 35, STANDARD = 4.99;
const isFast = (p) => { const s = p.shippingInformation || ''; if (/overnight|1-2 business|3-5 business/i.test(s)) return true; const m = s.match(/(\d+)-(\d+) days/i); return !!m && +m[2] <= 5; };   // within a working week
const sellerName = (p) => p.merchant || ((p.brand || String(p.category || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) + ' store');
export function quote(lines, who) {
  const groups = new Map();
  for (const l of lines) { const k = sellerName(l.p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  const out = [...groups.entries()].map(([seller, ls]) => {
    const subtotal = +ls.reduce((s, l) => s + l.p.price * l.qty, 0).toFixed(2);
    let shipping = STANDARD, why = 'standard shipping';
    if (who && who.fast && ls.every(l => isFast(l.p))) { shipping = 0; why = 'X fast delivery, free with ' + (who.planName || 'your X plan'); }
    else if (subtotal >= FREE_OVER) { shipping = 0; why = 'free over $' + FREE_OVER; }
    return { seller, subtotal, shipping, why };
  });
  const items = +out.reduce((s, g) => s + g.subtotal, 0).toFixed(2), shipping = +out.reduce((s, g) => s + g.shipping, 0).toFixed(2);
  return { groups: out, items, shipping, total: +(items + shipping).toFixed(2) };
}
export function quoteFor(products, body, who) { return quote(linesFrom(products, body.lines), who); }

/* ---------- orders ---------- */
function linesFrom(products, raw) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map(l => ({ p: byId.get(String(l.id)), qty: Math.max(1, Math.min(9, l.qty | 0)) })).filter(l => l.p && l.p.price > 0);
}
function orderLine(l, i) {
  const p = l.p;
  return { n: i, id: p.id, title: p.title, thumbnail: p.thumbnail, price: p.price, qty: l.qty, seller: sellerName(p), shipsIn: p.shippingInformation || '', returns: p.returnPolicy || '', status: 'ordered' };
}
// who sells each line: a Grokshop seller's listing, or a connected Shopify store's owner (private: never sent to buyers)
async function sellerOwners(env, o) {
  for (const l of o.lines) {
    let owner = '';
    if (/^l-/.test(String(l.id))) { const L = JSON.parse((await kv(env).get('listing:' + l.id)) || 'null'); owner = L ? L.owner : ''; }
    else if (/^s-/.test(String(l.id))) { const key = String(l.id).split('-')[1]; const S = JSON.parse((await kv(env).get('shop:' + key)) || 'null'); owner = S && S.owner ? S.owner : ''; }
    if (owner) l.sellerOwner = owner;
  }
}
// once an order is placed (paid, or a test order), each seller gets it in their "Orders to ship"
async function notifySellers(env, o) {
  const owners = [...new Set(o.lines.map(l => l.sellerOwner).filter(Boolean))];
  for (const s of owners) {
    const k = 'sorders:' + s, list = JSON.parse((await kv(env).get(k)) || '[]');
    if (!list.includes(o.id)) { list.unshift(o.id); await kv(env).put(k, JSON.stringify(list.slice(0, 500))); }
  }
}
// what a buyer may see of an order (no seller ids), and what a seller may see (only their lines, no buyer id)
export function forBuyer(o) { return { ...o, owner: undefined, cj: undefined, lines: o.lines.map(l => ({ ...l, sellerOwner: undefined, fulfil: undefined })) }; }   // supplier + cost stay private
function forSeller(o, seller) {
  const paid = o.status === 'placed' && o.mode === 'live';   // a preview buyer's street address never reaches a seller
  return { id: o.id, at: o.paidAt || o.at, mode: o.mode, status: o.status, shipTo: paid ? o.shipTo : { city: o.shipTo && o.shipTo.city, cc: o.shipTo && o.shipTo.cc },
    lines: o.lines.filter(l => l.sellerOwner === seller).map(l => ({ ...l, sellerOwner: undefined })) };
}
const ttl = (o) => (o.mode === 'live' ? 400 : 30) * 86400;   // preview orders (and the address typed for them) are kept 30 days
async function saveOrder(env, owner, o) {
  await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: ttl(o) });
  const k = 'orders:' + owner, list = JSON.parse((await kv(env).get(k)) || '[]');
  if (!list.includes(o.id)) { list.unshift(o.id); await kv(env).put(k, JSON.stringify(list.slice(0, 200))); }
}
export async function checkout(env, products, body, owner, siteOrigin, who) {
  if (!owner) return { status: 400, body: { error: 'Missing browser id.' } };
  const eb = (Array.isArray(body.lines) ? body.lines : []).filter(l => /^e-/.test(String(l.id)));
  if (eb.length && env.STRIPE_SECRET_KEY) return { status: 400, body: { error: 'eBay items check out through eBay\u2019s own checkout, which opens once eBay approves Grokshop. Remove them to pay for the rest.' } };
  if (eb.length) { const { ebayItem } = await import('./ebay.js'); for (const l of eb.slice(0, 10)) { try { const it = await ebayItem(env, l.id); if (it) products = products.concat([it]); } catch (e) { } } }
  const lines = linesFrom(products, body.lines);
  if (!lines.length) return { status: 400, body: { error: 'Your cart is empty.' } };
  const w = body.where || {}, cc = /^[A-Z]{2}$/.test(w.cc || '') ? w.cc : '';
  const q = quote(lines, who);
  const o = { id: 'GZ-' + hex(5).toUpperCase(), owner, at: Date.now(), lines: lines.map(orderLine), items: q.items, shipping: q.shipping, shippingBy: q.groups, total: q.total, currency: 'USD', xfast: !!(who && who.fast),
    shipTo: { city: String(w.city || '').slice(0, 60), zip: String(w.zip || '').slice(0, 12), cc } };
  const st = body.shipTo || {}, s = (k, n) => String(st[k] || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
  if (s('name', 60) && s('line1', 100)) o.shipTo = { name: s('name', 60), line1: s('line1', 100), line2: s('line2', 100), city: s('city', 60) || o.shipTo.city, state: s('state', 40), zip: s('zip', 12) || o.shipTo.zip, cc };   // preview orders: the address from Grokshop's checkout page (paid orders take Stripe's)
  await sellerOwners(env, o);
  if (!env.STRIPE_SECRET_KEY) {   // no payments set up yet: a clearly labelled test order
    o.mode = 'test'; o.status = 'placed';
    await placeCjOrder(env, o);   // US-warehouse items: a CJ sandbox order (no money, nothing ships)
    await saveOrder(env, owner, o); await notifySellers(env, o);
    return { status: 200, body: { order: o.id, mode: 'test', url: siteOrigin + '/order.html?id=' + o.id } };
  }
  if (/^sk_live_/.test(env.STRIPE_SECRET_KEY) && env.STRIPE_LIVE !== '1') return { status: 503, body: { error: 'Live payments are not switched on yet.' } };   // real charges need the owner's explicit STRIPE_LIVE=1
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', siteOrigin + '/order.html?id=' + o.id + '&sid={CHECKOUT_SESSION_ID}');
  f.set('cancel_url', siteOrigin + '/cart.html');
  // Stripe asks for the full address on its own page, starting from the shopper's chosen country
  f.set('shipping_address_collection[allowed_countries][0]', cc || 'US');
  f.set('metadata[order]', o.id);
  f.set('payment_intent_data[transfer_group]', o.id);   // each seller's transfer is linked to this payment (payouts.js)
  // shipping from the same rule the cart showed; tax by Stripe Tax once the owner turns it on
  f.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  f.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(Math.round(q.shipping * 100)));
  f.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  f.set('shipping_options[0][shipping_rate_data][display_name]', q.shipping ? 'Shipping' : 'Free shipping');
  if (env.STRIPE_TAX === '1') f.set('automatic_tax[enabled]', 'true');
  if (o.shipTo.name && o.shipTo.line1) {   // the address typed on Grokshop's checkout page is pre-filled on Stripe's page
    const c = new URLSearchParams({ name: o.shipTo.name, 'shipping[name]': o.shipTo.name, 'shipping[address][line1]': o.shipTo.line1, 'shipping[address][line2]': o.shipTo.line2 || '', 'shipping[address][city]': o.shipTo.city || '', 'shipping[address][state]': o.shipTo.state || '', 'shipping[address][postal_code]': o.shipTo.zip || '', 'shipping[address][country]': cc || 'US', 'metadata[order]': o.id });
    const cr = await fetch('https://api.stripe.com/v1/customers', { method: 'POST', headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: c.toString() }).then(r => r.json()).catch(() => ({}));
    if (cr.id) { f.set('customer', cr.id); f.set('customer_update[shipping]', 'auto'); }
  }
  lines.forEach((l, i) => {
    f.set(`line_items[${i}][quantity]`, String(l.qty));
    f.set(`line_items[${i}][price_data][currency]`, 'usd');
    f.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(l.p.price * 100)));
    f.set(`line_items[${i}][price_data][product_data][name]`, l.p.title.slice(0, 120));
    if (/^https:\/\//.test(l.p.thumbnail || '')) f.set(`line_items[${i}][price_data][product_data][images][0]`, l.p.thumbnail);
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: f.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) return { status: 502, body: { error: 'Payments did not start: ' + ((j.error && j.error.message) || r.status) } };
  o.mode = /^sk_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'stripe-test'; o.status = 'awaiting payment'; o.session = j.id;
  await saveOrder(env, owner, o);
  return { status: 200, body: { order: o.id, mode: o.mode, url: j.url } };
}
// the success page asks Stripe (not the browser) whether the order was paid
export async function confirm(env, id, owner) {
  const o = JSON.parse((await kv(env).get('order:' + id)) || 'null');
  if (!o || o.owner !== owner) return { status: 404, body: { error: 'Order not found.' } };
  if (o.session && o.status === 'awaiting payment' && env.STRIPE_SECRET_KEY) {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + o.session, { headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
    const s = await r.json().catch(() => ({}));
    if (s.payment_status === 'paid') {
      o.status = 'placed'; o.paidAt = Date.now();
      const sd = s.shipping_details || (s.collected_information && s.collected_information.shipping_details) || null, ad = (sd && sd.address) || {};
      o.shipTo = { name: sd ? sd.name : '', line1: ad.line1 || '', line2: ad.line2 || '', city: ad.city || o.shipTo.city, state: ad.state || '', zip: ad.postal_code || o.shipTo.zip, cc: ad.country || o.shipTo.cc };
      if (s.total_details && s.total_details.amount_tax) o.tax = s.total_details.amount_tax / 100;
      if (s.amount_total) o.total = s.amount_total / 100;
      await placeCjOrder(env, o);   // US-warehouse items go to CJ (sandbox unless live keys)
      await notifySellers(env, o);
      try { await payOut(env, o); } catch (e) { console.log('payout failed', o.id, String(e.message || e).slice(0, 160)); }
      await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: 400 * 86400 });
    }
  }
  return { status: 200, body: forBuyer(o) };
}
export async function listOrders(env, owner) {
  if (!owner) return { status: 200, body: { orders: [] } };
  const ids = JSON.parse((await kv(env).get('orders:' + owner)) || '[]');
  const orders = (await Promise.all(ids.slice(0, 50).map(async id => JSON.parse((await kv(env).get('order:' + id)) || 'null')))).filter(Boolean);
  return { status: 200, body: { orders: orders.map(forBuyer) } };
}

/* ---------- seller side: orders to ship ---------- */
export async function sellerOrders(env, seller) {
  if (!seller) return { status: 200, body: { orders: [] } };
  const ids = JSON.parse((await kv(env).get('sorders:' + seller)) || '[]');
  const orders = (await Promise.all(ids.slice(0, 100).map(async id => JSON.parse((await kv(env).get('order:' + id)) || 'null')))).filter(o => o && o.status === 'placed');
  return { status: 200, body: { orders: orders.map(o => forSeller(o, seller)), toShip: orders.reduce((n, o) => n + o.lines.filter(l => l.sellerOwner === seller && l.status === 'ordered').length, 0) } };
}
export async function markShipped(env, body, seller) {
  const o = JSON.parse((await kv(env).get('order:' + String(body.order || ''))) || 'null');
  const l = o && o.lines.find(x => x.n === (body.line | 0) && x.sellerOwner === seller);
  if (!l) return { status: 404, body: { error: 'Order not found.' } };
  if (l.status !== 'ordered') return { status: 400, body: { error: 'Already ' + l.status + '.' } };
  l.status = 'shipped'; l.shippedAt = Date.now(); l.tracking = String(body.tracking || '').slice(0, 60);
  await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: 400 * 86400 });
  return { status: 200, body: { line: { ...l, sellerOwner: undefined } } };
}

/* ---------- reviews: only from people who bought the item here (verified purchase) ---------- */
export async function addReview(env, body, owner, who) {
  const o = JSON.parse((await kv(env).get('order:' + String(body.order || ''))) || 'null');
  if (!o || o.owner !== owner) return { status: 404, body: { error: 'Order not found.' } };
  if (o.status !== 'placed') return { status: 400, body: { error: 'Reviews open once the order is paid.' } };
  const l = o.lines.find(x => x.n === (body.line | 0)); if (!l) return { status: 404, body: { error: 'Item not found.' } };
  if (l.reviewed) return { status: 400, body: { error: 'You already reviewed this item.' } };
  const rating = Math.round(+body.rating); if (!(rating >= 1 && rating <= 5)) return { status: 400, body: { error: 'Pick 1 to 5 stars.' } };
  const text = String(body.text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  const r = { id: l.id, order: o.id, rating, comment: text || (rating >= 4 ? 'Good.' : rating === 3 ? 'Okay.' : 'Not great.'), reviewerName: who ? (who.wallet ? who.username : '@' + who.username) : 'Verified buyer', date: new Date().toISOString(), verified: true, test: o.mode === 'test' };
  await kv(env).put('review:' + l.id + ':' + o.id + ':' + l.n, JSON.stringify(r));
  l.reviewed = rating; await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: 400 * 86400 });
  return { status: 200, body: { review: r } };
}
// every Grokshop review, grouped by product id (merged into the catalogue)
export async function allReviews(env) {
  const store = kv(env); if (!store.list) return new Map();
  const l = await store.list({ prefix: 'review:' }).catch(() => ({ keys: [] }));
  const by = new Map();
  for (const k of (l.keys || []).slice(0, 2000)) { const r = JSON.parse((await store.get(k.name)) || 'null'); if (!r) continue; const id = String(r.id); if (!by.has(id)) by.set(id, []); by.get(id).push(r); }
  return by;
}

// returns, handled by a bot: the window comes from the seller's own return line ("30 days return policy")
function returnDays(text) { const s = String(text || '').toLowerCase(); if (/no return/.test(s)) return 0; const m = s.match(/(\d+)\s*(day|week|month|year)/); if (!m) return null; return +m[1] * ({ day: 1, week: 7, month: 30, year: 365 })[m[2]]; }
export async function requestReturn(env, body, owner) {
  const o = JSON.parse((await kv(env).get('order:' + String(body.order || ''))) || 'null');
  if (!o || o.owner !== owner) return { status: 404, body: { error: 'Order not found.' } };
  if (o.status !== 'placed') return { status: 400, body: { error: 'This order is not paid yet.' } };
  const l = o.lines.find(x => x.n === (body.line | 0)); if (!l) return { status: 404, body: { error: 'Item not found.' } };
  if (l.status !== 'ordered') return { status: 200, body: { line: l, note: 'Already ' + l.status + '.' } };
  const days = returnDays(l.returns), age = (Date.now() - (o.paidAt || o.at)) / 86400e3;
  let note;
  if (days === 0) note = l.seller + ' does not take returns on this item (' + l.returns.toLowerCase() + ').';
  else if (days != null && age > days) note = 'the ' + days + '-day return window closed ' + Math.floor(age - days) + ' days ago.';
  else {
    l.status = 'return started'; l.returnReason = String(body.reason || '').slice(0, 200); l.returnAt = Date.now();
    note = 'return started with ' + l.seller.toLowerCase() + (days != null ? ', ' + Math.max(0, Math.ceil(days - age)) + ' days left in the window' : ', the store confirms its window') + '. ' + (o.mode !== 'live' ? 'preview order: nothing to send back.' : 'a return label comes from the store by email.');
    await kv(env).put('order:' + o.id, JSON.stringify(o), { expirationTtl: 400 * 86400 });
  }
  return { status: 200, body: { line: { ...l, sellerOwner: undefined }, note } };
}

/* ---------- seller listings (reviewed by the owner before they show) ---------- */
const MAX_IMG = 700 * 1024;
export async function createListing(env, body, owner, who) {
  if (!owner) return { status: 400, body: { error: 'Missing browser id.' } };
  const title = String(body.title || '').trim().slice(0, 120), price = Math.round((+body.price || 0) * 100) / 100;
  if (title.length < 3) return { status: 400, body: { error: 'Give the product a title.' } };
  if (!(price >= 1 && price <= 50000)) return { status: 400, body: { error: 'Price must be between $1 and $50,000.' } };
  const dept = DEPTS.includes(body.dept) ? body.dept : 'other';
  const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4);
  if (!imgs.length) return { status: 400, body: { error: 'Add at least one photo.' } };
  const ids = [];
  for (const d of imgs) {
    const m = String(d).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { status: 400, body: { error: 'Photos must be JPG, PNG or WebP.' } };
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    if (bytes.length > MAX_IMG) return { status: 400, body: { error: 'Each photo must be under 700 KB (the page shrinks them for you).' } };
    const id = hex(10); await kv(env).put('img:' + id, bytes, { metadata: { type: m[1] } }); ids.push(id);
  }
  const L = {
    id: 'l-' + hex(6), owner, status: 'in review', at: Date.now(), title, description: String(body.description || '').slice(0, 1500), price,
    stock: Math.max(0, Math.min(99999, body.stock | 0)), dept, shippingInformation: String(body.shipsIn || '').slice(0, 60), returnPolicy: String(body.returns || '').slice(0, 60),
    seller: String(body.store || (who ? (who.wallet ? who.username : '@' + who.username) : '') || 'Grokshop seller').trim().slice(0, 40), sellerX: who && !who.wallet ? who.username : '', images: ids
  };
  await kv(env).put('listing:' + L.id, JSON.stringify(L));
  const k = 'listings:' + owner, list = JSON.parse((await kv(env).get(k)) || '[]'); list.unshift(L.id); await kv(env).put(k, JSON.stringify(list.slice(0, 500)));
  return { status: 200, body: L };
}
export async function myListings(env, owner) {
  const ids = JSON.parse((await kv(env).get('listings:' + owner)) || '[]');
  const ls = (await Promise.all(ids.slice(0, 100).map(async id => JSON.parse((await kv(env).get('listing:' + id)) || 'null')))).filter(Boolean);
  return { status: 200, body: { listings: ls } };
}
export async function requestShopify(env, body, owner, who) {
  const domain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const token = String(body.token || '').trim();
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) return { status: 400, body: { error: 'Use your store\'s myshopify.com address.' } };
  if (/^shp(at|ss|ca|pa)_/.test(token)) return { status: 400, body: { error: 'That is a private Shopify token. Never share it. Use the PUBLIC Storefront token from the Headless channel.' } };
  if (!/^[a-f0-9]{32}$/.test(token)) return { status: 400, body: { error: 'The public Storefront token is 32 letters and numbers.' } };
  const key = domain.replace('.myshopify.com', '').slice(0, 40);
  const req = { kind: 'shopify', id: key, owner, at: Date.now(), status: 'in review', endpoint: 'https://' + domain + '/api/2025-07/graphql.json', token, shipsIn: String(body.shipsIn || '').slice(0, 60), returns: String(body.returns || '').slice(0, 60), sellerX: who ? who.username : '' };
  await kv(env).put('shopreq:' + key, JSON.stringify(req));
  return { status: 200, body: { ok: true, store: domain, status: 'in review' } };
}
// approved listings in the catalogue's shape
export async function approvedListings(env, base) {
  const store = kv(env); if (!store.list) return [];
  const l = await store.list({ prefix: 'listing:' }).catch(() => ({ keys: [] }));
  const all = (await Promise.all((l.keys || []).map(async k => JSON.parse((await store.get(k.name)) || 'null')))).filter(x => x && x.status === 'live');
  return all.map(L => ({
    id: L.id, source: 'seller', merchant: L.seller, title: L.title, description: L.description, category: L.dept, dept: L.dept, brand: L.seller, tags: [L.dept],
    price: L.price, currency: 'USD', discountPercentage: 0, rating: null, reviews: [], stock: L.stock, availabilityStatus: L.stock > 0 ? 'In Stock' : 'Out of Stock',
    shippingInformation: L.shippingInformation || null, returnPolicy: L.returnPolicy || null, warrantyInformation: null,
    images: L.images.map(i => base + '/img/' + i), thumbnail: base + '/img/' + L.images[0]
  }));
}
export async function image(env, id) {
  if (!/^[a-f0-9]{20}$/.test(id)) return null;
  const store = kv(env); if (!store.getWithMetadata) return null;
  const r = await store.getWithMetadata('img:' + id, { type: 'arrayBuffer' });
  return r && r.value ? r : null;
}

/* ---------- the owner's review queue ---------- */
export function isAdmin(req, env) { return !!env.ADMIN_TOKEN && req.headers.get('x-admin-token') === env.ADMIN_TOKEN; }
export async function queue(env) {
  const store = kv(env), out = { listings: [], shopify: [], merchants: [], warehouse: await cjOrders(env).catch(() => []) };
  for (const [prefix, bucket] of [['listing:', 'listings'], ['shopreq:', 'shopify'], ['apply:', 'merchants']]) {
    const l = await store.list({ prefix }).catch(() => ({ keys: [] }));
    for (const k of (l.keys || []).slice(0, 300)) { const v = JSON.parse((await store.get(k.name)) || 'null'); if (v) out[bucket].push({ key: k.name, ...v, token: v.token ? v.token.slice(0, 4) + '…' : undefined }); }
  }
  out.listings.sort((a, b) => b.at - a.at); out.shopify.sort((a, b) => b.at - a.at);
  return out;
}
export async function decide(env, body) {
  const store = kv(env), ok = !!body.ok;
  if (body.kind === 'listing') {
    const L = JSON.parse((await store.get('listing:' + body.id)) || 'null'); if (!L) return { status: 404, body: { error: 'not found' } };
    // real money only: with a LIVE Stripe key a listing goes live once its seller can be paid out (test mode never moves money)
    if (ok && /^sk_live_/.test(env.STRIPE_SECRET_KEY || '')) { const ps = await payoutStatus(env, L.owner).catch(() => ({ status: 'none' })); if (ps.status !== 'ready') return { status: 400, body: { error: 'This seller has not finished setting up payouts on Stripe yet.' } }; }
    L.status = ok ? 'live' : 'declined'; L.decidedAt = Date.now(); await store.put('listing:' + L.id, JSON.stringify(L));
    return { status: 200, body: { id: L.id, status: L.status } };
  }
  if (body.kind === 'shopify') {
    const R = JSON.parse((await store.get('shopreq:' + body.id)) || 'null'); if (!R) return { status: 404, body: { error: 'not found' } };
    R.status = ok ? 'live' : 'declined'; await store.put('shopreq:' + R.id, JSON.stringify(R));
    if (ok) await store.put('shop:' + R.id, JSON.stringify({ key: R.id, endpoint: R.endpoint, token: R.token, shipsIn: R.shipsIn || null, returns: R.returns || null, owner: R.owner }));
    else await store.delete('shop:' + R.id);
    return { status: 200, body: { id: R.id, status: R.status } };
  }
  return { status: 400, body: { error: 'kind must be listing or shopify' } };
}
