// Seller payouts with Stripe Connect (Express accounts, "separate charges and transfers").
// The shopper pays Grokazon once at checkout; once Stripe says the order is paid, each seller with a connected Stripe
// account receives a transfer for their part (their items + their shipping - Grokazon's fee, PLATFORM_FEE_BPS, 0 now).
// Sellers set up and manage payouts on Stripe's own pages; Grokazon never sees their bank details.
// Records: KV payout:<owner> = { acct, at } ; each order line keeps { transfer, paidOut } once sent.
import { kv } from './missions.js';

const API = 'https://api.stripe.com/v1';
async function stripe(env, path, form, method) {
  const r = await fetch(API + path, { method: method || (form ? 'POST' : 'GET'), headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Stripe answered ' + r.status)); e.status = r.status; throw e; }
  return j;
}
const rec = async (env, owner) => JSON.parse((await kv(env).get('payout:' + owner)) || 'null');

// where a seller stands: none | started (onboarding not finished) | ready (Stripe can send them money)
export async function payoutStatus(env, owner) {
  if (!env.STRIPE_SECRET_KEY) return { status: 'off', note: 'Payments are not switched on yet.' };
  const p = await rec(env, owner); if (!p) return { status: 'none' };
  const a = await stripe(env, '/accounts/' + p.acct);
  const ready = a.capabilities && a.capabilities.transfers === 'active' && a.payouts_enabled;
  return { status: ready ? 'ready' : 'started', details: !!a.details_submitted, due: ((a.requirements && a.requirements.currently_due) || []).length };
}
// start (or continue) Stripe's onboarding; returns the Stripe page to send the seller to
export async function startPayouts(env, owner, who, siteOrigin, cc) {
  if (!env.STRIPE_SECRET_KEY) return { status: 400, body: { error: 'Payments are not switched on yet.' } };
  let p = await rec(env, owner);
  if (!p) {
    const a = await stripe(env, '/accounts', { type: 'express', country: /^[A-Z]{2}$/.test(cc || '') ? cc : 'US', 'capabilities[transfers][requested]': 'true', 'business_profile[url]': 'https://grokazon.app', 'metadata[grokazon_owner]': owner, ...(who ? { 'metadata[x]': '@' + who.username } : {}) });
    p = { acct: a.id, at: Date.now() }; await kv(env).put('payout:' + owner, JSON.stringify(p));
  }
  const link = await stripe(env, '/account_links', { account: p.acct, type: 'account_onboarding', refresh_url: siteOrigin + '/seller.html#payouts', return_url: siteOrigin + '/seller.html#payouts' });
  return { status: 200, body: { url: link.url } };
}
// Stripe's Express dashboard for a ready seller (payout history, bank details)
export async function payoutDashboard(env, owner) {
  const p = await rec(env, owner); if (!p || !env.STRIPE_SECRET_KEY) return { status: 400, body: { error: 'Payouts are not set up.' } };
  const l = await stripe(env, '/accounts/' + p.acct + '/login_links', {});
  return { status: 200, body: { url: l.url } };
}
// after Stripe confirms payment: one transfer per seller, linked to the shopper's charge
export async function payOut(env, o) {
  if (!env.STRIPE_SECRET_KEY || !o.session || o.mode === 'test') return o;
  const fee = Math.max(0, Math.min(5000, parseInt(env.PLATFORM_FEE_BPS || '0', 10))) / 10000;
  const s = await stripe(env, '/checkout/sessions/' + o.session + '?expand[]=payment_intent');
  const charge = s.payment_intent && (s.payment_intent.latest_charge || (s.payment_intent.charges && s.payment_intent.charges.data[0] && s.payment_intent.charges.data[0].id));
  if (!charge) return o;
  const bySeller = new Map();
  for (const l of o.lines) if (l.sellerOwner && !l.paidOut) { if (!bySeller.has(l.sellerOwner)) bySeller.set(l.sellerOwner, []); bySeller.get(l.sellerOwner).push(l); }
  for (const [owner, ls] of bySeller) {
    const p = await rec(env, owner); if (!p) { ls.forEach(l => { l.payout = 'waiting for the seller to set up payouts'; }); continue; }
    const sellerName = ls[0].seller, ship = ((o.shippingBy || []).find(g => g.seller === sellerName) || {}).shipping || 0;
    const gross = ls.reduce((a, l) => a + l.price * l.qty, 0) + ship, cents = Math.round(gross * (1 - fee) * 100);
    try {
      const t = await stripe(env, '/transfers', { amount: String(cents), currency: 'usd', destination: p.acct, source_transaction: charge, transfer_group: o.id, 'metadata[order]': o.id });
      ls.forEach(l => { l.paidOut = Date.now(); l.transfer = t.id; l.payout = 'sent'; });
    } catch (e) { ls.forEach(l => { l.payout = 'transfer failed: ' + String(e.message).slice(0, 80); }); }
  }
  return o;
}
